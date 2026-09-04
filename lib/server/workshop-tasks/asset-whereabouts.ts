import {
  addIsoDateDays,
  enumerateInclusiveIsoDates,
  fromUntyped,
  type AdminClient,
} from '@/lib/server/daily-allocation/auth';
import { snapshotVersionFromValue } from '@/lib/server/daily-allocation/legacy-adapter';
import {
  applyCatalogueFill,
  loadWhereaboutsCatalogueFills,
  resolveCatalogueFill,
} from '@/lib/server/workshop-tasks/job-catalogue-enrich';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';
import { inferAssetMeterUnit } from '@/lib/workshop-tasks/asset-meter';
import type {
  WhereaboutsJobRef,
  WorkshopAssetType,
  WorkshopAssetWhereaboutsEvent,
  WorkshopAssetWhereaboutsPayload,
} from '@/types/workshop-asset-whereabouts';

export const WHEREABOUTS_WINDOW_DAYS = 14;
export const WHEREABOUTS_INSPECTION_LIMIT = 10;
export const LONDON_TIME_ZONE = 'Europe/London';
export const ASSET_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const WHEREABOUTS_FORBIDDEN_RESPONSE_KEYS = [
  'tracker_id',
  'speed',
  'heading',
  'commercial_status',
  'notes',
  'phone_number',
  'signature_data',
] as const;

export const PUBLICATION_SELECT =
  'id, work_date, revision_no, published_at, scope_team_id, snapshot_version';
export const V1_PLANT_SELECT =
  'id, publication_id, plant_kind, plant_id, job_source_type, job_source_id, job_code, site_address';
export const V2_PLANT_SELECT =
  'id, publication_id, published_visit_id, plant_kind, plant_id, job_code, site_address, job_source_type, job_source_id';
export const V2_VISIT_SELECT =
  'id, job_code, site_address, customer_name, title, job_source_type, job_source_id';
export const PLANT_INSPECTION_SELECT =
  'id, user_id, inspection_date, submitted_at, current_mileage, job_code, job_site_address, job_source_type, job_source_id';
export const VEHICLE_INSPECTION_SELECT =
  'id, user_id, inspection_date, submitted_at, current_mileage';
export const PROFILE_NAME_SELECT = 'id, full_name';
export const PROFILE_PHONE_SELECT = 'phone_number';

type PublicationHeader = {
  id: string;
  work_date: string;
  revision_no: number;
  published_at: string;
  scope_team_id: string | null;
  snapshot_version?: number | null;
};

type V1PlantRow = {
  id: string;
  publication_id: string;
  plant_kind: string;
  plant_id: string | null;
  job_source_type: WhereaboutsJobRef['sourceType'];
  job_source_id: string | null;
  job_code: string;
  site_address: string;
};

type V2PlantRow = {
  id: string;
  publication_id: string;
  published_visit_id: string;
  plant_kind: string;
  plant_id: string | null;
  job_code: string;
  site_address: string;
  job_source_type: WhereaboutsJobRef['sourceType'];
  job_source_id: string | null;
};

type V2VisitRow = {
  id: string;
  job_code: string;
  site_address: string;
  customer_name: string | null;
  title: string | null;
  job_source_type: WhereaboutsJobRef['sourceType'];
  job_source_id: string | null;
};

type InspectionRow = {
  id: string;
  user_id: string;
  inspection_date: string;
  submitted_at: string | null;
  current_mileage: number | null;
  job_code?: string | null;
  job_site_address?: string | null;
  job_source_type?: WhereaboutsJobRef['sourceType'];
  job_source_id?: string | null;
};

export function inspectionOccurredAt(
  row: Pick<InspectionRow, 'submitted_at' | 'inspection_date'>
): string {
  return row.submitted_at || `${row.inspection_date}T12:00:00.000Z`;
}

