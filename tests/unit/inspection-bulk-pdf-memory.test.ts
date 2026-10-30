import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { POST as bulkPdf } from '@/app/api/reports/inspections/bulk-pdf/route';
import {
  INSPECTION_EXPORT_PAGE_SIZE,
  compareInspectionExportOrder,
  heavyRowStillAuthorised,
  loadInspectionExportManifest,
  loadInspectionExportPartDetails,
  loadInspectionItemsByInspectionId,
  type InspectionExportQuery,
  type InspectionExportReader,
} from '@/lib/server/inspection-export-manifest';

type QueryCall = {
  table: string;
  select: string;
  from: number;
  to: number;
  neq: Array<[string, string]>;
  gte: Array<[string, string]>;
  lte: Array<[string, string]>;
  ins: Array<[string, string[]]>;
};

type Filters = {
  neq: Array<[string, string]>;
  gte: Array<[string, string]>;
  lte: Array<[string, string]>;
  ins: Array<[string, string[]]>;
  orders: Array<[string, boolean]>;
};

const state = vi.hoisted(() => ({
  getUser: vi.fn(),
  canAccess: vi.fn(),
  scopeContext: vi.fn(),
  scopedProfiles: vi.fn(),
  hiddenIds: vi.fn(),
  logServerError: vi.fn(),
  renderToBuffer: vi.fn(),
  createClient: vi.fn(),
  calls: [] as QueryCall[],
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  omitHeavyIds: new Set<string>(),
  failManifestFrom: null as number | null,
  holdManifest: null as Promise<void> | null,
  held: false,
  releaseHold: () => {},
  failRenderId: null as string | null,
  onRender: null as ((element: { id?: string }) => void) | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => state.createClient(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => { throw new Error('admin inspection read'); } }),
}));
vi.mock('@/lib/utils/rbac', () => ({ canEffectiveRoleAccessModule: (...args: unknown[]) => state.canAccess(...args) }));
vi.mock('@/lib/server/report-scope', () => ({
  getReportScopeContext: () => state.scopeContext(),
  getScopedProfileIdsForModule: (...args: unknown[]) => state.scopedProfiles(...args),
}));
vi.mock('@/lib/server/system-accounts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/system-accounts')>('@/lib/server/system-accounts');
  return { ...actual, getReportHiddenProfileIds: (...args: unknown[]) => state.hiddenIds(...args) };
});
vi.mock('@/lib/utils/server-error-logger', () => ({
  logServerError: (...args: unknown[]) => state.logServerError(...args),
}));
vi.mock('@react-pdf/renderer', () => ({
  renderToBuffer: (...args: unknown[]) => state.renderToBuffer(...args),
}));
vi.mock('@/lib/pdf/van-inspection-pdf', () => ({
  VanInspectionPDF: (props: {
    inspection: { id: string; signature_data?: string | null };
    items: Array<{ item_description?: string }>;
    employeeName?: string;
  }) => ({
    kind: 'van',
    id: props.inspection.id,
    signature: props.inspection.signature_data ?? null,
    employeeName: props.employeeName ?? null,
    items: props.items.map((item) => item.item_description ?? ''),
  }),
}));
vi.mock('@/lib/pdf/plant-inspection-pdf', () => ({
  PlantInspectionPDF: (props: {
    inspection: { id: string; signature_data?: string | null };
    operator: { full_name: string };
    items: Array<{ item_description?: string }>;
    dailyHours: Array<{ day_of_week: number; hours: number | null }>;
  }) => ({
    kind: 'plant',
    id: props.inspection.id,
    signature: props.inspection.signature_data ?? null,
    operator: props.operator.full_name,
    hours: props.dailyHours,
    items: props.items.map((item) => item.item_description ?? ''),
  }),
}));
vi.mock('@/lib/pdf/hgv-inspection-pdf', () => ({
  HgvInspectionPDF: (props: {
    inspection: { id: string; signature_data?: string | null };
    operator: { full_name: string };
    items: Array<{ item_description?: string }>;
  }) => ({
    kind: 'hgv',
    id: props.inspection.id,
    signature: props.inspection.signature_data ?? null,
    operator: props.operator.full_name,
    items: props.items.map((item) => item.item_description ?? ''),
  }),
}));
vi.mock('pdf-lib', () => ({
  PDFDocument: {
    create: async () => {
      const pages: unknown[] = [];
      return {
        copyPages: async (source: { pages: unknown[] }, indices: number[]) => indices.map((index) => source.pages[index]),
        addPage: (page: unknown) => { pages.push(page); },
        save: async () => Buffer.from(JSON.stringify(pages)),
      };
    },
    load: async (input: Uint8Array | Buffer) => {
      const page = JSON.parse(Buffer.from(input).toString('utf8')) as unknown;
      return { pages: [page], getPageIndices: () => [0] };
    },
  },
}));

