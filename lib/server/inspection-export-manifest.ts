import type { InspectionItem } from '@/types/inspection';
import type { ModuleName } from '@/types/roles';
import { filterHiddenReportSubjects } from '@/lib/server/system-accounts';

/** Bound each read; continuation also supports a smaller server response cap. */
export const INSPECTION_EXPORT_PAGE_SIZE = 500;

export type InspectionExportSource = 'van' | 'plant' | 'hgv';

export interface InspectionExportManifestRow {
  id: string;
  user_id: string;
  inspection_date: string;
  source: InspectionExportSource;
}

interface ProfileShape {
  full_name?: string | null;
}

interface VanVehicleShape {
  reg_number?: string | null;
  nickname?: string | null;
  vehicle_type?: string | null;
  van_categories?: { name: string } | null;
}

interface PlantShape {
  plant_id?: string | null;
  nickname?: string | null;
  serial_number?: string | null;
  van_categories?: { name: string } | null;
}

interface HgvShape {
  reg_number?: string | null;
  nickname?: string | null;
  hgv_categories?: { name: string } | null;
}

interface BaseInspectionShape {
  id: string;
  user_id: string;
  inspection_date: string;
  inspection_end_date?: string | null;
  current_mileage?: number | null;
  status: string;
  inspector_comments?: string | null;
  signature_data?: string | null;
  signed_at?: string | null;
}

export interface VanInspectionWithRelations extends BaseInspectionShape {
  source: 'van';
  vehicle?: VanVehicleShape | null;
  profile?: ProfileShape | null;
}

export interface PlantInspectionWithRelations extends BaseInspectionShape {
  source: 'plant';
  plant?: PlantShape | null;
  profile?: ProfileShape | null;
  is_hired_plant?: boolean | null;
  hired_plant_id_serial?: string | null;
  hired_plant_description?: string | null;
  hired_plant_hiring_company?: string | null;
  job_code?: string | null;
  job_site_address?: string | null;
}

export interface HgvInspectionWithRelations extends BaseInspectionShape {
  source: 'hgv';
  hgv?: HgvShape | null;
  profile?: ProfileShape | null;
}

export type DailyCheckInspection = VanInspectionWithRelations | PlantInspectionWithRelations | HgvInspectionWithRelations;

interface InspectionExportPage {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}

export interface InspectionExportQuery {
  neq(column: string, value: string): InspectionExportQuery;
  gte(column: string, value: string): InspectionExportQuery;
  lte(column: string, value: string): InspectionExportQuery;
  in(column: string, values: readonly string[]): InspectionExportQuery;
  order(column: string, options: { ascending: boolean }): InspectionExportQuery;
  range(from: number, to: number): Promise<InspectionExportPage>;
}

export interface InspectionExportReader {
  from(table: string): {
    select(columns: string): InspectionExportQuery;
  };
}

export interface InspectionExportScopeArgs {
  dateFrom: string;
  dateTo: string;
  availableModules: readonly ModuleName[];
  scopedModuleIds: Map<ModuleName, Set<string> | null>;
  hiddenProfileIds: Set<string>;
  signal?: AbortSignal;
  pageSize?: number;
}

const SOURCE_MODULE: Record<InspectionExportSource, ModuleName> = {
  van: 'inspections',
  plant: 'plant-inspections',
  hgv: 'hgv-inspections',
};

const SOURCE_TABLE: Record<InspectionExportSource, string> = {
  van: 'van_inspections',
  plant: 'plant_inspections',
  hgv: 'hgv_inspections',
};

const SOURCE_ORDER: Record<InspectionExportSource, number> = {
  van: 0,
  plant: 1,
  hgv: 2,
};

const VAN_DETAIL_SELECT = `
  id,
  user_id,
  inspection_date,
  inspection_end_date,
  current_mileage,
  status,
  inspector_comments,
  signature_data,
  signed_at,
  vehicle:vans(
    reg_number,
    nickname,
    vehicle_type,
    van_categories(name)
  ),
  profile:profiles!van_inspections_user_id_fkey(full_name)
`;

const PLANT_DETAIL_SELECT = `
  id,
  user_id,
  inspection_date,
  inspection_end_date,
  current_mileage,
  status,
  inspector_comments,
  signature_data,
  signed_at,
  is_hired_plant,
  hired_plant_id_serial,
  hired_plant_description,
  hired_plant_hiring_company,
  plant(
    plant_id,
    nickname,
    serial_number,
    van_categories(name)
  ),
  profile:profiles!plant_inspections_user_id_fkey(full_name)
`;

const HGV_DETAIL_SELECT = `
  id,
  user_id,
  inspection_date,
  inspection_end_date,
  current_mileage,
  status,
  inspector_comments,
  signature_data,
  signed_at,
  hgv:hgvs!hgv_inspections_hgv_id_fkey(
    reg_number,
    nickname,
    hgv_categories(name)
  ),
  profile:profiles!hgv_inspections_user_id_fkey(full_name)
`;

