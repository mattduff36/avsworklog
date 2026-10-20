import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({ role: vi.fn(), level: vi.fn(), pin: vi.fn(), handler: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/utils/view-as', () => ({ getEffectiveRole: mocks.role }));
vi.mock('@/lib/utils/rbac', () => ({ getEffectiveModuleAccessLevel: mocks.level }));
vi.mock('@/lib/server/sensitive-module-access', () => ({ requireSensitiveModuleAccess: mocks.pin }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/server/policy-documents-service', () => ({ handlePolicyRequest: mocks.handler }));
import { policyDocumentsRoute } from '@/lib/server/policy-documents';
beforeEach(() => {
  vi.resetAllMocks(); mocks.role.mockResolvedValue({ user_id: 'effective-user' });
  mocks.level.mockResolvedValue(4); mocks.pin.mockResolvedValue(null);
  mocks.handler.mockResolvedValue(NextResponse.json({ documents: [] }));
});
describe('Policy route authorization boundary', () => {
  it('rejects unauthenticated and denied users before accessing data or storage', async () => {
    mocks.role.mockResolvedValue({ user_id: null });
    expect((await policyDocumentsRoute(new NextRequest('http://localhost/api/policies-procedures'))).status).toBe(401);
    mocks.role.mockResolvedValue({ user_id: 'effective-user' }); mocks.level.mockResolvedValue(0);
    expect((await policyDocumentsRoute(new NextRequest('http://localhost/api/policies-procedures'))).status).toBe(403);
    expect(mocks.handler).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('permits readers but denies their mutations', async () => {
    mocks.level.mockResolvedValue(1);
    expect((await policyDocumentsRoute(new NextRequest('http://localhost/api/policies-procedures'))).status).toBe(200);
    expect(mocks.handler).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'effective-user', level: 1 }), undefined, false);
    mocks.handler.mockClear();
    expect((await policyDocumentsRoute(new NextRequest('http://localhost/api/policies-procedures', { method: 'POST' }))).status).toBe(403);
    expect(mocks.handler).not.toHaveBeenCalled();
  });
  it('enforces the sensitive-module PIN even for document controllers', async () => {
    mocks.pin.mockResolvedValue(NextResponse.json({ error: 'PIN required' }, { status: 423 }));
    expect((await policyDocumentsRoute(new NextRequest('http://localhost/api/policies-procedures'))).status).toBe(423);
    expect(mocks.pin).toHaveBeenCalledWith('policies-procedures');
    expect(mocks.handler).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });
});
