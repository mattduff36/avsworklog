import 'server-only';

import type { FleetAssetLinkType, InventoryLocation } from '@/app/(dashboard)/inventory/types';
import { isOperationalInventoryLocation } from '@/app/(dashboard)/inventory/utils';
import { INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import { enrichInventoryLocations, listInventoryLocations } from '@/lib/server/inventory-locations';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';
import type { Json } from '@/types/database';

type InventoryAdminClient = ReturnType<typeof createAdminClient>;

export interface AllocateKioskTakeInput {
  actionId: string;
  actorId: string;
  destinationLocationId?: string | null;
  newLocation?: {
    name?: string;
    description?: string | null;
    linked_asset_type?: FleetAssetLinkType | 'none';
    linked_asset_id?: string | null;
  } | null;
}

export class InventoryKioskAllocateError extends Error {
  status: number;
  allocatedLocationId?: string | null;

  constructor(message: string, status = 400, allocatedLocationId?: string | null) {
    super(message);
    this.name = 'InventoryKioskAllocateError';
    this.status = status;
    this.allocatedLocationId = allocatedLocationId;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function allocateUnallocatedKioskTake(input: AllocateKioskTakeInput) {
  if (!isUuid(input.actionId) || !isUuid(input.actorId)) {
    throw new InventoryKioskAllocateError('A valid action and actor are required', 400);
  }

  const hasDestination = Boolean(input.destinationLocationId?.trim());
  const hasNewLocation = Boolean(input.newLocation);
  if (hasDestination === hasNewLocation) {
    throw new InventoryKioskAllocateError('Choose an existing location or create one', 400);
  }

  const admin = createAdminClient();
  const destinationLocationId = hasDestination ? input.destinationLocationId!.trim() : null;
  const newLocationName = input.newLocation?.name?.trim() || '';
  const linkedAssetType = input.newLocation?.linked_asset_type || 'none';
  const linkedAssetId = input.newLocation?.linked_asset_id || null;
  if (hasNewLocation && !newLocationName) {
    throw new InventoryKioskAllocateError('A location name is required', 400);
  }
  if (hasNewLocation && ['yard', 'unknown', 'in transfer'].includes(newLocationName.toLowerCase())) {
    throw new InventoryKioskAllocateError('That location name is reserved', 400);
  }
  if (hasNewLocation && linkedAssetType !== 'none' && !isUuid(linkedAssetId)) {
    throw new InventoryKioskAllocateError('A linked fleet asset is required', 400);
  }
  const newLocation = hasNewLocation
    ? {
      name: newLocationName,
      description: input.newLocation?.description?.trim() || null,
      linked_asset_type: linkedAssetType,
      linked_asset_id: linkedAssetId,
    }
    : null;

  const { data, error } = await admin.rpc('inventory_allocate_unallocated_kiosk_take', {
    p_actor: input.actorId,
    p_action_id: input.actionId,
    p_destination_location_id: destinationLocationId,
    p_new_location: (newLocation as unknown as Json) || null,
  });

  if (error) {
    if (error.message?.includes('Yard take already allocated:')) {
      const allocatedLocationId = error.message.split('Yard take already allocated:')[1] || null;
      throw new InventoryKioskAllocateError(
        'This Yard take has already been allocated',
        409,
        allocatedLocationId,
      );
    }
    if (
      error.message?.includes('no longer at In transfer')
      || error.message?.includes('changed before')
    ) {
      throw new InventoryKioskAllocateError('Stock changed before it could be allocated', 409);
    }
    throw new InventoryKioskAllocateError(error.message || 'Failed to allocate the Yard take', 400);
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    throw new InventoryKioskAllocateError('Allocation did not return a result', 500);
  }
  return row;
}

export async function listActionsInventoryLocations(params: {
  search: string;
  includeLegacyQuotes?: boolean;
  limit?: number;
  offset?: number;
  id?: string;
}) {
  const admin = createAdminClient();
  if (params.id) {
    const { data, error } = await admin
      .from('inventory_locations')
      .select('*')
      .eq('id', params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data || !isOperationalInventoryLocation(data)) {
      return { locations: [] as InventoryLocation[], total: 0 };
    }
    const [location] = await enrichInventoryLocations(admin, [data]);
    return { locations: location ? [location] : [], total: location ? 1 : 0 };
  }

  const { locations, total } = await listInventoryLocations(admin, {
    search: params.search,
    includeLegacyQuotes: params.includeLegacyQuotes === true,
    locationTypes: ['van', 'hgv', 'plant', 'site', 'manual'],
    limit: params.limit || 50,
    offset: params.offset || 0,
  });
  const operational = locations.filter((location) => isOperationalInventoryLocation(location));
  const enriched = await enrichInventoryLocations(admin, operational);
  return { locations: enriched, total };
}

export async function listActionsFleetAssets() {
  const admin: InventoryAdminClient = createAdminClient();
  const [{ data: vans, error: vansError }, { data: hgvs, error: hgvsError }, { data: plant, error: plantError }] =
    await Promise.all([
      admin.from('vans').select('id, reg_number, nickname, status').eq('status', 'active').order('reg_number'),
      admin.from('hgvs').select('id, reg_number, nickname, status').eq('status', 'active').order('reg_number'),
      admin.from('plant').select('id, plant_id, reg_number, nickname, make, model, status').eq('status', 'active').order('plant_id'),
    ]);

  if (vansError) throw vansError;
  if (hgvsError) throw hgvsError;
  if (plantError) throw plantError;

  return [
    ...(vans || []).map((asset) => ({
      id: asset.id,
      type: 'van' as const,
      label: `Van - ${formatFleetAssetLabel({
        identifier: asset.reg_number || 'Unknown',
        nickname: asset.nickname,
      })}`,
      description: asset.nickname || null,
    })),
    ...(hgvs || []).map((asset) => ({
      id: asset.id,
      type: 'hgv' as const,
      label: `HGV - ${formatFleetAssetLabel({
        identifier: asset.reg_number || 'Unknown',
        nickname: asset.nickname,
      })}`,
      description: asset.nickname || null,
    })),
    ...(plant || []).map((asset) => ({
      id: asset.id,
      type: 'plant' as const,
      label: `Plant - ${formatFleetAssetLabel({
        identifier: asset.plant_id || 'Unknown Plant',
        nickname: asset.nickname,
      })}`,
      description: [asset.make, asset.model, asset.reg_number].filter(Boolean).join(' ') || null,
    })),
  ];
}

export function isInventoryKioskUnallocatedTakeWorkflow(workflowKey: string | null | undefined): boolean {
  return workflowKey === INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY;
}
