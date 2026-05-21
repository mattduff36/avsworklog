import { createAdminClient } from '@/lib/supabase/admin';
import type { Database, Json } from '@/types/database';
import type {
  ReminderActionStatus,
  ReminderActionWithAsset,
  ReminderAssetType,
  ReminderPriority,
  ReminderStatus,
} from '@/types/reminders';

type AdminClient = ReturnType<typeof createAdminClient>;
type ReminderActionInsert = Database['public']['Tables']['reminder_actions']['Insert'];
type ReminderActionRow = Database['public']['Tables']['reminder_actions']['Row'];
type ReminderRow = Database['public']['Tables']['reminders']['Row'];

interface BaseAssetRow {
  id: string;
  nickname?: string | null;
}

interface VanAssetRow extends BaseAssetRow {
  reg_number?: string | null;
}

interface PlantAssetRow extends BaseAssetRow {
  plant_id?: string | null;
  reg_number?: string | null;
}

interface OverdueAsset {
  assetId: string;
  assetType: ReminderAssetType;
  assetLabel: string;
  assetRoute: string;
  lastSubmittedAt: string | null;
  daysOverdue: number;
  dedupeKey: string;
  title: string;
  description: string;
  priority: ReminderPriority;
}

interface ReminderActionRowWithReminders extends ReminderActionRow {
  reminders?: Array<Pick<ReminderRow, 'id' | 'status'>> | null;
}

export interface FleetInspectionGenerationSummary {
  inserted: number;
  updated: number;
  resolved: number;
  cancelledReminders: number;
  openCount: number;
}

const REMINDER_WORKFLOW_KEY = 'fleet_inspection_overdue';
const OVERDUE_DAYS_THRESHOLD = 28;

function getIsoDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function getDaysBetween(dateA: Date, dateB: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((dateA.getTime() - dateB.getTime()) / msPerDay);
}

function getReminderActionStatusCounts(reminders: Array<Pick<ReminderRow, 'status'>>): ReminderActionWithAsset['reminders_count'] {
  return reminders.reduce(
    (counts, reminder) => {
      counts.total += 1;
      if (reminder.status === 'pending') counts.pending += 1;
      if (reminder.status === 'actioned') counts.actioned += 1;
      if (reminder.status === 'cancelled') counts.cancelled += 1;
      return counts;
    },
    {
      total: 0,
      pending: 0,
      actioned: 0,
      cancelled: 0,
    },
  );
}

function getJsonStringValue(metadata: Json | null | undefined, key: string): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = metadata[key];
  return typeof value === 'string' ? value : null;
}

function buildVanLabel(row: VanAssetRow): string {
  const registration = row.reg_number?.trim() || 'Unknown Van';
  return row.nickname?.trim() ? `${registration} (${row.nickname.trim()})` : registration;
}

function buildPlantLabel(row: PlantAssetRow): string {
  const primary = row.plant_id?.trim() || row.reg_number?.trim() || 'Unknown Plant';
  return row.nickname?.trim() ? `${primary} (${row.nickname.trim()})` : primary;
}

function buildAssetRoute(assetType: ReminderAssetType, assetId: string): string {
  if (assetType === 'van') return `/fleet/vans/${assetId}/history`;
  if (assetType === 'hgv') return `/fleet/hgvs/${assetId}/history`;
  return `/fleet/plant/${assetId}/history`;
}

function buildActionDescription(params: {
  assetLabel: string;
  assetType: ReminderAssetType;
  lastSubmittedAt: string | null;
  daysOverdue: number;
}): string {
  const assetName = params.assetType === 'hgv' ? 'HGV' : params.assetType === 'plant' ? 'plant asset' : 'van';
  if (!params.lastSubmittedAt) {
    return `${params.assetLabel} has no submitted daily check on record. Assign a reminder so a user can complete an inspection for this ${assetName}.`;
  }

  return `${params.assetLabel} is overdue for a submitted daily check. The latest submitted inspection was ${params.daysOverdue} days ago on ${params.lastSubmittedAt}.`;
}

function buildOpenActionRecord(asset: OverdueAsset, nowIso: string): ReminderActionInsert {
  return {
    workflow_key: REMINDER_WORKFLOW_KEY,
    source_type: 'system_generated',
    dedupe_key: asset.dedupeKey,
    status: 'open',
    priority: asset.priority,
    title: asset.title,
    description: asset.description,
    asset_type: asset.assetType,
    metadata: {
      asset_label: asset.assetLabel,
      asset_route: asset.assetRoute,
      days_overdue: asset.daysOverdue,
      last_submitted_inspection_date: asset.lastSubmittedAt,
      threshold_days: OVERDUE_DAYS_THRESHOLD,
    },
    first_detected_at: nowIso,
    last_detected_at: nowIso,
    ...(asset.assetType === 'van' ? { van_id: asset.assetId } : {}),
    ...(asset.assetType === 'plant' ? { plant_id: asset.assetId } : {}),
    ...(asset.assetType === 'hgv' ? { hgv_id: asset.assetId } : {}),
  };
}