function compareValue(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function matches(row: Record<string, unknown>, filters: Filters): boolean {
  if (filters.neq.some(([column, value]) => row[column] === value)) return false;
  if (filters.gte.some(([column, value]) => String(row[column] ?? '') < value)) return false;
  if (filters.lte.some(([column, value]) => String(row[column] ?? '') > value)) return false;
  if (filters.ins.some(([column, values]) => !values.includes(String(row[column] ?? '')))) return false;
  return true;
}

function sortRows(rows: Array<Record<string, unknown>>, orders: Array<[string, boolean]>) {
  return [...rows].sort((left, right) => {
    for (const [column, ascending] of orders) {
      const compared = compareValue(left[column], right[column]);
      if (compared !== 0) return ascending ? compared : -compared;
    }
    return 0;
  });
}

function fromTable(table: string) {
  return {
    select(columns: string) {
      const filters: Filters = { neq: [], gte: [], lte: [], ins: [], orders: [] };
      const builder = {
        neq(column: string, value: string) { filters.neq.push([column, value]); return builder; },
        gte(column: string, value: string) { filters.gte.push([column, value]); return builder; },
        lte(column: string, value: string) { filters.lte.push([column, value]); return builder; },
        in(column: string, values: readonly string[]) { filters.ins.push([column, [...values]]); return builder; },
        order(column: string, options: { ascending: boolean }) { filters.orders.push([column, options.ascending]); return builder; },
        async range(from: number, to: number) {
          state.calls.push({ table, select: columns, from, to, neq: filters.neq, gte: filters.gte, lte: filters.lte, ins: filters.ins.map(([column, values]) => [column, [...values]]) });
          if (state.holdManifest && table === 'van_inspections' && from === 0 && !columns.includes('signature_data')) {
            state.held = true;
            await state.holdManifest;
          }
          if (state.failManifestFrom === from && table === 'van_inspections' && !columns.includes('signature_data')) {
            return { data: null, error: { message: 'page failed' } };
          }
          let rows = sortRows((state.tables[table] ?? []).filter((row) => matches(row, filters)), filters.orders);
          if (columns.includes('signature_data')) rows = rows.filter((row) => !state.omitHeavyIds.has(String(row.id)));
          return { data: rows.slice(from, to + 1), error: null };
        },
      };
      return builder;
    },
  };
}

function addRow(table: string, row: Record<string, unknown>) {
  const rows = state.tables[table] ?? [];
  rows.push(row);
  state.tables[table] = rows;
}

function addVan(id: string, overrides: Record<string, unknown> = {}, withItem = true) {
  addRow('van_inspections', {
    id,
    user_id: 'u1',
    inspection_date: '2026-06-01',
    status: 'submitted',
    signature_data: `sig-${id}`,
    inspector_comments: null,
    current_mileage: null,
    inspection_end_date: '2026-06-01',
    signed_at: null,
    vehicle: { reg_number: id, nickname: null, vehicle_type: 'van', van_categories: { name: 'Panel' } },
    profile: { full_name: 'Ada' },
    ...overrides,
  });
  if (withItem) {
    addRow('inspection_items', {
      id: `item-${id}`,
      inspection_id: id,
      item_number: 1,
      item_description: 'Lights',
      status: 'ok',
      comments: null,
      day_of_week: 1,
    });
  }
}

function request(body: { dateFrom: string; dateTo: string }, signal?: AbortSignal) {
  return new NextRequest('http://localhost/api/reports/inspections/bulk-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

function eventsOf(text: string) {
  return text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function pagesFromPdf(base64: string) {
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as Array<{
    id: string;
    kind: string;
    signature: string | null;
    employeeName?: string | null;
    operator?: string;
    items?: string[];
    hours?: Array<{ day_of_week: number; hours: number | null }>;
  }>;
}

const day = { dateFrom: '2026-06-01', dateTo: '2026-06-01' };

beforeEach(() => {
  vi.clearAllMocks();
  state.calls = [];
  state.tables = {};
  state.omitHeavyIds = new Set();
  state.failManifestFrom = null;
  state.holdManifest = null;
  state.held = false;
  state.releaseHold = () => {};
  state.failRenderId = null;
  state.onRender = null;
  state.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  state.canAccess.mockResolvedValue(true);
  state.scopeContext.mockResolvedValue({ effectiveRole: { user_id: 'user-1' } });
  state.scopedProfiles.mockResolvedValue(null);
  state.hiddenIds.mockResolvedValue(new Set());
  state.logServerError.mockResolvedValue(undefined);
  state.createClient.mockResolvedValue({ auth: { getUser: state.getUser }, from: fromTable });
  state.renderToBuffer.mockImplementation(async (element: { id?: string }) => {
    if (state.failRenderId && element.id === state.failRenderId) throw new Error('render failed');
    state.onRender?.(element);
    return Buffer.from(JSON.stringify(element));
  });
});

function createPagedReader(
  rows: Array<Record<string, unknown>>,
  cap: number,
  failFrom: number | null = null,
): { reader: InspectionExportReader; requests: number[] } {
  const requests: number[] = [];
  const reader: InspectionExportReader = {
    from: () => ({
      select: () => {
        const filters: Filters = { neq: [], gte: [], lte: [], ins: [], orders: [] };
        const builder = {
          neq(column: string, value: string) { filters.neq.push([column, value]); return builder; },
          gte(column: string, value: string) { filters.gte.push([column, value]); return builder; },
          lte(column: string, value: string) { filters.lte.push([column, value]); return builder; },
          in(column: string, values: readonly string[]) { filters.ins.push([column, [...values]]); return builder; },
          order(column: string, options: { ascending: boolean }) { filters.orders.push([column, options.ascending]); return builder; },
          async range(from: number, to: number) {
            const requested = to - from + 1;
            requests.push(requested);
            if (failFrom === from) return { data: null, error: { message: 'page failed' } };
            const page = sortRows(rows.filter((row) => matches(row, filters)), filters.orders);
            return { data: page.slice(from, from + Math.min(requested, cap)), error: null };
          },
        };
        return builder as InspectionExportQuery;
      },
    }),
  };
  return { reader, requests };
}

describe('inspection export manifest', () => {
  const scope = {
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
    availableModules: ['inspections'] as const,
    scopedModuleIds: new Map([['inspections' as const, null]]),
    hiddenProfileIds: new Set<string>(),
  };

  it('pages past a hostile row cap and keeps date, source, then id order', async () => {
    expect(INSPECTION_EXPORT_PAGE_SIZE).toBe(500);
    expect(INSPECTION_EXPORT_PAGE_SIZE).toBeLessThanOrEqual(1000);
    const rows = Array.from({ length: 5 }, (_, index) => ({
      id: `van-${index}`,
      user_id: 'u1',
      inspection_date: `2026-01-0${5 - index}`,
      status: 'submitted',
      signature_data: 'not-on-manifest',
    }));
    const paged = createPagedReader(rows, 2);
    const manifest = await loadInspectionExportManifest(paged.reader, scope);
    expect(paged.requests).toEqual([500, 500, 500, 500]);
    expect(manifest.map((row) => row.id)).toEqual(['van-4', 'van-3', 'van-2', 'van-1', 'van-0']);
    expect(manifest.every((row) => !('signature_data' in row))).toBe(true);
    expect(compareInspectionExportOrder(
      { id: 'z-van', user_id: 'u', inspection_date: '2026-01-01', source: 'van' },
      { id: 'a-plant', user_id: 'u', inspection_date: '2026-01-01', source: 'plant' },
    )).toBeLessThan(0);
  });

  it('reads every checklist row when the API caps each response below the requested size', async () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      id: `item-${index}`, inspection_id: 'inspection-1', item_number: index + 1,
      item_description: `Check ${index + 1}`, status: 'ok', comments: null,
    }));
    const paged = createPagedReader(rows, 2);
    const grouped = await loadInspectionItemsByInspectionId(paged.reader, ['inspection-1']);
    expect(grouped.get('inspection-1')?.map(item => item.item_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(paged.requests).toHaveLength(6);
  });

  it('keeps signatures out of the complete manifest and hydrates only the current 80-row part', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      id: `van-${String(index).padStart(4, '0')}`, user_id: 'u1', inspection_date: '2026-01-01', status: 'submitted',
      signature_data: `SYNTHETIC-${'x'.repeat(4096)}`, inspector_comments: 'Synthetic comments',
    }));
    const manifest = await loadInspectionExportManifest(createPagedReader(rows, 500).reader, scope);
    const details = await loadInspectionExportPartDetails(createPagedReader(rows, 500).reader, manifest.slice(0, 80), scope);
    expect(manifest).toHaveLength(501);
    expect(manifest.every(row => Object.keys(row).sort().join(',') === 'id,inspection_date,source,user_id')).toBe(true);
    expect(details).toHaveLength(80);
    expect(details.map(row => row.id)).toEqual(manifest.slice(0, 80).map(row => row.id));
    const beforeBytes = Buffer.byteLength(JSON.stringify(rows));
    const manifestBytes = Buffer.byteLength(JSON.stringify(manifest));
    const partBytes = Buffer.byteLength(JSON.stringify(details));
    expect(manifestBytes + partBytes).toBeLessThan(beforeBytes);
    console.info('Synthetic export retained-payload bytes', JSON.stringify({ beforeBytes, manifestBytes, partBytes }));
  });

  it('does not return a partial manifest when a later page fails', async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      id: `van-${index}`, user_id: 'u1', inspection_date: '2026-01-01', status: 'submitted',
    }));
    const paged = createPagedReader(rows, 2, 2);
    await expect(loadInspectionExportManifest(paged.reader, { ...scope, pageSize: 2 })).rejects.toThrow('page failed');
  });

  it('rejects heavy rows that changed status, date, owner, or hidden profile', () => {
    const args = { dateFrom: '2026-01-01', dateTo: '2026-01-31', ownerScope: new Set(['u1']), hiddenProfileIds: new Set(['hidden']) };
    expect(heavyRowStillAuthorised({ user_id: 'u1', inspection_date: '2026-01-02', status: 'submitted' }, args)).toBe(true);
    expect(heavyRowStillAuthorised({ user_id: 'u1', inspection_date: '2026-01-02', status: 'draft' }, args)).toBe(false);
    expect(heavyRowStillAuthorised({ user_id: 'u1', inspection_date: '2026-02-01', status: 'submitted' }, args)).toBe(false);
    expect(heavyRowStillAuthorised({ user_id: 'u2', inspection_date: '2026-01-02', status: 'submitted' }, args)).toBe(false);
    expect(heavyRowStillAuthorised({ user_id: 'hidden', inspection_date: '2026-01-02', status: 'submitted' }, args)).toBe(false);
    expect(heavyRowStillAuthorised(
      { user_id: 'u2', inspection_date: '2026-01-02', status: 'submitted' },
      { ...args, ownerScope: null, hiddenProfileIds: new Set() },
    )).toBe(true);
  });
});