export function compareInspectionsNewestFirst(
  left: Pick<InspectionRow, 'id' | 'submitted_at' | 'inspection_date'>,
  right: Pick<InspectionRow, 'id' | 'submitted_at' | 'inspection_date'>
): number {
  const leftAt = inspectionOccurredAt(left);
  const rightAt = inspectionOccurredAt(right);
  if (leftAt !== rightAt) return leftAt < rightAt ? 1 : -1;
  if (left.inspection_date !== right.inspection_date) {
    return left.inspection_date < right.inspection_date ? 1 : -1;
  }
  return left.id < right.id ? 1 : -1;
}

export function sortInspectionsNewestFirst<
  T extends Pick<InspectionRow, 'id' | 'submitted_at' | 'inspection_date'>,
>(rows: T[]): T[] {
  return [...rows].sort(compareInspectionsNewestFirst);
}

export function selectNewestSubmittedInspections<
  T extends Pick<InspectionRow, 'id' | 'submitted_at' | 'inspection_date'>,
>(
  submittedWithTimestamp: T[],
  submittedWithoutTimestamp: T[],
  limit = WHEREABOUTS_INSPECTION_LIMIT
): T[] {
  const byId = new Map<string, T>();
  for (const row of [...submittedWithTimestamp, ...submittedWithoutTimestamp]) {
    byId.set(row.id, row);
  }
  return sortInspectionsNewestFirst([...byId.values()]).slice(0, limit);
}

export function isWorkshopAssetType(value: string): value is WorkshopAssetType {
  return value === 'van' || value === 'plant' || value === 'hgv';
}

export function isAssetIdUuid(value: string): boolean {
  return ASSET_ID_UUID_RE.test(value);
}

export function londonCivilDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LONDON_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function trailingLondonWorkDates(
  now: Date,
  days = WHEREABOUTS_WINDOW_DAYS
): { start: string; end: string; dates: string[] } {
  const end = londonCivilDate(now);
  const start = addIsoDateDays(end, -(days - 1));
  return { start, end, dates: enumerateInclusiveIsoDates(start, end) };
}

export function whereaboutsPublicationScopeKey(publication: {
  work_date: string;
  scope_team_id: string | null;
}): string {
  return `${publication.work_date}:${publication.scope_team_id ?? 'legacy-null'}`;
}

export function selectLatestWhereaboutsPublications<T extends {
  work_date: string;
  revision_no: number;
  published_at: string;
  scope_team_id: string | null;
}>(publications: T[]): T[] {
  const latest = new Map<string, T>();
  for (const publication of publications) {
    const key = whereaboutsPublicationScopeKey(publication);
    const current = latest.get(key);
    if (!current) {
      latest.set(key, publication);
      continue;
    }
    if (publication.revision_no !== current.revision_no) {
      if (publication.revision_no > current.revision_no) latest.set(key, publication);
      continue;
    }
    if (publication.published_at > current.published_at) latest.set(key, publication);
  }
  return Array.from(latest.values());
}

export function mergeWhereaboutsEvents(
  events: WorkshopAssetWhereaboutsEvent[]
): WorkshopAssetWhereaboutsEvent[] {
  return [...events].sort((left, right) => {
    if (left.occurredAt !== right.occurredAt) {
      return left.occurredAt < right.occurredAt ? 1 : -1;
    }
    if (left.source !== right.source) {
      return left.source === 'inspection' ? -1 : 1;
    }
    return left.id < right.id ? 1 : -1;
  });
}

export function fleetHistoryHref(assetType: WorkshopAssetType, assetId: string): string {
  if (assetType === 'plant') return `/fleet/plant/${assetId}/history`;
  if (assetType === 'hgv') return `/fleet/hgvs/${assetId}/history`;
  return `/fleet/vans/${assetId}/history`;
}

export function collectForbiddenWhereaboutsKeys(value: unknown, found = new Set<string>()): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectForbiddenWhereaboutsKeys(entry, found);
    return [...found];
  }
  if (!value || typeof value !== 'object') return [...found];
  for (const [key, child] of Object.entries(value)) {
    if ((WHEREABOUTS_FORBIDDEN_RESPONSE_KEYS as readonly string[]).includes(key)) {
      found.add(key);
    }
    collectForbiddenWhereaboutsKeys(child, found);
  }
  return [...found];
}