const DETAIL_SELECT: Record<InspectionExportSource, string> = {
  van: VAN_DETAIL_SELECT,
  plant: PLANT_DETAIL_SELECT,
  hgv: HGV_DETAIL_SELECT,
};

const SOURCES: InspectionExportSource[] = ['van', 'plant', 'hgv'];

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function compareInspectionExportOrder(
  left: InspectionExportManifestRow,
  right: InspectionExportManifestRow,
): number {
  return left.inspection_date.localeCompare(right.inspection_date)
    || SOURCE_ORDER[left.source] - SOURCE_ORDER[right.source]
    || left.id.localeCompare(right.id);
}

export function heavyRowStillAuthorised(
  row: { status?: string | null; inspection_date?: string | null; user_id?: string | null },
  args: {
    dateFrom: string;
    dateTo: string;
    ownerScope: Set<string> | null;
    hiddenProfileIds: Set<string>;
  },
): boolean {
  if (!row.user_id || !row.inspection_date || row.status == null || row.status === 'draft') return false;
  if (row.inspection_date < args.dateFrom || row.inspection_date > args.dateTo) return false;
  if (args.hiddenProfileIds.has(row.user_id)) return false;
  if (args.ownerScope && !args.ownerScope.has(row.user_id)) return false;
  return true;
}

function ownerScopeFor(
  source: InspectionExportSource,
  scopedModuleIds: Map<ModuleName, Set<string> | null>,
): Set<string> | null {
  const moduleName = SOURCE_MODULE[source];
  if (!scopedModuleIds.has(moduleName)) return new Set();
  return scopedModuleIds.get(moduleName) ?? null;
}

function applyListFilters(
  query: InspectionExportQuery,
  args: { dateFrom: string; dateTo: string },
  ownerScope: Set<string> | null,
): InspectionExportQuery {
  let next = query
    .neq('status', 'draft')
    .gte('inspection_date', args.dateFrom)
    .lte('inspection_date', args.dateTo);
  if (ownerScope) {
    next = next.in('user_id', [...ownerScope]);
  }
  return next
    .order('inspection_date', { ascending: true })
    .order('id', { ascending: true });
}

async function readCompletePages(
  readPage: (from: number, to: number) => Promise<InspectionExportPage>,
  signal: AbortSignal | undefined,
  pageSize: number,
  maximumRows = Number.POSITIVE_INFINITY,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > INSPECTION_EXPORT_PAGE_SIZE) {
    throw new Error('Invalid inspection export page size');
  }
  for (let offset = 0; ;) {
    throwIfAborted(signal);
    const page = await readPage(offset, offset + pageSize - 1);
    throwIfAborted(signal);
    if (page.error) {
      throw new Error(page.error.message || 'Unable to read inspection export page');
    }
    const chunk = page.data ?? [];
    if (chunk.length === 0) return rows;
    rows.push(...chunk);
    if (rows.length >= maximumRows) return rows;
    offset += chunk.length;
  }
}

function asManifestRow(row: Record<string, unknown>, source: InspectionExportSource): InspectionExportManifestRow {
  if (typeof row.id !== 'string' || typeof row.user_id !== 'string' || typeof row.inspection_date !== 'string') {
    throw new Error('Incomplete inspection export manifest');
  }
  return {
    id: row.id,
    user_id: row.user_id,
    inspection_date: row.inspection_date,
    source,
  };
}

async function loadSourceManifest(
  reader: InspectionExportReader,
  source: InspectionExportSource,
  args: InspectionExportScopeArgs,
): Promise<InspectionExportManifestRow[]> {
  const moduleName = SOURCE_MODULE[source];
  if (!args.availableModules.includes(moduleName)) return [];
  const ownerScope = ownerScopeFor(source, args.scopedModuleIds);
  if (ownerScope && ownerScope.size === 0) return [];

  const pageSize = args.pageSize ?? INSPECTION_EXPORT_PAGE_SIZE;
  const rows = await readCompletePages(async (from, to) => {
    const query = applyListFilters(
      reader.from(SOURCE_TABLE[source]).select('id, user_id, inspection_date'),
      args,
      ownerScope,
    );
    return query.range(from, to);
  }, args.signal, pageSize);

  const manifest = rows.map((row) => asManifestRow(row, source));
  return filterHiddenReportSubjects(manifest, args.hiddenProfileIds);
}

export async function loadInspectionExportManifest(
  reader: InspectionExportReader,
  args: InspectionExportScopeArgs,
): Promise<InspectionExportManifestRow[]> {
  throwIfAborted(args.signal);
  const grouped = await Promise.all(SOURCES.map((source) => loadSourceManifest(reader, source, args)));
  throwIfAborted(args.signal);
  return grouped.flat().sort(compareInspectionExportOrder);
}