describe('bulk inspection PDF memory route', () => {
  it('streams every id in order through a 500-row window, with 80-row parts', async () => {
    const visibleIds = Array.from({ length: 501 }, (_, index) => `van-${String(index + 1).padStart(4, '0')}`);
    visibleIds.forEach((id) => addVan(id));
    addVan('van-0000', { user_id: 'hidden-user' });
    addVan('van-draft', { status: 'draft' });
    addVan('van-old', { inspection_date: '2020-01-01' });
    addVan('van-future', { inspection_date: '2026-06-02' });
    state.hiddenIds.mockResolvedValue(new Set(['hidden-user']));

    const response = await bulkPdf(request(day));
    const streamed = eventsOf(await response.text());
    const init = streamed[0];
    const complete = streamed.at(-1);
    expect(init).toEqual({ type: 'init', total: 501, needsZip: true, numParts: 7 });
    expect(complete).toMatchObject({
      type: 'complete',
      fileName: 'All_Daily_Checks_2026-06-01_to_2026-06-01.zip',
      contentType: 'application/zip',
    });
    const progress = streamed.filter((event) => event.type === 'progress');
    expect(progress).toHaveLength(501);
    expect(progress.at(-1)).toMatchObject({ current: 501, total: 501, totalParts: 7 });

    const zip = await JSZip.loadAsync(Buffer.from(String(complete?.data), 'base64'));
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual([1, 2, 3, 4, 5, 6, 7].map((part) => `All_Daily_Checks_2026-06-01_to_2026-06-01_Part${part}.pdf`));
    const partPages = await Promise.all(names.map(async (name) => pagesFromPdf(Buffer.from(await zip.files[name].async('nodebuffer')).toString('base64'))));
    expect(partPages.map((pages) => pages.length)).toEqual([80, 80, 80, 80, 80, 80, 21]);
    expect(partPages[0][0]).toMatchObject({ kind: 'van', id: 'van-0001', signature: 'sig-van-0001', employeeName: 'Ada', items: ['Lights'] });
    expect(partPages[1][0].id).toBe('van-0081');
    expect(partPages[6][20]).toMatchObject({ id: 'van-0501', signature: 'sig-van-0501' });
    expect(partPages.flat().map((page) => page.id)).toEqual(visibleIds);

    const manifestCalls = state.calls.filter((call) => call.table === 'van_inspections' && call.select === 'id, user_id, inspection_date');
    expect(manifestCalls.map((call) => [call.from, call.to])).toEqual([[0, 499], [500, 999], [502, 1001]]);
    expect(manifestCalls.every((call) => call.to - call.from + 1 === 500)).toBe(true);
    expect(manifestCalls.every((call) => !call.select.includes('signature_data'))).toBe(true);
    const heavyCalls = state.calls.filter((call) => call.table === 'van_inspections' && call.select.includes('signature_data'));
    expect(heavyCalls).toHaveLength(7);
    expect(heavyCalls.map((call) => call.ins.find(([column]) => column === 'id')?.[1].length)).toEqual([80, 80, 80, 80, 80, 80, 21]);
    expect(heavyCalls[0].ins.find(([column]) => column === 'id')?.[1][0]).toBe('van-0001');
    expect(heavyCalls.every((call) => call.neq.some(([column, value]) => column === 'status' && value === 'draft'))).toBe(true);
    const itemCalls = state.calls.filter((call) => call.table === 'inspection_items');
    expect(itemCalls).toHaveLength(14);
    expect(itemCalls[0].ins.find(([column]) => column === 'inspection_id')?.[1]).toHaveLength(80);
    expect(state.calls.filter((call) => call.table === 'inspection_daily_hours')).toHaveLength(0);
    expect(state.calls.some((call) => call.ins.some(([, values]) => values.includes('van-draft') || values.includes('van-0000')))).toBe(false);
    expect(state.calls.filter((call) => call.table === 'van_inspections')).toHaveLength(10);
    expect(state.calls).toHaveLength(26);
  });

  it('keeps a single PDF at 80 and splits the 81st inspection into part 2', async () => {
    state.canAccess.mockImplementation(async (module: string) => module === 'reports' || module === 'inspections');
    for (let index = 1; index <= 80; index += 1) addVan(`edge-${String(index).padStart(2, '0')}`);
    const single = eventsOf(await (await bulkPdf(request(day))).text());
    expect(single[0]).toMatchObject({ type: 'init', total: 80, needsZip: false, numParts: 1 });
    expect(single.at(-1)).toMatchObject({
      type: 'complete',
      fileName: 'All_Daily_Checks_2026-06-01_to_2026-06-01.pdf',
      contentType: 'application/pdf',
    });
    expect(pagesFromPdf(String(single.at(-1)?.data))).toHaveLength(80);

    state.calls = [];
    state.tables = {};
    for (let index = 1; index <= 81; index += 1) addVan(`edge-${String(index).padStart(2, '0')}`);
    const zipped = eventsOf(await (await bulkPdf(request(day))).text());
    expect(zipped[0]).toMatchObject({ total: 81, needsZip: true, numParts: 2 });
    const zip = await JSZip.loadAsync(Buffer.from(String(zipped.at(-1)?.data), 'base64'));
    const part1 = pagesFromPdf(Buffer.from(await zip.file('All_Daily_Checks_2026-06-01_to_2026-06-01_Part1.pdf')!.async('nodebuffer')).toString('base64'));
    const part2 = pagesFromPdf(Buffer.from(await zip.file('All_Daily_Checks_2026-06-01_to_2026-06-01_Part2.pdf')!.async('nodebuffer')).toString('base64'));
    expect(part1).toHaveLength(80);
    expect(part2.map((page) => page.id)).toEqual(['edge-81']);
    expect(zipped.at(-1)).toMatchObject({ contentType: 'application/zip', fileName: 'All_Daily_Checks_2026-06-01_to_2026-06-01.zip' });
  });

  it('renders mixed templates from heavy signatures and skips empty, missing, and out-of-scope rows', async () => {
    state.scopedProfiles.mockImplementation(async (module: string) => {
      if (module === 'inspections') return new Set(['u1']);
      if (module === 'hgv-inspections') return new Set(['u3']);
      return null;
    });
    addVan('van-1', { inspection_date: '2026-03-02', signature_data: 'sig-van', profile: { full_name: 'Ada' } });
    addVan('van-hidden', { user_id: 'u9', inspection_date: '2026-03-01' });
    addVan('van-complete', { id: 'van-complete', inspection_date: '2026-03-03', status: 'complete', signature_data: 'sig-complete' });
    addRow('plant_inspections', {
      id: 'plant-1', user_id: 'u2', inspection_date: '2026-03-01', status: 'submitted', signature_data: 'sig-plant',
      profile: { full_name: 'Bea' }, plant: { plant_id: 'P1', nickname: 'Digger', serial_number: 'S', van_categories: { name: 'Excavator' } },
      is_hired_plant: false,
    });
    addRow('inspection_items', {
      id: 'item-plant-1', inspection_id: 'plant-1', item_number: 1, item_description: 'Hydraulics', status: 'ok', comments: null, day_of_week: 2,
    });
    addRow('inspection_daily_hours', { inspection_id: 'plant-1', day_of_week: 2, hours: 4 });
    addRow('hgv_inspections', {
      id: 'hgv-1', user_id: 'u3', inspection_date: '2026-03-02', status: 'submitted', signature_data: 'sig-hgv',
      profile: { full_name: 'Cara' }, hgv: { reg_number: 'H1', nickname: null, hgv_categories: { name: 'Tractor' } },
    });
    addRow('inspection_items', {
      id: 'item-hgv-1', inspection_id: 'hgv-1', item_number: 1, item_description: 'Brakes', status: 'ok', comments: null, day_of_week: 1,
    });
    addVan('van-empty', { inspection_date: '2026-03-04', signature_data: 'sig-empty' }, false);
    addVan('van-gone', { inspection_date: '2026-03-05', signature_data: 'sig-gone' });
    state.omitHeavyIds.add('van-gone');

    const streamed = eventsOf(await (await bulkPdf(request({ dateFrom: '2026-03-01', dateTo: '2026-03-05' }))).text());
    const complete = streamed.at(-1);
    expect(streamed[0]).toMatchObject({ type: 'init', total: 6, needsZip: false, numParts: 1 });
    expect(complete).toMatchObject({
      type: 'complete',
      contentType: 'application/pdf',
      fileName: 'All_Daily_Checks_2026-03-01_to_2026-03-05.pdf',
    });
    expect(Object.keys(complete ?? {}).sort()).toEqual(['contentType', 'data', 'fileName', 'type']);
    expect(pagesFromPdf(String(complete?.data))).toEqual([
      { kind: 'plant', id: 'plant-1', signature: 'sig-plant', operator: 'Bea', hours: [{ day_of_week: 2, hours: 4 }], items: ['Hydraulics'] },
      { kind: 'van', id: 'van-1', signature: 'sig-van', employeeName: 'Ada', items: ['Lights'] },
      { kind: 'hgv', id: 'hgv-1', signature: 'sig-hgv', operator: 'Cara', items: ['Brakes'] },
      { kind: 'van', id: 'van-complete', signature: 'sig-complete', employeeName: 'Ada', items: ['Lights'] },
    ]);
    expect(streamed.filter((event) => event.type === 'progress')).toHaveLength(6);
    expect(state.renderToBuffer).toHaveBeenCalledTimes(4);
    const vanHeavy = state.calls.find((call) => call.table === 'van_inspections' && call.select.includes('signature_data'));
    expect(vanHeavy?.ins.find(([column]) => column === 'user_id')?.[1]).toEqual(['u1']);
    expect(vanHeavy?.ins.find(([column]) => column === 'id')?.[1]).not.toContain('van-hidden');
    expect(state.calls.some((call) => call.table === 'inspection_daily_hours' && call.ins.some(([column, values]) => column === 'inspection_id' && values.includes('plant-1')))).toBe(true);
  });

  it('drops a row hidden between the manifest and the heavy read without adding rows', async () => {
    addVan('van-1');
    let reads = 0;
    state.hiddenIds.mockImplementation(async () => {
      reads += 1;
      return reads === 1 ? new Set<string>() : new Set(['u1']);
    });
    const streamed = eventsOf(await (await bulkPdf(request(day))).text());
    expect(streamed[0]).toMatchObject({ total: 1 });
    expect(pagesFromPdf(String(streamed.at(-1)?.data))).toEqual([]);
    expect(state.renderToBuffer).not.toHaveBeenCalled();
    expect(streamed.at(-1)?.type).toBe('complete');
  });

  it('denies reports and daily-check access before inspection reads', async () => {
    state.canAccess.mockResolvedValue(false);
    const denied = eventsOf(await (await bulkPdf(request(day))).text());
    expect(denied).toEqual([{ error: 'Forbidden - Reports access required' }]);
    expect(state.calls).toEqual([]);
    expect(state.scopeContext).not.toHaveBeenCalled();
    expect(state.hiddenIds).not.toHaveBeenCalled();

    state.canAccess.mockImplementation(async (module: string) => module === 'reports');
    const noChecks = eventsOf(await (await bulkPdf(request(day))).text());
    expect(noChecks).toEqual([{ error: 'Forbidden - Daily Checks access required' }]);
    expect(state.calls).toEqual([]);
    expect(state.scopeContext).not.toHaveBeenCalled();
    expect(state.hiddenIds).not.toHaveBeenCalled();

    state.getUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    state.canAccess.mockResolvedValue(true);
    const anonymous = eventsOf(await (await bulkPdf(request(day))).text());
    expect(anonymous).toEqual([{ error: 'Unauthorized' }]);
    expect(state.calls).toEqual([]);
  });

  it('allows 366 inclusive days and rejects 367 before opening a stream query', async () => {
    const allowed = eventsOf(await (await bulkPdf(request({ dateFrom: '2025-01-01', dateTo: '2026-01-01' }))).text());
    expect(allowed).toEqual([{ error: 'No daily checks found in the selected date range' }]);
    expect(state.calls.map((call) => call.table)).toEqual(['van_inspections', 'plant_inspections', 'hgv_inspections']);
    expect(state.createClient).toHaveBeenCalledTimes(1);

    state.calls = [];
    state.createClient.mockClear();
    const rejected = await bulkPdf(request({ dateFrom: '2025-01-01', dateTo: '2026-01-02' }));
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: 'Date range must be 366 days or fewer' });
    expect(state.calls).toEqual([]);
    expect(state.createClient).not.toHaveBeenCalled();
  });

  it('stops a mid-run render or manifest page failure without a completion payload', async () => {
    addVan('van-1');
    addVan('van-2');
    state.failRenderId = 'van-2';
    const rendered = eventsOf(await (await bulkPdf(request(day))).text());
    expect(rendered.some((event) => event.type === 'complete')).toBe(false);
    expect(rendered.at(-1)).toEqual({ error: 'Failed to generate PDFs', details: 'render failed' });
    expect(state.logServerError).toHaveBeenCalledTimes(1);

    state.failRenderId = null;
    state.renderToBuffer.mockClear();
    state.logServerError.mockClear();
    state.tables = {};
    state.calls = [];
    for (let index = 1; index <= 501; index += 1) addVan(`van-${String(index).padStart(4, '0')}`);
    state.failManifestFrom = 500;
    const paged = eventsOf(await (await bulkPdf(request(day))).text());
    expect(paged).toEqual([{ error: 'Failed to generate PDFs', details: 'page failed' }]);
    expect(state.renderToBuffer).not.toHaveBeenCalled();
    expect(state.logServerError).toHaveBeenCalledTimes(1);
  });

  it('does not complete after request abort or stream cancellation', async () => {
    addVan('van-1');
    const aborted = new AbortController();
    aborted.abort();
    const already = await (await bulkPdf(request(day, aborted.signal))).text();
    expect(already).toBe('');
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.logServerError).not.toHaveBeenCalled();

    let release!: () => void;
    state.holdManifest = new Promise<void>((resolve) => { release = resolve; });
    const controller = new AbortController();
    const pending = bulkPdf(request(day, controller.signal));
    await vi.waitFor(() => expect(state.held).toBe(true));
    controller.abort();
    release();
    const text = await (await pending).text();
    expect(text).not.toContain('"type":"complete"');
    expect(text).not.toContain('Failed to generate PDFs');
    expect(state.renderToBuffer).not.toHaveBeenCalled();
    expect(state.logServerError).not.toHaveBeenCalled();

    state.held = false;
    state.holdManifest = new Promise<void>((resolve) => { release = resolve; });
    const response = await bulkPdf(request(day));
    await vi.waitFor(() => expect(state.held).toBe(true));
    const cancelResult = response.body?.cancel();
    release();
    await cancelResult;
    await expect(response.text()).rejects.toThrow();
    expect(state.renderToBuffer).not.toHaveBeenCalled();
    expect(state.logServerError).not.toHaveBeenCalled();
  });
});