async function resolveAsset(
  admin: AdminClient,
  assetType: WorkshopAssetType,
  assetId: string
): Promise<WorkshopAssetWhereaboutsPayload['asset'] | null> {
  if (assetType === 'plant') {
    const { data, error } = await admin
      .from('plant')
      .select('id, plant_id, nickname, reg_number')
      .eq('id', assetId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      type: 'plant',
      label: formatFleetAssetLabel({
        identifier: data.plant_id || 'Unknown Plant',
        nickname: data.nickname,
      }),
      plantId: data.plant_id,
      regNumber: data.reg_number,
    };
  }

  const table = assetType === 'hgv' ? 'hgvs' : 'vans';
  const { data, error } = await admin
    .from(table)
    .select('id, reg_number, nickname')
    .eq('id', assetId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    type: assetType,
    label: formatFleetAssetLabel({
      identifier: data.reg_number || 'Unknown Asset',
      nickname: data.nickname,
    }),
    plantId: null,
    regNumber: data.reg_number,
  };
}

async function loadAllocationEvents(
  admin: AdminClient,
  plantId: string,
  window: { start: string; end: string }
): Promise<{ events: WorkshopAssetWhereaboutsEvent[]; refs: WhereaboutsJobRef[] }> {
  const { data: publications, error: publicationError } = await fromUntyped<PublicationHeader>(
    admin,
    'daily_allocation_publications'
  )
    .select(PUBLICATION_SELECT)
    .gte('work_date', window.start)
    .lte('work_date', window.end);
  if (publicationError) throw publicationError;

  const latest = selectLatestWhereaboutsPublications(publications || []);
  const latestV1Ids = latest
    .filter((row) => snapshotVersionFromValue(row.snapshot_version) === 1)
    .map((row) => row.id);
  const latestV2Ids = latest
    .filter((row) => snapshotVersionFromValue(row.snapshot_version) === 2)
    .map((row) => row.id);
  const publicationById = new Map(latest.map((row) => [row.id, row]));

  const [v1Result, v2Result] = await Promise.all([
    latestV1Ids.length
      ? admin
          .from('daily_allocation_plant_items')
          .select(V1_PLANT_SELECT)
          .eq('plant_kind', 'registered')
          .eq('plant_id', plantId)
          .in('publication_id', latestV1Ids)
      : Promise.resolve({ data: [] as V1PlantRow[], error: null }),
    latestV2Ids.length
      ? fromUntyped<V2PlantRow>(admin, 'daily_allocation_published_plant')
          .select(V2_PLANT_SELECT)
          .eq('plant_kind', 'registered')
          .eq('plant_id', plantId)
          .in('publication_id', latestV2Ids)
      : Promise.resolve({ data: [] as V2PlantRow[], error: null }),
  ]);
  if (v1Result.error) throw v1Result.error;
  if (v2Result.error) throw v2Result.error;

  const v2Rows = (v2Result.data || []) as V2PlantRow[];
  const visitIds = [...new Set(v2Rows.map((row) => row.published_visit_id).filter(Boolean))];
  const { data: visits, error: visitError } = visitIds.length
    ? await fromUntyped<V2VisitRow>(admin, 'daily_allocation_published_visits')
        .select(V2_VISIT_SELECT)
        .in('id', visitIds)
    : { data: [] as V2VisitRow[], error: null };
  if (visitError) throw visitError;
  const visitById = new Map((visits || []).map((row) => [row.id, row]));

  const events: WorkshopAssetWhereaboutsEvent[] = [];
  const refs: WhereaboutsJobRef[] = [];

  for (const row of (v1Result.data || []) as V1PlantRow[]) {
    const publication = publicationById.get(row.publication_id);
    if (!publication) continue;
    events.push({
      id: `allocation:${row.id}`,
      source: 'allocation',
      occurredAt: publication.published_at,
      jobCode: row.job_code || null,
      siteAddress: row.site_address || null,
      customerName: null,
      jobTitle: null,
      driverName: null,
      inspectionId: null,
    });
    refs.push({
      jobCode: row.job_code,
      sourceType: row.job_source_type,
      sourceId: row.job_source_id,
    });
  }

  for (const row of v2Rows) {
    const publication = publicationById.get(row.publication_id);
    if (!publication) continue;
    const visit = visitById.get(row.published_visit_id);
    events.push({
      id: `allocation:${row.id}`,
      source: 'allocation',
      occurredAt: publication.published_at,
      jobCode: visit?.job_code || row.job_code || null,
      siteAddress: visit?.site_address || row.site_address || null,
      customerName: visit?.customer_name || null,
      jobTitle: visit?.title || null,
      driverName: null,
      inspectionId: null,
    });
    refs.push({
      jobCode: visit?.job_code || row.job_code,
      sourceType: visit?.job_source_type || row.job_source_type || null,
      sourceId: visit?.job_source_id || row.job_source_id || null,
    });
  }

  return { events, refs };
}

