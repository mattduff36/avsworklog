import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseQueryMock } from '@/tests/utils/supabase-query-mock';

const mocks = vi.hoisted(() => ({
  current: vi.fn(), module: vi.fn(), access: vi.fn(), from: vi.fn(), complete: vi.fn(), draft: vi.fn(), log: vi.fn(),
}));
vi.mock('@/lib/server/app-auth/session', () => ({ getCurrentAuthenticatedProfile: mocks.current }));
vi.mock('@/lib/utils/rbac', () => ({ canEffectiveRoleAccessModule: mocks.module }));
vi.mock('@/lib/server/inspection-route-access', () => ({ getInspectionRouteActorAccess: mocks.access }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock('@/lib/server/reminders/complete-reminder-action', () => ({
  completeReminderActionForAsset: mocks.complete, completeVanDraftSubmissionReminder: mocks.draft,
}));
vi.mock('@/lib/utils/server-error-logger', () => ({ logServerError: mocks.log }));
import { POST } from '@/app/api/reminders/complete-inspection-action/route';

const actor = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const request = (extra: Record<string, unknown> = {}) => new NextRequest('http://localhost/api/reminders/complete-inspection-action', {
  method: 'POST', body: JSON.stringify({ assetType: 'van', assetId: 'asset', assignedTo: actor, inspectionId: id, ...extra }),
});
const checkQuery = (check: { user_id: string; status: string } | null) =>
  createSupabaseQueryMock({ data: check, error: null }, ['select', 'eq', 'maybeSingle']);

describe('Daily Check reminder causal-source validation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.current.mockResolvedValue({ profile: { id: actor } });
    mocks.module.mockResolvedValue(true);
    mocks.access.mockResolvedValue({ access: { userId: actor, canManageOthers: false }, errorResponse: null });
    mocks.from.mockReturnValue(checkQuery({ user_id: actor, status: 'submitted' }));
    mocks.complete.mockResolvedValue({ actionedCount: 1, cancelledCount: 0, actionIds: ['action'] });
    mocks.draft.mockResolvedValue({ actionedCount: 0, cancelledCount: 0, actionIds: [] });
  });
  it.each(['van', 'plant', 'hgv'])('binds a submitted %s source to its persisted asset and actor', async assetType => {
    const response = await POST(request({ assetType }));
    expect(response.status).toBe(200);
    expect(mocks.from).toHaveBeenCalledWith(`${assetType}_inspections`);
    const query = mocks.from.mock.results[0].value;
    expect(query.eq).toHaveBeenCalledWith(`${assetType}_id`, 'asset');
    expect(query.eq).toHaveBeenCalledWith('id', id);
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ inspectionId: id, actionedBy: actor, assetType }));
  });
  it('fails closed on missing session, module access and source access', async () => {
    mocks.current.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    mocks.current.mockResolvedValue({ profile: { id: actor } });
    mocks.module.mockResolvedValue(false);
    expect((await POST(request())).status).toBe(403);
    mocks.module.mockResolvedValue(true);
    mocks.access.mockResolvedValue({ access: null, errorResponse: NextResponse.json({ error: 'denied' }, { status: 403 }) });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it.each([
    { user_id: actor, status: 'draft' },
    { user_id: 'another-user', status: 'submitted' },
  ])('rejects invalid source ownership or status: %j', async check => {
    mocks.from.mockReturnValue(checkQuery(check));
    expect((await POST(request())).status).toBe(403);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('rejects an absent or wrong-asset check and mismatched assignee', async () => {
    mocks.from.mockReturnValue(checkQuery(null));
    expect((await POST(request())).status).toBe(404);
    mocks.from.mockReturnValue(checkQuery({ user_id: actor, status: 'submitted' }));
    expect((await POST(request({ assignedTo: id }))).status).toBe(403);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('allows the existing manager override only when the assignee is the persisted submitter', async () => {
    mocks.access.mockResolvedValue({ access: { userId: actor, canManageOthers: true }, errorResponse: null });
    mocks.from.mockReturnValue(checkQuery({ user_id: id, status: 'submitted' }));
    expect((await POST(request({ assignedTo: id }))).status).toBe(200);
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: id, actionedBy: actor }));
  });
  it('rejects draft/check mismatches and non-van draft sources before any mutation', async () => {
    expect((await POST(request({ draftInspectionId: actor }))).status).toBe(400);
    expect((await POST(request({ draftInspectionId: id, assetType: 'plant' }))).status).toBe(400);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.draft).not.toHaveBeenCalled();
  });
  it('validates and attributes legacy draft-only requests to the same submitted check', async () => {
    expect((await POST(request({ inspectionId: undefined, draftInspectionId: id }))).status).toBe(200);
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ inspectionId: id }));
    expect(mocks.draft).toHaveBeenCalledWith(expect.objectContaining({ draftInspectionId: id }));
  });
});
