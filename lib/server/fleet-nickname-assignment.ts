import type { FleetAssetType, InventoryAdminClient } from './inventory-locations';
import { summarizeFleetAssignment, type CurrentFleetAssignmentSummary } from './profile-fleet-assignments';

export type { FleetAssetType };

export type FleetNicknameAssignmentAction = 'keep' | 'clear' | 'assign';

export interface FleetNicknameAssignmentIntent {
  action: FleetNicknameAssignmentAction;
  userId?: string | null;
  expectedAssignmentId: string | null;
}

export interface FleetNicknameAssignmentResult {
  nickname: string | null;
  assignment_id: string | null;
  assigned_user_id: string | null;
  action: FleetNicknameAssignmentAction;
  location_id?: string | null;
}

export interface AssetFleetAssignmentLookup {
  assignmentId: string;
  userId: string;
  fullName: string | null;
}

interface AssignmentLookupRow {
  id: string;
  user_id: string;
  profile?: { full_name: string | null } | { full_name: string | null }[] | null;
}

function pickRelation<T>(relation: T | T[] | null | undefined): T | null {
  if (!relation) return null;
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

function assetColumn(assetType: FleetAssetType): 'linked_van_id' | 'linked_hgv_id' | 'linked_plant_id' {
  if (assetType === 'van') return 'linked_van_id';
  if (assetType === 'hgv') return 'linked_hgv_id';
  return 'linked_plant_id';
}

export function parseFleetNicknameAssignmentIntent(
  body: unknown
): FleetNicknameAssignmentIntent | null {
  if (!body || typeof body !== 'object') return null;
  const assignment = (body as { assignment?: unknown }).assignment;
  if (!assignment || typeof assignment !== 'object') return null;

  const action = (assignment as { action?: unknown }).action;
  if (action !== 'keep' && action !== 'clear' && action !== 'assign') {
    throw new Error('Invalid assignment.action');
  }

  if (!('expectedAssignmentId' in assignment)) {
    throw new Error('assignment.expectedAssignmentId is required');
  }
  const expectedRaw = (assignment as { expectedAssignmentId: unknown }).expectedAssignmentId;
  const expectedAssignmentId =
    expectedRaw === null
      ? null
      : typeof expectedRaw === 'string'
        ? expectedRaw
        : (() => {
            throw new Error('Invalid assignment.expectedAssignmentId');
          })();

  if (action === 'assign') {
    const userId = (assignment as { userId?: unknown }).userId;
    if (typeof userId !== 'string' || !userId.trim()) {
      throw new Error('assignment.userId is required when action is assign');
    }
    return {
      action,
      userId: userId.trim(),
      expectedAssignmentId,
    };
  }

  return {
    action,
    expectedAssignmentId,
  };
}

export function isStaleAssignmentError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('STALE_ASSIGNMENT');
}

export async function getCurrentAssignmentForAsset(
  admin: InventoryAdminClient,
  assetType: FleetAssetType,
  assetId: string
): Promise<AssetFleetAssignmentLookup | null> {
  const column = assetColumn(assetType);
  const { data, error } = await admin
    .from('profile_fleet_assignments')
    .select(`
      id,
      user_id,
      profile:profiles!profile_fleet_assignments_user_id_fkey(full_name)
    `)
    .eq(column, assetId)
    .is('ended_at', null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as AssignmentLookupRow;
  const profile = pickRelation(row.profile);
  return {
    assignmentId: row.id,
    userId: row.user_id,
    fullName: profile?.full_name || null,
  };
}

export async function applyFleetAssetNicknameAssignment(
  admin: InventoryAdminClient,
  payload: {
    assetType: FleetAssetType;
    assetId: string;
    manualNickname: string | null;
    assignment: FleetNicknameAssignmentIntent;
    actorUserId: string;
  }
): Promise<FleetNicknameAssignmentResult> {
  const { data, error } = await admin.rpc('admin_apply_fleet_asset_nickname_assignment', {
    p_asset_type: payload.assetType,
    p_asset_id: payload.assetId,
    p_manual_nickname: payload.manualNickname,
    p_assignment_action: payload.assignment.action,
    p_assigned_user_id: payload.assignment.action === 'assign' ? payload.assignment.userId || null : null,
    p_expected_assignment_id: payload.assignment.expectedAssignmentId,
    p_actor_user_id: payload.actorUserId,
  });

  if (error) throw error;

  const result = data as FleetNicknameAssignmentResult | null;
  if (!result) {
    throw new Error('Nickname assignment RPC returned no result');
  }
  return result;
}

export async function clearFleetAssignmentForAsset(
  admin: InventoryAdminClient,
  payload: {
    assetType: FleetAssetType;
    assetId: string;
    actorUserId: string | null;
  }
): Promise<number> {
  const { data, error } = await admin.rpc('clear_fleet_assignment_for_asset', {
    p_asset_type: payload.assetType,
    p_asset_id: payload.assetId,
    p_actor_user_id: payload.actorUserId,
  });

  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

export async function getCurrentFleetAssignmentSummaryForAsset(
  admin: InventoryAdminClient,
  assetType: FleetAssetType,
  assetId: string
): Promise<CurrentFleetAssignmentSummary | null> {
  const column = assetColumn(assetType);
  const { data, error } = await admin
    .from('profile_fleet_assignments')
    .select(`
      *,
      van:vans!profile_fleet_assignments_linked_van_id_fkey(reg_number, nickname),
      hgv:hgvs!profile_fleet_assignments_linked_hgv_id_fkey(reg_number, nickname),
      plant:plant!profile_fleet_assignments_linked_plant_id_fkey(plant_id, reg_number, nickname)
    `)
    .eq(column, assetId)
    .is('ended_at', null)
    .maybeSingle();

  if (error) throw error;
  return summarizeFleetAssignment(data as Parameters<typeof summarizeFleetAssignment>[0]);
}
