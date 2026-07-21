import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type InventoryLocationType = Database['public']['Tables']['inventory_locations']['Row']['location_type'];
export type InventoryLocationSourceType = Database['public']['Tables']['inventory_locations']['Row']['source_type'];
export type InventoryLocationSyncStatus = Database['public']['Tables']['inventory_locations']['Row']['sync_status'];
export type InventoryLocationRow = Database['public']['Tables']['inventory_locations']['Row'];
export type FleetAssetType = 'van' | 'hgv' | 'plant';

export interface InventoryLinkedAsset {
  type: FleetAssetType;
  id: string;
}

export interface LinkedAssetColumns {
  linked_van_id: string | null;
  linked_hgv_id: string | null;
  linked_plant_id: string | null;
}

export type InventoryAdminClient = SupabaseClient<Database>;

export interface InventoryLocationListParams {
  search: string;
  includeLegacyQuotes: boolean;
  limit: number;
  offset: number;
}

export interface InventoryLocationListResult {
  locations: InventoryLocationRow[];
  total: number;
}

interface InventoryLocationAssigneeRow {
  location_id: string | null;
  user?: { full_name: string | null } | { full_name: string | null }[] | null;
}

interface InventoryLocationSearchRow extends InventoryLocationRow {
  total_count: number;
}

interface InventoryLocationLinkedDisplay {
  linked_asset_type: FleetAssetType | null;
  linked_asset_label: string | null;
  linked_asset_nickname: string | null;
}

export interface EnrichedInventoryLocation extends InventoryLocationRow, InventoryLocationLinkedDisplay {
  item_count: number;
  assigned_user_names: string[];
}

function pickAssigneeProfile(
  user: InventoryLocationAssigneeRow['user']
): { full_name: string | null } | null {
  if (!user) return null;
  return Array.isArray(user) ? user[0] ?? null : user;
}

function getAssignedUserNamesByLocationId(...rowGroups: InventoryLocationAssigneeRow[][]): Map<string, string[]> {
  const namesByLocationId = new Map<string, string[]>();

  rowGroups.flat().forEach((row) => {
    const fullName = pickAssigneeProfile(row.user)?.full_name?.trim();
    if (!row.location_id || !fullName) return;

    const names = namesByLocationId.get(row.location_id) || [];
    if (!names.includes(fullName)) names.push(fullName);
    namesByLocationId.set(row.location_id, names);
  });

  namesByLocationId.forEach((names) => names.sort((a, b) => a.localeCompare(b)));
  return namesByLocationId;
}

function getLinkedAssetDisplay(
  location: Pick<InventoryLocationRow, 'linked_van_id' | 'linked_hgv_id' | 'linked_plant_id'>,
  vanById: Map<string, { reg_number: string | null; nickname: string | null }>,
  hgvById: Map<string, { reg_number: string; nickname: string | null }>,
  plantById: Map<string, { plant_id: string; reg_number: string | null; nickname: string | null }>
): InventoryLocationLinkedDisplay {
  if (location.linked_van_id) {
    const van = vanById.get(location.linked_van_id);
    return {
      linked_asset_type: 'van',
      linked_asset_label: van?.reg_number || null,
      linked_asset_nickname: van?.nickname || null,
    };
  }

  if (location.linked_hgv_id) {
    const hgv = hgvById.get(location.linked_hgv_id);
    return {
      linked_asset_type: 'hgv',
      linked_asset_label: hgv?.reg_number || null,
      linked_asset_nickname: hgv?.nickname || null,
    };
  }

  if (location.linked_plant_id) {
    const asset = plantById.get(location.linked_plant_id);
    return {
      linked_asset_type: 'plant',
      linked_asset_label: asset?.reg_number || asset?.plant_id || null,
      linked_asset_nickname: asset?.nickname || null,
    };
  }

  return {
    linked_asset_type: null,
    linked_asset_label: null,
    linked_asset_nickname: null,
  };
}

export async function listInventoryLocations(
  admin: InventoryAdminClient,
  params: InventoryLocationListParams
): Promise<InventoryLocationListResult> {
  const { data, error } = await admin.rpc('inventory_search_locations', {
    p_search: params.search,
    p_include_legacy: params.includeLegacyQuotes,
    p_limit: params.limit,
    p_offset: params.offset,
  });

  if (error) throw error;

  const searchRows = (data || []) as unknown as InventoryLocationSearchRow[];
  const total = Number(searchRows[0]?.total_count || 0);
  const locations = searchRows.map((row) => {
    const { total_count: _totalCount, ...location } = row;
    return location as InventoryLocationRow;
  });

  return { locations, total };
}

