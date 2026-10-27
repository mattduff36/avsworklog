import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { serviceStateSnapshot } from '@/lib/utils/maintenance-service-state-edit';
import { PUT } from '@/app/api/maintenance/[id]/route';

const state = vi.hoisted(() => ({
  manager: false,
  casMiss: false,
  authStatus: 200,
  current: {} as Record<string, unknown>,
  writes: [] as Array<{ table: string; values: Record<string, unknown> }>,
  filters: [] as Array<{ table: string; key: string; value: unknown }>,
  missing: '' as string,
  updateError: null as null | { code: string; message: string },
}));
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
      if (table === 'maintenance_categories') return { data: { id: 'category', workshop_category_id: 'workshop' }, error: null };
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
  return PUT(new NextRequest('http://localhost/api/maintenance/record', { method: 'PUT',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment: 'Fixture maintenance update', expected_service_state: serviceStateSnapshot(state.current), ...values }) }),
  { params: Promise.resolve({ id: 'record' }) });
}

describe('maintenance update service-state guard', () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.manager = false; state.casMiss = false; state.authStatus = 200; state.missing = ''; state.updateError = null;
    state.writes = []; state.filters = [];
    state.current = { id: 'record', van_id: 'van', hgv_id: null, plant_id: null,
      current_mileage: 5000, last_service_mileage: 0, next_service_mileage: 10000,
      last_service_hours: null, next_service_hours: null, next_service_template_id: null,
      next_service_rotation_step_id: null };
  });
  it.each([401, 403])('preserves module denial %s without writes', async (status) => {
    state.authStatus = status;
    expect((await update({ current_mileage: 5100 })).status).toBe(status);
    expect(state.writes).toHaveLength(0);
  });
  it('denies actual protected changes before custom values or maintenance/history writes', async () => {
    const response = await update({ next_service_mileage: 20000, custom_items: [{ category_id: 'custom', due_mileage: 12 }] });
    expect(response.status).toBe(403); expect(state.writes).toHaveLength(0);
  });
  it('allows ordinary non-manager edits and omits unchanged protected fields', async () => {
    const response = await update({ current_mileage: 5100, next_service_mileage: 10000, last_service_mileage: 0 });
    expect(response.status).toBe(200);
    const write = state.writes.find(({ table }) => table === 'vehicle_maintenance')!.values;
    expect(write.current_mileage).toBe(5100); expect(write).not.toHaveProperty('next_service_mileage');
    expect(write).not.toHaveProperty('last_service_mileage');
  });
  it('does not treat zero and null as unchanged', async () => {
    expect((await update({ last_service_mileage: null })).status).toBe(403);
    expect(state.writes).toHaveLength(0);
  });
  it('manager can save zero and an asset-scoped published next type with its cursor', async () => {
    state.manager = true;
    const response = await update({ last_service_mileage: 0, next_service_template_id: TEMPLATE_ID });
    expect(response.status).toBe(200);
    const write = state.writes.find(({ table }) => table === 'vehicle_maintenance')!.values;
    expect(write).toMatchObject({ next_service_template_id: TEMPLATE_ID, next_service_rotation_step_id: 'step' });
    expect(state.filters).toContainEqual({ table: 'maintenance_categories', key: 'config_key', value: 'service_van' });
    expect(state.filters).toContainEqual({ table: 'workshop_attachment_templates', key: 'applies_to', value: ['van'] });
    expect(state.filters).toContainEqual({ table: 'workshop_attachment_template_versions', key: 'status', value: 'published' });
    expect(JSON.stringify(state.writes.filter(({ table }) => table === 'maintenance_history'))).toContain('next_service_type');
  });
  it.each(['service_rotation_steps', 'workshop_attachment_templates', 'workshop_category_attachment_templates', 'workshop_attachment_template_versions'])(
    'rejects missing/incompatible %s before any writes', async (table) => {
      state.manager = true; state.missing = table;
      expect((await update({ next_service_template_id: TEMPLATE_ID })).status).toBe(400);
      expect(state.writes).toHaveLength(0);
    });
  it('manager clearing next type clears both template and rotation position', async () => {
    state.manager = true; state.current.next_service_template_id = TEMPLATE_ID; state.current.next_service_rotation_step_id = 'step';
    expect((await update({ next_service_template_id: null })).status).toBe(200);
    expect(state.writes.find(({ table }) => table === 'vehicle_maintenance')!.values).toMatchObject({ next_service_template_id: null, next_service_rotation_step_id: null });
  });
  it('retains the second HGV Basic A cursor when its next template is unchanged', async () => {
    state.manager = true;
    Object.assign(state.current, { van_id: null, hgv_id: 'hgv', next_service_template_id: TEMPLATE_ID, next_service_rotation_step_id: 'second-basic-a' });
    expect((await update({ next_service_template_id: TEMPLATE_ID, current_mileage: 5100 })).status).toBe(200);
    expect(state.writes.find(({ table }) => table === 'vehicle_maintenance')!.values).not.toHaveProperty('next_service_rotation_step_id');
  });
  it('rejects stale intentional service edits before custom writes', async () => {
    state.manager = true;
    const expected = serviceStateSnapshot(state.current);
    state.current.next_service_mileage = 30000;
    expect((await update({ next_service_mileage: 20000, expected_service_state: expected, custom_items: [{ category_id: 'custom', due_mileage: 2 }] })).status).toBe(409);
    expect(state.writes).toHaveLength(0);
  });
  it('requires a snapshot for intentional service changes', async () => {
    state.manager = true;
    expect((await update({ next_service_mileage: 20000, expected_service_state: undefined })).status).toBe(409);
    expect(state.writes).toHaveLength(0);
  });
  it('returns409 without history or custom mutations when completion races the final update', async () => {
    state.manager = true; state.casMiss = true;
    expect((await update({ next_service_mileage: 20000, custom_items: [{ category_id: 'custom', due_mileage: 2 }] })).status).toBe(409);
    expect(state.writes.map(write => write.table)).toEqual(['vehicle_maintenance']);
    expect(state.filters).toContainEqual({ table: 'vehicle_maintenance', key: 'next_service_mileage', value: 10000 });
    expect(state.filters).toContainEqual({ table: 'vehicle_maintenance', key: 'last_service_mileage', value: 0 });
    expect(state.filters).toContainEqual({ table: 'vehicle_maintenance', key: 'next_service_rotation_step_id', value: null });
  });
  it('maps a retained database permission denial to403 instead of500', async () => {
    state.manager = true; state.updateError = { code: '42501', message: 'Manager or admin required to update service state' };
    expect((await update({ next_service_mileage: 20000 })).status).toBe(403);
  });
});