async function loadLatestInspectionDates(
  admin: AdminClient,
  tableName: 'van_inspections' | 'plant_inspections' | 'hgv_inspections',
  assetKey: 'van_id' | 'plant_id' | 'hgv_id',
  assetIds: string[],
): Promise<Map<string, string>> {
  if (assetIds.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await admin
    .from(tableName)
    .select(`${assetKey}, inspection_date, inspection_end_date, status`)
    .eq('status', 'submitted')
    .in(assetKey, assetIds)
    .order(assetKey, { ascending: true })
    .order('inspection_end_date', { ascending: false })
    .order('inspection_date', { ascending: false });

  if (error) {
    throw error;
  }

  const latestByAsset = new Map<string, string>();
  for (const row of (data || []) as Array<Record<string, string | null>>) {
    const assetId = row[assetKey];
    if (!assetId || latestByAsset.has(assetId)) {
      continue;
    }

    const lastSubmittedAt = row.inspection_end_date || row.inspection_date;
    if (lastSubmittedAt) {
      latestByAsset.set(assetId, lastSubmittedAt);
    }
  }

  return latestByAsset;
}

async function loadOverdueAssets(admin: AdminClient): Promise<OverdueAsset[]> {
  const [vansResult, hgvsResult, plantResult] = await Promise.all([
    admin.from('vans').select('id, reg_number, nickname').eq('status', 'active'),
    admin.from('hgvs').select('id, reg_number, nickname').eq('status', 'active'),
    admin.from('plant').select('id, plant_id, reg_number, nickname').eq('status', 'active'),
  ]);

  if (vansResult.error) throw vansResult.error;
  if (hgvsResult.error) throw hgvsResult.error;
  if (plantResult.error) throw plantResult.error;

  const vanRows = (vansResult.data || []) as VanAssetRow[];
  const hgvRows = (hgvsResult.data || []) as VanAssetRow[];
  const plantRows = (plantResult.data || []) as PlantAssetRow[];

  const [vanLatest, hgvLatest, plantLatest] = await Promise.all([
    loadLatestInspectionDates(admin, 'van_inspections', 'van_id', vanRows.map((row) => row.id)),
    loadLatestInspectionDates(admin, 'hgv_inspections', 'hgv_id', hgvRows.map((row) => row.id)),
    loadLatestInspectionDates(admin, 'plant_inspections', 'plant_id', plantRows.map((row) => row.id)),
  ]);

  const today = new Date();
  function mapAssetRow(
    assetType: ReminderAssetType,
    row: VanAssetRow | PlantAssetRow,
    lastSubmittedAt: string | null,
  ): OverdueAsset | null {
    const lastSubmittedDate = lastSubmittedAt ? new Date(lastSubmittedAt) : null;
    const daysOverdue = lastSubmittedDate ? getDaysBetween(today, lastSubmittedDate) : OVERDUE_DAYS_THRESHOLD;

    if (lastSubmittedDate && daysOverdue < OVERDUE_DAYS_THRESHOLD) {
      return null;
    }

    const assetLabel = assetType === 'plant' ? buildPlantLabel(row as PlantAssetRow) : buildVanLabel(row as VanAssetRow);
    const assetRoute = buildAssetRoute(assetType, row.id);
    const normalizedLastSubmittedAt = lastSubmittedAt ? getIsoDateOnly(lastSubmittedDate!) : null;

    return {
      assetId: row.id,
      assetType,
      assetLabel,
      assetRoute,
      lastSubmittedAt: normalizedLastSubmittedAt,
      daysOverdue,
      dedupeKey: `${REMINDER_WORKFLOW_KEY}:${assetType}:${row.id}`,
      title: `${assetLabel} requires an inspection`,
      description: buildActionDescription({
        assetLabel,
        assetType,
        lastSubmittedAt: normalizedLastSubmittedAt,
        daysOverdue,
      }),
      priority: 'high',
    };
  }

  return [
    ...vanRows.map((row) => mapAssetRow('van', row, vanLatest.get(row.id) || null)),
    ...hgvRows.map((row) => mapAssetRow('hgv', row, hgvLatest.get(row.id) || null)),
    ...plantRows.map((row) => mapAssetRow('plant', row, plantLatest.get(row.id) || null)),
  ].filter((asset): asset is OverdueAsset => Boolean(asset)).sort((left, right) => right.daysOverdue - left.daysOverdue || left.assetLabel.localeCompare(right.assetLabel));
}

export async function generateFleetInspectionReminderActions(): Promise<FleetInspectionGenerationSummary> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const overdueAssets = await loadOverdueAssets(admin);

  const { data: openActionRows, error: openActionError } = await admin
    .from('reminder_actions')
    .select('id, dedupe_key, metadata')
    .eq('workflow_key', REMINDER_WORKFLOW_KEY)
    .eq('status', 'open');

  if (openActionError) {
    throw openActionError;
  }

  const openActionsByDedupeKey = new Map(
    ((openActionRows || []) as Array<Pick<ReminderActionRow, 'id' | 'dedupe_key' | 'metadata'>>).map((row) => [row.dedupe_key, row]),
  );

  let inserted = 0;
  let updated = 0;

  for (const asset of overdueAssets) {
    const existing = openActionsByDedupeKey.get(asset.dedupeKey);
    const nextRecord = buildOpenActionRecord(asset, nowIso);

    if (!existing) {
      const { error } = await admin.from('reminder_actions').insert(nextRecord);
      if (error) throw error;
      inserted += 1;
      continue;
    }

    const { error } = await admin
      .from('reminder_actions')
      .update({
        title: nextRecord.title,
        description: nextRecord.description,
        priority: nextRecord.priority,
        metadata: nextRecord.metadata,
        last_detected_at: nowIso,
        resolved_at: null,
        resolved_by: null,
        ...(asset.assetType === 'van' ? { van_id: asset.assetId, plant_id: null, hgv_id: null } : {}),
        ...(asset.assetType === 'plant' ? { van_id: null, plant_id: asset.assetId, hgv_id: null } : {}),
        ...(asset.assetType === 'hgv' ? { van_id: null, plant_id: null, hgv_id: asset.assetId } : {}),
      })
      .eq('id', existing.id);

    if (error) throw error;
    updated += 1;
  }

  const overdueDedupeKeys = new Set(overdueAssets.map((asset) => asset.dedupeKey));
  const actionIdsToResolve = ((openActionRows || []) as Array<Pick<ReminderActionRow, 'id' | 'dedupe_key'>>)
    .filter((row) => !overdueDedupeKeys.has(row.dedupe_key))
    .map((row) => row.id);

  let resolved = 0;
  let cancelledReminders = 0;

  if (actionIdsToResolve.length > 0) {
    const { error: resolveError } = await admin
      .from('reminder_actions')
      .update({
        status: 'resolved',
        resolved_at: nowIso,
        last_detected_at: nowIso,
      })
      .in('id', actionIdsToResolve);

    if (resolveError) throw resolveError;
    resolved = actionIdsToResolve.length;

    const { data: cancelledRows, error: cancelError } = await admin
      .from('reminders')
      .update({
        status: 'cancelled',
        cancelled_at: nowIso,
      })
      .in('action_id', actionIdsToResolve)
      .eq('status', 'pending')
      .select('id');

    if (cancelError) throw cancelError;
    cancelledReminders = (cancelledRows || []).length;
  }

  return {
    inserted,
    updated,
    resolved,
    cancelledReminders,
    openCount: overdueAssets.length,
  };
}

