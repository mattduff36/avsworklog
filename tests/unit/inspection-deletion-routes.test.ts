import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  user: vi.fn(), role: vi.fn(), module: vi.fn(), database: vi.fn(),
  remove: vi.fn(), cleanup: vi.fn(), paused: vi.fn(), log: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock('@/lib/utils/view-as', () => ({ getEffectiveRole: mocks.role }));
vi.mock('@/lib/utils/rbac', () => ({ canEffectiveRoleAccessModule: mocks.module }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ storage: 'storage-client' }) }));
vi.mock('@/lib/server/van-inspections-maintenance', () => ({ getVanInspectionsMaintenanceResponse: mocks.paused }));
vi.mock('@/lib/utils/server-error-logger', () => ({ logServerError: mocks.log }));
vi.mock('@/lib/server/inspection-deletion', () => ({
  withInspectionDeletionDatabase: mocks.database, deleteInspection: mocks.remove, cleanupInspectionStorage: mocks.cleanup,
  InspectionDeletionError: class extends Error {
    constructor(message: string, public status: number) { super(message); }
  },
}));

import { DELETE as van } from '@/app/api/van-inspections/[id]/delete/route';
import { DELETE as plant } from '@/app/api/plant-inspections/[id]/delete/route';
import { DELETE as hgv } from '@/app/api/hgv-inspections/[id]/delete/route';
const routes = [{ kind: 'van', handler: van }, { kind: 'plant', handler: plant }, { kind: 'hgv', handler: hgv }];
const id = '11111111-1111-4111-8111-111111111111';
const request = () => new NextRequest('http://localhost/api/van-inspections/delete', { method: 'DELETE' });
const params = () => ({ params: Promise.resolve({ id }) });

describe('Daily Check deletion server permissions and truthful outcomes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.user.mockResolvedValue({ data: { user: { id: 'actor' } }, error: null });
    mocks.role.mockResolvedValue({ team_name: 'Workshop', is_manager_admin: true, role_class: 'manager' });
    mocks.module.mockResolvedValue(true);
    mocks.database.mockImplementation(work => work('database-client'));
    mocks.remove.mockImplementation(async () => ({ success: true, alreadyDeleted: false, warnings: [], storageCleanupPending: 0 }));
  });
  it.each(routes)('allows workshop managers to delete $kind without status gating', async ({ kind, handler }) => {
    const response = await handler(request(), params());
    expect(response.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith('database-client', kind, id, 'actor');
    expect(mocks.module).toHaveBeenCalledWith(kind === 'van' ? 'inspections' : `${kind}-inspections`);
  });
  it.each(routes)('denies ordinary users and non-workshop managers for $kind', async ({ handler }) => {
    for (const role of [
      { team_name: 'Workshop', role_class: 'employee' },
      { team_name: 'Civils', is_manager_admin: true, role_class: 'manager' },
      { team_name: 'Civils', role_class: 'employee', is_actual_super_admin: true, is_viewing_as: true },
    ]) {
      mocks.role.mockResolvedValue(role);
      expect((await handler(request(), params())).status).toBe(403);
    }
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it.each(routes)('fails closed on missing identity or module access for $kind', async ({ handler }) => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await handler(request(), params())).status).toBe(401);
    mocks.user.mockResolvedValue({ data: { user: { id: 'actor' } }, error: null });
    mocks.module.mockResolvedValue(false);
    expect((await handler(request(), params())).status).toBe(403);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('retains existing admin rights and the van maintenance gate', async () => {
    mocks.role.mockResolvedValue({ team_name: 'Civils', role_class: 'admin' });
    expect((await hgv(request(), params())).status).toBe(200);
    mocks.paused.mockReturnValue(NextResponse.json({ error: 'paused' }, { status: 423 }));
    expect((await van(request(), params())).status).toBe(423);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed IDs before opening a privileged database connection', async () => {
    expect((await van(request(), { params: Promise.resolve({ id: 'bad-id' }) })).status).toBe(400);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('returns committed deletion success with explicit pending cleanup when Storage fails', async () => {
    mocks.remove.mockResolvedValue({ success: true, alreadyDeleted: false, warnings: ['Missing baseline: reconcile'], storageCleanupPending: 2 });
    mocks.cleanup.mockRejectedValue(new Error('Sensitive internal Storage failure'));
    const response = await van(request(), params());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.storageCleanupPending).toBe(2);
    expect(result.warnings.join(' ')).toContain('Photo cleanup failed after deletion');
    expect(result.warnings.join(' ')).toContain('Missing baseline');
    expect(JSON.stringify(result)).not.toContain('Sensitive');
  });
  it('does not disclose raw database failures or claim a deletion on transaction failure', async () => {
    mocks.remove.mockRejectedValue(new Error('Sensitive connection details'));
    const response = await plant(request(), params());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('Sensitive');
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(Error) }));
  });
});
