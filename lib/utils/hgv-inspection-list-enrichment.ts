import { isUuid } from '@/lib/utils/uuid';

export interface HgvInspectionListBaseRow {
  id: string;
  user_id: string;
  hgv_id: string | null;
}

export interface HgvInspectionVehicleSummary {
  reg_number: string;
  nickname: string | null;
}

export interface HgvInspectionListRelations {
  hgv: HgvInspectionVehicleSummary | null;
  profile: { full_name: string } | null;
  has_reported_defect: boolean;
  has_inform_workshop_task: boolean;
}

export type HgvEnrichedInspectionRow<T extends HgvInspectionListBaseRow> = T & HgvInspectionListRelations;

export interface HgvInspectionListQueryResult<T> {
  data: readonly T[] | null;
  error: unknown;
}

export interface HgvInspectionVehicleRow {
  id: string;
  reg_number: string;
  nickname: string | null;
}

export interface HgvInspectionProfileRow {
  id: string;
  full_name: string | null;
}

export interface HgvInspectionDefectRow {
  inspection_id: string | null;
  status: string | null;
}

export interface HgvInspectionActionRow {
  inspection_id: string | null;
}

export interface HgvInspectionListLookups {
  loadHgvs: (ids: readonly string[]) => Promise<HgvInspectionListQueryResult<HgvInspectionVehicleRow>>;
  loadProfiles: (ids: readonly string[]) => Promise<HgvInspectionListQueryResult<HgvInspectionProfileRow>>;
  loadDefects: (ids: readonly string[]) => Promise<HgvInspectionListQueryResult<HgvInspectionDefectRow>>;
  loadActions: (ids: readonly string[]) => Promise<HgvInspectionListQueryResult<HgvInspectionActionRow>>;
}

const HGV_WARNING = 'Unable to load HGV inspection vehicle details:';
const PROFILE_WARNING = 'Unable to load HGV inspection owner names:';
const DEFECT_WARNING = 'Unable to determine defect status for HGV inspection icons:';
const ACTION_WARNING = 'Unable to determine workshop-task status for HGV inspection icons:';

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

function startLookup<T>(
  load: () => Promise<HgvInspectionListQueryResult<T>>,
): Promise<HgvInspectionListQueryResult<T>> {
  try {
    return Promise.resolve(load());
  } catch (error) {
    return Promise.reject(error);
  }
}

function fulfilledRows<T>(
  settled: PromiseSettledResult<HgvInspectionListQueryResult<T> | null>,
  warning: string,
): readonly T[] {
  if (settled.status !== 'fulfilled' || settled.value == null) return [];
  if (settled.value.error) {
    console.warn(warning, settled.value.error);
    return [];
  }
  return settled.value.data ?? [];
}

function attachRelations<T extends HgvInspectionListBaseRow>(
  rows: readonly T[],
  hgvMap: ReadonlyMap<string, HgvInspectionVehicleSummary>,
  profileMap: ReadonlyMap<string, { full_name: string }>,
  defectInspectionIds: ReadonlySet<string>,
  workshopTaskInspectionIds: ReadonlySet<string>,
): Array<HgvEnrichedInspectionRow<T>> {
  return rows.map((row) => ({
    ...row,
    hgv: row.hgv_id && isUuid(row.hgv_id) ? hgvMap.get(row.hgv_id) ?? null : null,
    profile: profileMap.get(row.user_id) ?? null,
    has_reported_defect: defectInspectionIds.has(row.id),
    has_inform_workshop_task: workshopTaskInspectionIds.has(row.id),
  }));
}

export async function enrichHgvInspectionList<T extends HgvInspectionListBaseRow>(
  rows: readonly T[],
  lookups: HgvInspectionListLookups,
): Promise<Array<HgvEnrichedInspectionRow<T>>> {
  if (rows.length === 0) return [];

  const hgvIds = uniqueStrings(rows.map((row) => row.hgv_id).filter((id) => isUuid(id)));
  const userIds = uniqueStrings(rows.map((row) => row.user_id).filter((id) => isUuid(id)));
  const inspectionIds = uniqueStrings(rows.map((row) => row.id));

  const hgvRequest = hgvIds.length > 0 ? startLookup(() => lookups.loadHgvs(hgvIds)) : null;
  const profileRequest = userIds.length > 0 ? startLookup(() => lookups.loadProfiles(userIds)) : null;
  const defectRequest = inspectionIds.length > 0 ? startLookup(() => lookups.loadDefects(inspectionIds)) : null;
  const actionRequest = inspectionIds.length > 0 ? startLookup(() => lookups.loadActions(inspectionIds)) : null;

  if (!hgvRequest && !profileRequest && !defectRequest && !actionRequest) {
    return attachRelations(rows, new Map(), new Map(), new Set(), new Set());
  }

  const [hgvSettled, profileSettled, defectSettled, actionSettled] = await Promise.allSettled([
    hgvRequest ?? Promise.resolve(null),
    profileRequest ?? Promise.resolve(null),
    defectRequest ?? Promise.resolve(null),
    actionRequest ?? Promise.resolve(null),
  ]);

  const hgvRows = fulfilledRows(hgvSettled, HGV_WARNING);
  const profileRows = fulfilledRows(profileSettled, PROFILE_WARNING);
  const defectRows = fulfilledRows(defectSettled, DEFECT_WARNING);
  const actionRows = fulfilledRows(actionSettled, ACTION_WARNING);

  const failure = [hgvSettled, profileSettled, defectSettled, actionSettled].find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure) throw failure.reason;

  const hgvMap = new Map<string, HgvInspectionVehicleSummary>();
  for (const hgv of hgvRows) {
    if (!hgv.id) continue;
    hgvMap.set(hgv.id, { reg_number: hgv.reg_number, nickname: hgv.nickname ?? null });
  }

  const profileMap = new Map<string, { full_name: string }>();
  for (const profile of profileRows) {
    if (!profile.id || !profile.full_name) continue;
    profileMap.set(profile.id, { full_name: profile.full_name });
  }

  const defectInspectionIds = new Set<string>();
  for (const item of defectRows) {
    if (!item.inspection_id) continue;
    defectInspectionIds.add(item.inspection_id);
  }

  const workshopTaskInspectionIds = new Set<string>();
  for (const action of actionRows) {
    if (!action.inspection_id) continue;
    workshopTaskInspectionIds.add(action.inspection_id);
  }

  return attachRelations(rows, hgvMap, profileMap, defectInspectionIds, workshopTaskInspectionIds);
}