function submittedInspectionQuery(
  admin: AdminClient,
  assetType: WorkshopAssetType,
  assetId: string
) {
  if (assetType === 'plant') {
    return admin
      .from('plant_inspections')
      .select(PLANT_INSPECTION_SELECT)
      .eq('plant_id', assetId);
  }
  if (assetType === 'hgv') {
    return admin
      .from('hgv_inspections')
      .select(VEHICLE_INSPECTION_SELECT)
      .eq('hgv_id', assetId);
  }
  return admin
    .from('van_inspections')
    .select(VEHICLE_INSPECTION_SELECT)
    .eq('van_id', assetId);
}

async function loadSubmittedInspections(
  admin: AdminClient,
  assetType: WorkshopAssetType,
  assetId: string
): Promise<InspectionRow[]> {
  const [datedResult, undatedResult] = await Promise.all([
    submittedInspectionQuery(admin, assetType, assetId)
      .eq('status', 'submitted')
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false })
      .order('inspection_date', { ascending: false })
      .limit(WHEREABOUTS_INSPECTION_LIMIT),
    submittedInspectionQuery(admin, assetType, assetId)
      .eq('status', 'submitted')
      .is('submitted_at', null)
      .order('inspection_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(WHEREABOUTS_INSPECTION_LIMIT),
  ]);
  if (datedResult.error) throw datedResult.error;
  if (undatedResult.error) throw undatedResult.error;
  return selectNewestSubmittedInspections(
    (datedResult.data || []) as InspectionRow[],
    (undatedResult.data || []) as InspectionRow[]
  );
}

async function loadInspectionEvents(
  admin: AdminClient,
  assetType: WorkshopAssetType,
  assetId: string
): Promise<{
  events: WorkshopAssetWhereaboutsEvent[];
  refs: WhereaboutsJobRef[];
  lastCheckAt: string | null;
  lastDriverName: string | null;
  lastDriverUserId: string | null;
  latestInspectionMileage: number | null;
}> {
  const rows = await loadSubmittedInspections(admin, assetType, assetId);
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const { data: profiles, error: profileError } = userIds.length
    ? await admin.from('profiles').select(PROFILE_NAME_SELECT).in('id', userIds)
    : { data: [] as Array<{ id: string; full_name: string | null }>, error: null };
  if (profileError) throw profileError;
  const nameById = new Map((profiles || []).map((row) => [row.id, row.full_name || null]));

  const events: WorkshopAssetWhereaboutsEvent[] = [];
  const refs: WhereaboutsJobRef[] = [];
  for (const row of rows) {
    const occurredAt = inspectionOccurredAt(row);
    events.push({
      id: `inspection:${row.id}`,
      source: 'inspection',
      occurredAt,
      jobCode: assetType === 'plant' ? row.job_code || null : null,
      siteAddress: assetType === 'plant' ? row.job_site_address || null : null,
      customerName: null,
      jobTitle: null,
      driverName: nameById.get(row.user_id) || null,
      inspectionId: row.id,
    });
    if (assetType === 'plant') {
      refs.push({
        jobCode: row.job_code || null,
        sourceType: row.job_source_type || null,
        sourceId: row.job_source_id || null,
      });
    }
  }

  const newest = rows[0] || null;
  return {
    events,
    refs,
    lastCheckAt: newest ? newest.submitted_at || newest.inspection_date : null,
    lastDriverName: newest ? nameById.get(newest.user_id) || null : null,
    lastDriverUserId: newest?.user_id || null,
    latestInspectionMileage: newest?.current_mileage ?? null,
  };
}

