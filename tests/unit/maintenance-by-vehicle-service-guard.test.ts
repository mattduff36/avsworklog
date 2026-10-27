import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { serviceStateSnapshot } from '@/lib/utils/maintenance-service-state-edit';
import { POST } from '@/app/api/maintenance/by-vehicle/[vehicleId]/route';

const state = vi.hoisted(() => ({
  manager: false,
  autoPlan: null as null | Record<string, unknown>,
  casMiss: false,
  authStatus: 200,
  current: {} as Record<string, unknown>,
  writes: [] as Array<{ table: string; values: Record<string, unknown> }>,
  filters: [] as Array<{ table: string; key: string; value: unknown }>,
  missing: '' as string,
  updateError: null as null | { code: string; message: string },
}));
vi.mock('@/lib/server/asset-service', () => ({ getServiceSettings: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/utils/workshopMaintenanceSync', () => ({ buildAutomaticMaintenancePlan: vi.fn(() => state.autoPlan) }));
vi.mock('@/lib/utils/rbac', () => ({ isEffectiveRoleManagerOrHigher: vi.fn(async () => state.manager) }));
vi.mock('@/lib/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/server/fleet-maintenance-auth', () => ({
  requireMaintenanceLevel: vi.fn(async () => state.authStatus === 200
    ? { user: { id: 'actor' }, response: null }
    : { user: null, response: NextResponse.json({ error: 'Denied' }, { status: state.authStatus }) }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({
  from(table: string) {
    let operation = 'read';
    let selectedId: unknown;
    let listCategories = false;
    const query: Record<string, unknown> = {};
    const result = () => {
      if (table === 'vehicle_maintenance') return { data: operation === 'update' && state.casMiss ? null : state.current, error: operation === 'update' ? state.updateError : null };
      if (table === 'profiles') return { data: { full_name: 'Fixture' }, error: null };
      if (state.missing === table) return { data: null, error: null };
      if (table === 'maintenance_categories' && listCategories) return { data: [{ id: 'custom', name: 'Fixture', type: 'mileage', field_key: null }], error: null };
      if (table === 'maintenance_categories') return { data: [{ id: 'custom', name: 'Fixture', type: 'mileage', field_key: null }], error: null };
      if (table === 'plant') return { data: { id: 'asset', loler_due_date: '2026-01-01' }, error: null };
      if (table === 'service_rotation_steps') return { data: { id: selectedId || 'step', attachment_template_id: TEMPLATE_ID }, error: null };
      if (table === 'workshop_attachment_templates') return { data: { id: TEMPLATE_ID, applies_to: ['van'], is_active: true }, error: null };
      if (table === 'workshop_category_attachment_templates') return { data: { template_id: TEMPLATE_ID }, error: null };
      if (table === 'workshop_attachment_template_versions') return { data: { id: 'published' }, error: null };
      return { data: [], error: null };
    };
    for (const method of ['select', 'order', 'limit']) query[method] = () => query;
    for (const method of ['eq', 'contains', 'is', 'in']) query[method] = (key: string, value: unknown) => {
      if (key === 'id') selectedId = value;
      if (method === 'in') listCategories = true;
      state.filters.push({ table, key, value }); return query;
    };
    for (const method of ['update', 'insert', 'upsert']) query[method] = (values: Record<string, unknown>) => {
      operation = method; state.writes.push({ table, values }); return query;
    };
    query.single = async () => result();
    query.maybeSingle = async () => result();
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return query;
  },
})) }));

const TEMPLATE_ID = '98877178-d046-4b18-9a53-f6906c2d81d3';
async function update(values: Record<string, unknown>) {
  return POST(new NextRequest('http://localhost/api/maintenance/by-vehicle/asset?assetType=van', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment: 'Fixture maintenance update', assetType: 'van', expected_service_state: serviceStateSnapshot(state.current), ...values }) }),
  { params: Promise.resolve({ vehicleId: 'asset' }) });
}


describe('by-vehicle service snapshot guard', () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.manager = true; state.casMiss = false; state.authStatus = 200; state.missing = ''; state.updateError = null; state.autoPlan = null;
    state.writes = []; state.filters = [];
    state.current = { id: 'record', van_id: 'asset', hgv_id: null, plant_id: null, current_mileage: 5000,
      last_service_mileage: 0, next_service_mileage: 10000, last_service_hours: null, next_service_hours: null,
      next_service_template_id: null, next_service_rotation_step_id: null };
  });
  it('rejects all protected non-manager changes before any writes', async () => {
    state.manager = false;
    expect((await update({ last_service_mileage: 10 })).status).toBe(403);
    expect(state.writes).toHaveLength(0);
  });
  it('rejects stale expected service state before custom or plant writes', async () => {
    const oldState = serviceStateSnapshot(state.current);
    state.current.next_service_mileage = 30000;
    expect((await update({ next_service_mileage: 20000, expected_service_state: oldState, custom_items: [{ category_id: 'custom', due_mileage: 2 }] })).status).toBe(409);
    expect(state.writes).toHaveLength(0);
  });
  it('completion racing final update returns409 with no custom, plant, or history writes', async () => {
    state.casMiss = true; state.current.van_id = null; state.current.plant_id = 'asset';
    expect((await update({ assetType: 'plant', next_service_hours: 100, loler_due_date: '2027-01-01', custom_items: [{ category_id: 'custom', due_mileage: 2 }] })).status).toBe(409);
    expect(state.writes.map(write => write.table)).toEqual(['vehicle_maintenance']);
  });
  it('omits unchanged manager service fields on unrelated updates', async () => {
    expect((await update({ next_service_mileage: 10000, current_mileage: 5100 })).status).toBe(200);
    expect(state.writes.find(write => write.table === 'vehicle_maintenance')!.values).not.toHaveProperty('next_service_mileage');
  });
  it('retains automatic non-service flows without a service snapshot', async () => {
    state.manager = false;
    state.autoPlan = { maintenanceUpdates: { tax_due_date: '2027-01-01' }, customItems: [], plantUpdates: {} };
    expect((await update({ expected_service_state: undefined })).status).toBe(200);
    expect(state.writes.find(write => write.table === 'vehicle_maintenance')!.values.tax_due_date).toBe('2027-01-01');
  });
});