export function mapReminderActionWithAsset(
  action: ReminderActionRowWithReminders,
): ReminderActionWithAsset {
  const reminders = (action.reminders || []) as Array<Pick<ReminderRow, 'status'>>;

  return {
    id: action.id,
    workflow_key: action.workflow_key,
    source_type: action.source_type,
    dedupe_key: action.dedupe_key,
    status: action.status as ReminderActionStatus,
    priority: action.priority as ReminderPriority,
    title: action.title,
    description: action.description,
    asset_type: action.asset_type as ReminderAssetType | null,
    van_id: action.van_id,
    plant_id: action.plant_id,
    hgv_id: action.hgv_id,
    metadata: (action.metadata || {}) as Record<string, unknown>,
    created_by: action.created_by,
    resolved_by: action.resolved_by,
    first_detected_at: action.first_detected_at,
    last_detected_at: action.last_detected_at,
    resolved_at: action.resolved_at,
    created_at: action.created_at,
    updated_at: action.updated_at,
    asset_label: getJsonStringValue(action.metadata, 'asset_label'),
    asset_route: getJsonStringValue(action.metadata, 'asset_route'),
    reminders_count: getReminderActionStatusCounts(reminders),
  };
}

export function isReminderPending(status: ReminderStatus): boolean {
  return status === 'pending';
}
