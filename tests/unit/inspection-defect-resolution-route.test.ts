import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseQueryMock } from '@/tests/utils/supabase-query-mock';

const mocks = vi.hoisted(() => ({
  access: vi.fn(), admin: vi.fn(), from: vi.fn(), maintenance: vi.fn(), log: vi.fn(),
}));
vi.mock('@/lib/server/inspection-route-access', () => ({ getInspectionRouteActorAccess: mocks.access }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/server/van-inspections-maintenance', () => ({ getVanInspectionsMaintenanceResponse: mocks.maintenance }));
vi.mock('@/lib/utils/server-error-logger', () => ({ logServerError: mocks.log }));
import { POST } from '@/app/api/van-inspections/[id]/resolve-defects/route';

const id = '11111111-1111-4111-8111-111111111111';
const resolution = { itemNumber: 1, itemDescription: 'Lights', comment: 'Bulb replaced' };
const query = <T>(data: T, error: unknown = null) =>
  createSupabaseQueryMock({ data, error }, ['select', 'eq', 'in', 'maybeSingle', 'update']);
const request = (body: unknown = { resolutions: [resolution] }) => new NextRequest('http://localhost/api/resolve-defects', {
  method: 'POST', body: JSON.stringify(body),
});
const params = () => ({ params: Promise.resolve({ id }) });

describe('Van resolved-defect causal writes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.access.mockResolvedValue({ access: { userId: 'actor', canManageOthers: false }, errorResponse: null });
    mocks.admin.mockReturnValue({ from: mocks.from });
  });
  function arrange(check = { van_id: 'van', user_id: 'actor' }, status = 'ok', updateError: unknown = null) {
    const targets = query([{ id: 'task', inspection_item_id: 'item', description: 'Broken light' }]);
    const update = query(null, updateError);
    mocks.from
      .mockReturnValueOnce(query(check))
      .mockReturnValueOnce(query([{ item_number: 1, item_description: 'Lights', status }]))
      .mockReturnValueOnce(targets)
      .mockReturnValueOnce(query([{ id: 'item', item_number: 1, item_description: 'Lights' }]))
      .mockReturnValueOnce(update);
    return { targets, update };
  }
  it('completes only open inspection defects on the linked asset with explicit source and actor', async () => {
    const { targets, update } = arrange();
    expect((await POST(request(), params())).status).toBe(200);
    expect(targets.eq).toHaveBeenCalledWith('van_id', 'van');
    expect(targets.eq).toHaveBeenCalledWith('action_type', 'inspection_defect');
    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed', daily_check_source_id: id, daily_check_source_type: 'van', actioned_by: 'actor',
      description: 'Broken light\n\nResolution: Bulb replaced',
    }));
    expect(update.in).toHaveBeenCalledWith('status', ['pending', 'logged']);
  });
  it.each([401, 403])('does not create an admin client for denied access (%s)', async status => {
    mocks.access.mockResolvedValue({ access: null, errorResponse: NextResponse.json({ error: 'denied' }, { status }) });
    expect((await POST(request(), params())).status).toBe(status);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('preserves the van maintenance gate', async () => {
    mocks.maintenance.mockReturnValue(NextResponse.json({ error: 'paused' }, { status: 423 }));
    expect((await POST(request(), params())).status).toBe(423);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON and unrecognized input before privileged reads', async () => {
    const malformed = new NextRequest('http://localhost/api/resolve-defects', { method: 'POST', body: '{' });
    expect((await POST(malformed, params())).status).toBe(400);
    expect((await POST(request({ resolutions: [resolution], role: 'admin' }), params())).status).toBe(400);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('does not allow an ordinary inspector to resolve from another user check', async () => {
    arrange({ van_id: 'van', user_id: 'other' });
    expect((await POST(request(), params())).status).toBe(403);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
  it('allows the existing manager override without accepting a client actor', async () => {
    mocks.access.mockResolvedValue({ access: { userId: 'actor', canManageOthers: true }, errorResponse: null });
    const { update } = arrange({ van_id: 'van', user_id: 'other' });
    expect((await POST(request(), params())).status).toBe(200);
    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ actioned_by: 'actor' }));
  });
  it('rejects resolutions not confirmed by persisted answers', async () => {
    arrange(undefined, 'attention');
    expect((await POST(request(), params())).status).toBe(409);
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });
  it('reports a deleted source as a conflict and sanitizes unexpected failures', async () => {
    arrange(undefined, 'ok', { code: '23503', message: 'private details' });
    expect((await POST(request(), params())).status).toBe(409);
    mocks.from.mockReset();
    mocks.from.mockReturnValue(query(null, { message: 'private details' }));
    const response = await POST(request(), params());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('private details');
    expect(mocks.log).toHaveBeenCalled();
  });
});
