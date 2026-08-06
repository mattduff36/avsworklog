import type { Database } from '@/types/database';
import {
  normalizeExternalReference,
  type InventoryAdminClient,
  type InventoryLocationRow,
} from './inventory-locations';

type QuoteProjectNumberRow = Database['public']['Tables']['quote_project_numbers']['Row'];

export interface SiteLocationSyncResult {
  action: 'created' | 'updated' | 'archived' | 'unchanged' | 'skipped';
  location_id: string | null;
  external_reference: string | null;
}

interface SiteLocationSyncInput {
  sourceType: 'project_number';
  sourceId: string;
  externalReference: string | null;
  name: string;
  description: string | null;
  isActive: boolean;
  actorUserId?: string | null;
}

function buildSiteLocationName(reference: string, label: string | null): string {
  return label?.trim() ? `Site - ${reference} - ${label.trim()}` : `Site - ${reference}`;
}

function buildProjectSiteLabel(project: Pick<QuoteProjectNumberRow, 'title' | 'description'>): string | null {
  return project.title?.trim() || project.description?.trim() || null;
}

async function findSiteLocationByReference(
  admin: InventoryAdminClient,
  externalReference: string
): Promise<InventoryLocationRow | null> {
  const { data, error } = await admin
    .from('inventory_locations')
    .select('*')
    .eq('location_type', 'site')
    .eq('external_reference', externalReference)
    .order('is_active', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function assertProjectOwnedOrClaimable(existingLocation: InventoryLocationRow, sourceId: string): void {
  if (existingLocation.source_type === 'quote' || existingLocation.source_type === 'legacy_quote') {
    throw new Error(
      `Refusing to modify quote-owned site location ${existingLocation.id} from project-number sync.`
    );
  }

  if (existingLocation.source_type && existingLocation.source_type !== 'project_number') {
    throw new Error(
      `Refusing to modify site location ${existingLocation.id} owned by source_type=${existingLocation.source_type}.`
    );
  }

  if (
    existingLocation.source_type === 'project_number'
    && existingLocation.source_id
    && existingLocation.source_id !== sourceId
  ) {
    throw new Error(
      `Refusing to modify project site location ${existingLocation.id} owned by a different project number.`
    );
  }
}

export async function syncSiteLocation(
  admin: InventoryAdminClient,
  input: SiteLocationSyncInput
): Promise<SiteLocationSyncResult> {
  const externalReference = normalizeExternalReference(input.externalReference);
  if (!externalReference) {
    return { action: 'skipped', location_id: null, external_reference: null };
  }

  const existingLocation = await findSiteLocationByReference(admin, externalReference);
  const now = new Date().toISOString();

  if (!input.isActive) {
    if (!existingLocation || !existingLocation.is_active) {
      return {
        action: existingLocation ? 'unchanged' : 'skipped',
        location_id: existingLocation?.id || null,
        external_reference: externalReference,
      };
    }

    if (
      existingLocation.source_type !== 'project_number'
      || (existingLocation.source_id && existingLocation.source_id !== input.sourceId)
    ) {
      throw new Error(
        `Refusing to archive site location ${existingLocation.id}; project-number sync can only archive its own locations.`
      );
    }

    const { data, error } = await admin
      .from('inventory_locations')
      .update({
        is_active: false,
        sync_status: 'archived',
        source_synced_at: now,
        updated_by: input.actorUserId || null,
      })
      .eq('id', existingLocation.id)
      .select('id')
      .single();

    if (error) throw error;
    return { action: 'archived', location_id: data.id, external_reference: externalReference };
  }

  if (existingLocation) {
    assertProjectOwnedOrClaimable(existingLocation, input.sourceId);
  }

  const payload = {
    name: input.name,
    description: input.description,
    is_active: true,
    location_type: 'site' as const,
    source_type: input.sourceType,
    source_id: input.sourceId,
    external_reference: externalReference,
    sync_status: 'synced' as const,
    source_synced_at: now,
    linked_van_id: null,
    linked_hgv_id: null,
    linked_plant_id: null,
    updated_by: input.actorUserId || null,
  };

  if (existingLocation) {
    const shouldUpdate =
      existingLocation.name !== payload.name ||
      existingLocation.description !== payload.description ||
      existingLocation.is_active !== true ||
      existingLocation.source_type !== payload.source_type ||
      existingLocation.source_id !== payload.source_id ||
      existingLocation.sync_status !== payload.sync_status;

    if (!shouldUpdate) {
      return { action: 'unchanged', location_id: existingLocation.id, external_reference: externalReference };
    }

    const { data, error } = await admin
      .from('inventory_locations')
      .update(payload)
      .eq('id', existingLocation.id)
      .select('id')
      .single();

    if (error) throw error;
    return { action: 'updated', location_id: data.id, external_reference: externalReference };
  }

  const { data, error } = await admin
    .from('inventory_locations')
    .insert({
      ...payload,
      created_by: input.actorUserId || null,
    })
    .select('id')
    .single();

  if (error) throw error;
  return { action: 'created', location_id: data.id, external_reference: externalReference };
}

export async function syncProjectNumberSiteLocation(
  admin: InventoryAdminClient,
  project: Pick<QuoteProjectNumberRow, 'id' | 'project_reference' | 'status' | 'title' | 'description'>,
  actorUserId?: string | null
): Promise<SiteLocationSyncResult> {
  const reference = normalizeExternalReference(project.project_reference);
  const shouldBeActive = project.status === 'open';

  if (
    !shouldBeActive
    && project.status !== 'cancelled'
    && project.status !== 'converted'
    && project.status !== 'merged'
  ) {
    return { action: 'skipped', location_id: null, external_reference: reference };
  }

  // Converted/merged project rows are owned by the database quote reconciler.
  if (project.status === 'converted' || project.status === 'merged') {
    return { action: 'skipped', location_id: null, external_reference: reference };
  }

  return syncSiteLocation(admin, {
    sourceType: 'project_number',
    sourceId: project.id,
    externalReference: reference,
    name: buildSiteLocationName(reference || 'Project', buildProjectSiteLabel(project)),
    description: project.description?.trim() || project.title?.trim() || null,
    isActive: shouldBeActive,
    actorUserId,
  });
}