async function loadMeter(
  admin: AdminClient,
  assetType: WorkshopAssetType,
  assetId: string,
  inspectionMileage: number | null
): Promise<WorkshopAssetWhereaboutsPayload['meter']> {
  const unit = inferAssetMeterUnit(assetType);
  if (!unit) return null;
  const fk = assetType === 'plant' ? 'plant_id' : assetType === 'hgv' ? 'hgv_id' : 'van_id';
  const meterColumn = assetType === 'plant' ? 'current_hours' : 'current_mileage';
  const { data, error } = await admin
    .from('vehicle_maintenance')
    .select(`id, ${meterColumn}`)
    .eq(fk, assetId)
    .order('last_updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  const maintenanceValue =
    data && typeof (data as Record<string, unknown>)[meterColumn] === 'number'
      ? ((data as Record<string, number>)[meterColumn] as number)
      : null;
  if (maintenanceValue != null) {
    return { value: maintenanceValue, unit, source: 'maintenance' };
  }
  if (inspectionMileage != null) {
    return { value: inspectionMileage, unit, source: 'inspection' };
  }
  return null;
}

export async function loadAssetWhereabouts(params: {
  admin: AdminClient;
  assetType: WorkshopAssetType;
  assetId: string;
  canOpenFleetHistory: boolean;
  now?: Date;
}): Promise<WorkshopAssetWhereaboutsPayload | null> {
  const asset = await resolveAsset(params.admin, params.assetType, params.assetId);
  if (!asset) return null;

  const window = trailingLondonWorkDates(params.now ?? new Date());
  const inspection = await loadInspectionEvents(params.admin, params.assetType, params.assetId);
  const allocation =
    params.assetType === 'plant'
      ? await loadAllocationEvents(params.admin, params.assetId, window)
      : { events: [] as WorkshopAssetWhereaboutsEvent[], refs: [] as WhereaboutsJobRef[] };

  const fills = await loadWhereaboutsCatalogueFills(params.admin, [
    ...allocation.refs,
    ...inspection.refs,
  ]);

  const events = mergeWhereaboutsEvents([
    ...allocation.events.map((event, index) =>
      applyCatalogueFill(event, resolveCatalogueFill(fills, allocation.refs[index] || {
        jobCode: event.jobCode,
        sourceType: null,
        sourceId: null,
      }))
    ),
    ...inspection.events.map((event, index) =>
      applyCatalogueFill(event, resolveCatalogueFill(fills, inspection.refs[index] || {
        jobCode: event.jobCode,
        sourceType: null,
        sourceId: null,
      }))
    ),
  ]);

  let lastDriverPhone: string | null = null;
  if (inspection.lastDriverUserId) {
    const { data: phoneRow, error: phoneError } = await params.admin
      .from('profiles')
      .select(PROFILE_PHONE_SELECT)
      .eq('id', inspection.lastDriverUserId)
      .maybeSingle();
    if (phoneError) throw phoneError;
    lastDriverPhone = phoneRow?.phone_number?.trim() || null;
  }

  const payload: WorkshopAssetWhereaboutsPayload = {
    asset,
    lastCheckAt: inspection.lastCheckAt,
    lastDriverName: inspection.lastDriverName,
    lastDriverPhone,
    meter: await loadMeter(
      params.admin,
      params.assetType,
      params.assetId,
      inspection.latestInspectionMileage
    ),
    fleetHistoryHref: fleetHistoryHref(params.assetType, params.assetId),
    canOpenFleetHistory: params.canOpenFleetHistory,
    events,
  };

  return payload;
}