function asDetailRow(row: Record<string, unknown>, source: InspectionExportSource): DailyCheckInspection {
  if (typeof row.id !== 'string' || typeof row.user_id !== 'string') {
    throw new Error('Incomplete inspection export detail');
  }
  if (source === 'plant') {
    return { ...(row as unknown as Omit<PlantInspectionWithRelations, 'source'>), source };
  }
  if (source === 'hgv') {
    return { ...(row as unknown as Omit<HgvInspectionWithRelations, 'source'>), source };
  }
  return { ...(row as unknown as Omit<VanInspectionWithRelations, 'source'>), source };
}

async function loadSourceDetails(
  reader: InspectionExportReader,
  source: InspectionExportSource,
  manifest: InspectionExportManifestRow[],
  args: InspectionExportScopeArgs,
): Promise<DailyCheckInspection[]> {
  if (!args.availableModules.includes(SOURCE_MODULE[source])) return [];
  const ids = manifest.filter((row) => row.source === source).map((row) => row.id);
  if (ids.length === 0) return [];
  const ownerScope = ownerScopeFor(source, args.scopedModuleIds);
  if (ownerScope && ownerScope.size === 0) return [];

  const pageSize = args.pageSize ?? INSPECTION_EXPORT_PAGE_SIZE;
  const rows = await readCompletePages(async (from, to) => {
    let query = reader.from(SOURCE_TABLE[source]).select(DETAIL_SELECT[source]).in('id', ids);
    query = applyListFilters(query, args, ownerScope);
    return query.range(from, to);
  }, args.signal, pageSize, ids.length);

  const authorised = rows
    .map((row) => asDetailRow(row, source))
    .filter((row) => heavyRowStillAuthorised(row, {
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
      ownerScope,
      hiddenProfileIds: args.hiddenProfileIds,
    }));
  const visible = filterHiddenReportSubjects(authorised, args.hiddenProfileIds);
  const visibleById = new Map(visible.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = visibleById.get(id);
    return row ? [row] : [];
  });
}

export async function loadInspectionExportPartDetails(
  reader: InspectionExportReader,
  manifest: InspectionExportManifestRow[],
  args: InspectionExportScopeArgs,
): Promise<DailyCheckInspection[]> {
  throwIfAborted(args.signal);
  const grouped = await Promise.all(SOURCES.map((source) => loadSourceDetails(reader, source, manifest, args)));
  throwIfAborted(args.signal);
  const byKey = new Map<string, DailyCheckInspection>();
  grouped.flat().forEach((row) => byKey.set(`${row.source}:${row.id}`, row));
  return manifest.flatMap((row) => {
    const match = byKey.get(`${row.source}:${row.id}`);
    return match ? [match] : [];
  });
}

function groupRows<T extends { inspection_id: string }>(
  rows: T[],
  sortGroup: (left: T, right: T) => number,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  rows.forEach((row) => {
    const existing = grouped.get(row.inspection_id) || [];
    existing.push(row);
    grouped.set(row.inspection_id, existing);
  });
  grouped.forEach((group) => group.sort(sortGroup));
  return grouped;
}

export async function loadInspectionItemsByInspectionId(
  reader: InspectionExportReader,
  inspectionIds: string[],
  signal?: AbortSignal,
  pageSize = INSPECTION_EXPORT_PAGE_SIZE,
): Promise<Map<string, InspectionItem[]>> {
  if (inspectionIds.length === 0) return new Map();
  const rows = await readCompletePages(async (from, to) => reader
    .from('inspection_items')
    .select('*')
    .in('inspection_id', inspectionIds)
    .order('inspection_id', { ascending: true })
    .order('item_number', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to), signal, pageSize);

  const items = rows.flatMap((row) => {
    if (typeof row.inspection_id !== 'string' || typeof row.id !== 'string') return [];
    return [row as unknown as InspectionItem];
  });
  return groupRows(items, (left, right) => left.item_number - right.item_number || left.id.localeCompare(right.id));
}

export async function loadPlantDailyHoursByInspectionId(
  reader: InspectionExportReader,
  inspectionIds: string[],
  signal?: AbortSignal,
  pageSize = INSPECTION_EXPORT_PAGE_SIZE,
): Promise<Map<string, Array<{ day_of_week: number; hours: number | null }>>> {
  if (inspectionIds.length === 0) return new Map();
  const rows = await readCompletePages(async (from, to) => reader
    .from('inspection_daily_hours')
    .select('inspection_id, day_of_week, hours')
    .in('inspection_id', inspectionIds)
    .order('inspection_id', { ascending: true })
    .order('day_of_week', { ascending: true })
    .range(from, to), signal, pageSize);

  const hours = rows.flatMap((row) => {
    if (typeof row.inspection_id !== 'string' || typeof row.day_of_week !== 'number') return [];
    return [{
      inspection_id: row.inspection_id,
      day_of_week: row.day_of_week,
      hours: typeof row.hours === 'number' || row.hours === null ? row.hours : null,
    }];
  });
  const grouped = groupRows(hours, (left, right) => left.day_of_week - right.day_of_week);
  return new Map([...grouped].map(([inspectionId, group]) => [
    inspectionId,
    group.map(({ day_of_week, hours: recordedHours }) => ({ day_of_week, hours: recordedHours })),
  ]));
}
