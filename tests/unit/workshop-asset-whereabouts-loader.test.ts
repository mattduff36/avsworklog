import { describe, expect, it } from 'vitest';
import { loadAssetWhereabouts } from '@/lib/server/workshop-tasks/asset-whereabouts';
import type { AdminClient } from '@/lib/server/daily-allocation/auth';

type OrderCall = { table: string; column: string; options: unknown };

function matchingRows(data: unknown, eqs: Record<string, unknown>): unknown[] {
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (Object.keys(eqs).length === 0) return rows;
  return rows.filter(
    (row) =>
      row &&
      typeof row === 'object' &&
      Object.entries(eqs).every(([key, value]) => (row as Record<string, unknown>)[key] === value)
  );
}

function createAdmin(handlers: Record<string, { data: unknown; error: null }>) {
  const tables: string[] = [];
  const orders: OrderCall[] = [];
  const admin = {
    tables,
    orders,
    from(table: string) {
      tables.push(table);
      const result = handlers[table] || { data: [], error: null };
      const eqs: Record<string, unknown> = {};
      let isNullColumn: string | null = null;
      let notNullColumn: string | null = null;
      let limitCount: number | null = null;
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          eqs[column] = value;
          return builder;
        },
        in() {
          return builder;
        },
        gte() {
          return builder;
        },
        lte() {
          return builder;
        },
        is(column: string, value: unknown) {
          if (value === null) isNullColumn = column;
          return builder;
        },
        not(column: string, operator: string, value: unknown) {
          if (operator === 'is' && value === null) notNullColumn = column;
          return builder;
        },
        order(column: string, options?: unknown) {
          orders.push({ table, column, options });
          return builder;
        },
        limit(count: number) {
          limitCount = count;
          return builder;
        },
        maybeSingle: async () => {
          const rows = matchingRows(result.data, eqs);
          return {
            data: rows[0] ?? null,
            error: null,
          };
        },
        then(
          resolve: (value: { data: unknown; error: null }) => unknown,
          reject?: (reason: unknown) => unknown
        ) {
          let rows = Array.isArray(result.data) ? [...result.data] : result.data ? [result.data] : [];
          if (isNullColumn) {
            rows = rows.filter(
              (row) =>
                row &&
                typeof row === 'object' &&
                (row as Record<string, unknown>)[isNullColumn as string] == null
            );
          }
          if (notNullColumn) {
            rows = rows.filter(
              (row) =>
                row &&
                typeof row === 'object' &&
                (row as Record<string, unknown>)[notNullColumn as string] != null
            );
          }
          if (typeof limitCount === 'number') {
            rows = rows.slice(0, limitCount);
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return admin as unknown as AdminClient & { tables: string[]; orders: OrderCall[] };
}

const emptyAllocationTables = {
  daily_allocation_publications: { data: [], error: null },
  daily_allocation_plant_items: { data: [], error: null },
  daily_allocation_published_plant: { data: [], error: null },
  daily_allocation_published_visits: { data: [], error: null },
  quotes: { data: [], error: null },
  legacy_quotes: { data: [], error: null },
  quote_project_numbers: { data: [], error: null },
};

describe('loadAssetWhereabouts', () => {
  it('WT-WHERE-PLANT-ORDER merges allocation and inspection newest first', async () => {
    const admin = createAdmin({
      plant: {
        data: { id: 'plant-1', plant_id: '331', nickname: 'Dumper', reg_number: null },
        error: null,
      },
      daily_allocation_publications: {
        data: [
          {
            id: 'pub-old',
            work_date: '2026-09-01',
            revision_no: 1,
            published_at: '2026-09-01T08:00:00.000Z',
            scope_team_id: null,
            snapshot_version: 1,
          },
          {
            id: 'pub-new',
            work_date: '2026-09-03',
            revision_no: 1,
            published_at: '2026-09-03T08:00:00.000Z',
            scope_team_id: null,
            snapshot_version: 1,
          },
        ],
        error: null,
      },
      daily_allocation_plant_items: {
        data: [
          {
            id: 'alloc-1',
            publication_id: 'pub-new',
            plant_kind: 'registered',
            plant_id: 'plant-1',
            job_source_type: 'live_quote',
            job_source_id: 'quote-1',
            job_code: '12345-AB',
            site_address: 'Site A',
          },
        ],
        error: null,
      },
      daily_allocation_published_plant: { data: [], error: null },
      daily_allocation_published_visits: { data: [], error: null },
      plant_inspections: {
        data: [
          {
            id: 'insp-1',
            user_id: 'user-1',
            inspection_date: '2026-09-04',
            submitted_at: '2026-09-04T09:00:00.000Z',
            current_mileage: 10,
            job_code: '12345-AB',
            job_site_address: 'Site A',
            job_source_type: 'live_quote',
            job_source_id: 'quote-1',
          },
        ],
        error: null,
      },
      profiles: { data: [{ id: 'user-1', full_name: 'Jo Driver' }], error: null },
      vehicle_maintenance: { data: { id: 'm1', current_hours: 44 }, error: null },
      quotes: { data: [], error: null },
      legacy_quotes: { data: [], error: null },
      quote_project_numbers: { data: [], error: null },
    });

    const payload = await loadAssetWhereabouts({
      admin,
      assetType: 'plant',
      assetId: 'plant-1',
      canOpenFleetHistory: false,
      now: new Date('2026-09-04T12:00:00.000Z'),
    });

    expect(payload?.events.map((event) => event.source)).toEqual(['inspection', 'allocation']);
    expect(payload?.lastDriverName).toBe('Jo Driver');
  });

  it('FD-WHERE-INSPECTION-001 uses submitted time for newest inspector, timeline, and phone', async () => {
    const admin = createAdmin({
      plant: {
        data: { id: 'plant-1', plant_id: '331', nickname: 'Dumper', reg_number: null },
        error: null,
      },
      ...emptyAllocationTables,
      plant_inspections: {
        data: [
          {
            id: 'insp-older-submit',
            user_id: 'user-old',
            inspection_date: '2026-09-04',
            submitted_at: '2026-09-01T18:00:00.000Z',
            current_mileage: 8,
            job_code: '11111-AA',
            job_site_address: 'Old site',
            job_source_type: 'live_quote',
            job_source_id: 'quote-old',
          },
          {
            id: 'insp-newer-submit',
            user_id: 'user-new',
            inspection_date: '2026-09-02',
            submitted_at: '2026-09-03T16:00:00.000Z',
            current_mileage: 12,
            job_code: '22222-BB',
            job_site_address: 'New site',
            job_source_type: 'live_quote',
            job_source_id: 'quote-new',
          },
        ],
        error: null,
      },
      profiles: {
        data: [
          { id: 'user-old', full_name: 'Date Driver', phone_number: '01111 111111' },
          { id: 'user-new', full_name: 'Submit Driver', phone_number: '02222 222222' },
        ],
        error: null,
      },
      vehicle_maintenance: { data: { id: 'm1', current_hours: 44 }, error: null },
    });

    const payload = await loadAssetWhereabouts({
      admin,
      assetType: 'plant',
      assetId: 'plant-1',
      canOpenFleetHistory: false,
      now: new Date('2026-09-04T12:00:00.000Z'),
    });

    const inspectionOrders = admin.orders.filter((row) => row.table === 'plant_inspections');
    expect(inspectionOrders.map((row) => row.column)).toEqual([
      'submitted_at',
      'inspection_date',
      'inspection_date',
      'id',
    ]);
    expect(inspectionOrders[0]?.options).toEqual({ ascending: false });
    expect(payload?.lastDriverName).toBe('Submit Driver');
    expect(payload?.lastDriverPhone).toBe('02222 222222');
    expect(payload?.lastCheckAt).toBe('2026-09-03T16:00:00.000Z');
    expect(payload?.events.filter((event) => event.source === 'inspection').map((event) => event.id)).toEqual([
      'inspection:insp-newer-submit',
      'inspection:insp-older-submit',
    ]);
    expect(payload?.events.every((event) => !('phone_number' in event) && !('lastDriverPhone' in event))).toBe(
      true
    );
  });

  it('WT-WHERE-VAN-NO-ALLOC never reads allocation tables for vans or HGVs', async () => {
    const vanAdmin = createAdmin({
      vans: {
        data: { id: 'van-1', reg_number: 'AB12CDE', nickname: 'Van' },
        error: null,
      },
      van_inspections: {
        data: [
          {
            id: 'insp-v',
            user_id: 'user-2',
            inspection_date: '2026-09-02',
            submitted_at: '2026-09-02T09:00:00.000Z',
            current_mileage: 100,
          },
        ],
        error: null,
      },
      profiles: { data: [{ id: 'user-2', full_name: 'Van Driver' }], error: null },
      vehicle_maintenance: { data: { id: 'm2', current_mileage: 100 }, error: null },
    });

    const vanPayload = await loadAssetWhereabouts({
      admin: vanAdmin,
      assetType: 'van',
      assetId: 'van-1',
      canOpenFleetHistory: true,
      now: new Date('2026-09-04T12:00:00.000Z'),
    });

    expect(vanPayload?.events.every((event) => event.source === 'inspection')).toBe(true);
    expect(vanAdmin.tables).not.toContain('daily_allocation_publications');
    expect(vanAdmin.tables).not.toContain('daily_allocation_plant_items');

    const hgvAdmin = createAdmin({
      hgvs: {
        data: { id: 'hgv-1', reg_number: 'VX12HGV', nickname: 'HGV' },
        error: null,
      },
      hgv_inspections: {
        data: [
          {
            id: 'insp-h',
            user_id: 'user-3',
            inspection_date: '2026-09-02',
            submitted_at: '2026-09-02T09:00:00.000Z',
            current_mileage: 200,
          },
        ],
        error: null,
      },
      profiles: { data: [{ id: 'user-3', full_name: 'HGV Driver' }], error: null },
      vehicle_maintenance: { data: { id: 'm3', current_mileage: 200 }, error: null },
    });

    const hgvPayload = await loadAssetWhereabouts({
      admin: hgvAdmin,
      assetType: 'hgv',
      assetId: 'hgv-1',
      canOpenFleetHistory: false,
      now: new Date('2026-09-04T12:00:00.000Z'),
    });

    expect(hgvPayload?.events.every((event) => event.source === 'inspection')).toBe(true);
    expect(hgvAdmin.tables).not.toContain('daily_allocation_publications');
    expect(hgvAdmin.tables).not.toContain('daily_allocation_plant_items');
    expect(hgvAdmin.tables).not.toContain('daily_allocation_published_plant');
  });

  it('loads V2 allocation identity and a newer null submitted_at inspection after ten dated rows', async () => {
    const olderInspections = Array.from({ length: 11 }, (_, index) => ({
      id: `old-${index}`,
      user_id: 'user-old',
      inspection_date: `2026-08-${String(index + 1).padStart(2, '0')}`,
      submitted_at: `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
      current_mileage: index,
      job_code: '11111-AA',
      job_site_address: 'Old',
      job_source_type: 'live_quote',
      job_source_id: 'quote-old',
    }));
    const admin = createAdmin({
      plant: {
        data: { id: 'plant-1', plant_id: '331', nickname: 'Dumper', reg_number: null },
        error: null,
      },
      daily_allocation_publications: {
        data: [
          {
            id: 'pub-v2',
            work_date: '2026-09-03',
            revision_no: 1,
            published_at: '2026-09-03T08:00:00.000Z',
            scope_team_id: null,
            snapshot_version: 2,
          },
        ],
        error: null,
      },
      daily_allocation_plant_items: { data: [], error: null },
      daily_allocation_published_plant: {
        data: [
          {
            id: 'plant-row',
            publication_id: 'pub-v2',
            published_visit_id: 'visit-1',
            plant_kind: 'registered',
            plant_id: 'plant-1',
            job_code: '12345-AB',
            site_address: 'Yard',
            job_source_type: 'live_quote',
            job_source_id: 'quote-v2',
          },
        ],
        error: null,
      },
      daily_allocation_published_visits: {
        data: [
          {
            id: 'visit-1',
            job_code: '12345-AB',
            site_address: 'Yard',
            customer_name: null,
            title: null,
            job_source_type: 'live_quote',
            job_source_id: 'quote-v2',
          },
        ],
        error: null,
      },
      plant_inspections: {
        data: [
          ...olderInspections,
          {
            id: 'new-null',
            user_id: 'user-new',
            inspection_date: '2026-09-04',
            submitted_at: null,
            current_mileage: 99,
            job_code: '12345-AB',
            job_site_address: 'Yard',
            job_source_type: 'live_quote',
            job_source_id: 'quote-v2',
          },
        ],
        error: null,
      },
      profiles: {
        data: [
          { id: 'user-old', full_name: 'Old Driver' },
          { id: 'user-new', full_name: 'Null Driver' },
        ],
        error: null,
      },
      vehicle_maintenance: { data: { id: 'm1', current_hours: 44 }, error: null },
      quotes: {
        data: [
          {
            id: 'quote-v2',
            quote_reference: '12345-AB',
            base_quote_reference: '12345-AB',
            subject_line: 'Exact V2 job',
            site_address: 'Exact V2 site',
            customer: { company_name: 'Exact V2 customer' },
          },
        ],
        error: null,
      },
      legacy_quotes: { data: [], error: null },
      quote_project_numbers: { data: [], error: null },
    });

    const payload = await loadAssetWhereabouts({
      admin,
      assetType: 'plant',
      assetId: 'plant-1',
      canOpenFleetHistory: false,
      now: new Date('2026-09-04T12:00:00.000Z'),
    });

    expect(payload?.lastDriverName).toBe('Null Driver');
    expect(payload?.events.some((event) => event.id === 'inspection:new-null')).toBe(true);
    expect(payload?.events.some((event) => event.source === 'allocation' && event.jobTitle === 'Exact V2 job')).toBe(
      true
    );
  });
});