export async function enrichInventoryLocations(
  admin: InventoryAdminClient,
  locationRows: InventoryLocationRow[]
): Promise<EnrichedInventoryLocation[]> {
  if (locationRows.length === 0) return [];

  const locationIds = locationRows.map((location) => location.id);
  const vanIds = locationRows.flatMap((location) => location.linked_van_id ? [location.linked_van_id] : []);
  const hgvIds = locationRows.flatMap((location) => location.linked_hgv_id ? [location.linked_hgv_id] : []);
  const plantIds = locationRows.flatMap((location) => location.linked_plant_id ? [location.linked_plant_id] : []);
  const [
    itemLocationsResult,
    vansResult,
    hgvsResult,
    plantResult,
    assignedUsersResult,
    assignedSiteUsersResult,
  ] = await Promise.all([
    admin
      .from('inventory_items')
      .select('location_id')
      .eq('status', 'active')
      .in('location_id', locationIds),
    vanIds.length > 0
      ? admin.from('vans').select('id, reg_number, nickname').in('id', vanIds)
      : Promise.resolve({ data: [], error: null }),
    hgvIds.length > 0
      ? admin.from('hgvs').select('id, reg_number, nickname').in('id', hgvIds)
      : Promise.resolve({ data: [], error: null }),
    plantIds.length > 0
      ? admin.from('plant').select('id, plant_id, reg_number, nickname').in('id', plantIds)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from('inventory_user_locations')
      .select(`
        location_id,
        user:profiles!inventory_user_locations_user_id_fkey(full_name)
      `)
      .in('location_id', locationIds),
    admin
      .from('inventory_user_site_locations')
      .select(`
        location_id,
        user:profiles!inventory_user_site_locations_user_id_fkey(full_name)
      `)
      .in('location_id', locationIds),
  ]);

  if (itemLocationsResult.error) throw itemLocationsResult.error;
  if (vansResult.error) throw vansResult.error;
  if (hgvsResult.error) throw hgvsResult.error;
  if (plantResult.error) throw plantResult.error;
  if (assignedUsersResult.error) throw assignedUsersResult.error;
  if (assignedSiteUsersResult.error) throw assignedSiteUsersResult.error;

  const countByLocationId = new Map<string, number>();
  (itemLocationsResult.data || []).forEach((item) => {
    if (!item.location_id) return;
    countByLocationId.set(item.location_id, (countByLocationId.get(item.location_id) || 0) + 1);
  });
  const vanById = new Map((vansResult.data || []).map((van) => [van.id, van]));
  const hgvById = new Map((hgvsResult.data || []).map((hgv) => [hgv.id, hgv]));
  const plantById = new Map((plantResult.data || []).map((asset) => [asset.id, asset]));
  const assignedUserNamesByLocationId = getAssignedUserNamesByLocationId(
    (assignedUsersResult.data || []) as unknown as InventoryLocationAssigneeRow[],
    (assignedSiteUsersResult.data || []) as unknown as InventoryLocationAssigneeRow[],
  );

  return locationRows.map((location) => ({
    ...location,
    item_count: countByLocationId.get(location.id) || 0,
    assigned_user_names: assignedUserNamesByLocationId.get(location.id) || [],
    ...getLinkedAssetDisplay(location, vanById, hgvById, plantById),
  }));
}

export function getInventoryLinkedAsset(location: Pick<
  InventoryLocationRow,
  'linked_van_id' | 'linked_hgv_id' | 'linked_plant_id'
>): InventoryLinkedAsset | null {
  if (location.linked_van_id) return { type: 'van', id: location.linked_van_id };
  if (location.linked_hgv_id) return { type: 'hgv', id: location.linked_hgv_id };
  if (location.linked_plant_id) return { type: 'plant', id: location.linked_plant_id };
  return null;
}

export function buildLinkedAssetColumns(
  linkedAssetType: FleetAssetType | 'none' | null | undefined,
  linkedAssetId: string | null | undefined
): LinkedAssetColumns {
  const assetId = linkedAssetId?.trim() || null;

  return {
    linked_van_id: linkedAssetType === 'van' ? assetId : null,
    linked_hgv_id: linkedAssetType === 'hgv' ? assetId : null,
    linked_plant_id: linkedAssetType === 'plant' ? assetId : null,
  };
}

export function getLocationTypeForLinkedAsset(linkedAssetType: FleetAssetType | 'none' | null | undefined): InventoryLocationType {
  if (linkedAssetType === 'van') return 'van';
  if (linkedAssetType === 'hgv') return 'hgv';
  if (linkedAssetType === 'plant') return 'plant';
  return 'manual';
}

export function buildFleetLocationName(assetType: FleetAssetType, assetReference: string): string {
  const trimmedReference = assetReference.trim();
  if (assetType === 'van') return `Van - ${trimmedReference}`;
  if (assetType === 'hgv') return `HGV - ${trimmedReference}`;
  return `Plant - ${trimmedReference}`;
}

export function normalizeExternalReference(reference: string | null | undefined): string | null {
  const trimmed = reference?.trim().toUpperCase();
  return trimmed || null;
}

export function isGeneratedInventoryLocation(location: Pick<InventoryLocationRow, 'location_type'>): boolean {
  return ['van', 'hgv', 'plant', 'site', 'yard', 'unknown'].includes(location.location_type);
}

export function canManuallyRelinkInventoryLocation(location: Pick<InventoryLocationRow, 'location_type'>): boolean {
  return location.location_type === 'manual';
}

export async function loadInventoryLocationById(
  admin: InventoryAdminClient,
  locationId: string
): Promise<InventoryLocationRow | null> {
  const { data, error } = await admin
    .from('inventory_locations')
    .select('*')
    .eq('id', locationId)
    .maybeSingle();

  if (error) throw error;
  return data;
}
