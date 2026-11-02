import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ session: vi.fn(), role: vi.fn(), module: vi.fn(), database: vi.fn(), correct: vi.fn(), snapshot: vi.fn(), paused: vi.fn() }));
vi.mock('@/lib/server/app-auth/session', () => ({ validateAppSession: mocks.session }));
vi.mock('@/lib/utils/view-as', () => ({ getEffectiveRoleForUser: mocks.role }));
vi.mock('@/lib/utils/rbac', () => ({ canEffectiveRoleAccessModule: mocks.module }));
vi.mock('@/lib/server/van-inspections-maintenance', () => ({ getVanInspectionsMaintenanceResponse: mocks.paused }));
vi.mock('@/lib/server/inspection-meter-correction', () => ({
  withInspectionMeterDatabase: mocks.database, correctInspectionMeter: mocks.correct, getInspectionMeterSnapshot: mocks.snapshot,
  InspectionMeterCorrectionError: class extends Error {},
}));
import { GET, PATCH } from '@/app/api/inspection-meter-corrections/route';

const id = '11111111-1111-4111-8111-111111111111';
const body = { assetType: 'van', inspectionId: id, reading: 0, expectedReading: 10, expectedVersion: 'version' };
const request = (data: unknown = body) => new NextRequest('http://localhost/api/inspection-meter-corrections', { method: 'PATCH', body: JSON.stringify(data) });

describe('Daily Check reading API authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ status: 'active', profileId: 'actual-actor' });
    mocks.role.mockResolvedValue({ role_class: 'manager' });
    mocks.module.mockResolvedValue(true);
    mocks.database.mockImplementation(work => work('database-client'));
    mocks.correct.mockResolvedValue({ reading: 0 });
    mocks.snapshot.mockResolvedValue({ reading: 10, version: 'version', history: [] });
  });
  it.each(['van', 'plant', 'hgv'])('allows managers across teams in %s', async assetType => {
    expect((await PATCH(request({ ...body, assetType }))).status).toBe(200);
    expect(mocks.correct).toHaveBeenCalledWith('database-client', 'actual-actor', expect.objectContaining({ assetType }));
    expect(mocks.module).toHaveBeenCalledWith(assetType === 'van' ? 'inspections' : `${assetType}-inspections`, { userId: 'actual-actor', email: undefined });
    expect(mocks.session).toHaveBeenCalledWith({ includeEmail: true, refresh: false });
    expect(mocks.role).toHaveBeenCalledWith('actual-actor', undefined);
  });
  it.each([{ role_class: 'admin' }, { is_super_admin: true }])('allows admin/superadmin', async role => {
    mocks.role.mockResolvedValue(role);
    expect((await PATCH(request())).status).toBe(200);
  });
  it.each([{ role_class: 'employee' }, { role_class: 'employee', role_name: 'Supervisor' },
    { role_class: 'employee', is_actual_super_admin: true, is_viewing_as: true }, null])('denies roles without manager access', async role => {
    mocks.role.mockResolvedValue(role);
    expect((await PATCH(request())).status).toBe(403);
    expect(mocks.database).not.toHaveBeenCalled();
    expect((await GET(new NextRequest(`http://localhost/api/inspection-meter-corrections?assetType=van&inspectionId=${id}`))).status).toBe(403);
  });
  it('denies unauthenticated users and managers without module access', async () => {
    mocks.session.mockResolvedValue({ status: 'invalid' });
    expect((await PATCH(request())).status).toBe(401);
    mocks.session.mockResolvedValue({ status: 'active', profileId: id });
    mocks.module.mockResolvedValue(false);
    expect((await PATCH(request())).status).toBe(403);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('uses a fresh snapshot with cache disabled', async () => {
    const response = await GET(new NextRequest(`http://localhost/api/inspection-meter-corrections?assetType=van&inspectionId=${id}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('honours the van maintenance pause', async () => {
    mocks.paused.mockReturnValue(new Response('{}', { status: 423 }));
    expect((await PATCH(request())).status).toBe(423);
    expect(mocks.correct).not.toHaveBeenCalled();
  });
  it('rejects attempts to edit other fields or spoof an actor', async () => {
    expect((await PATCH(request({ ...body, status: 'draft' }))).status).toBe(400);
    expect((await PATCH(request({ ...body, actorId: id }))).status).toBe(400);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it('returns safe conflict errors for concurrent database changes', async () => {
    mocks.correct.mockRejectedValue({ code: '40P01', message: 'sensitive internal SQL' });
    const response = await PATCH(request());
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain('sensitive');
  });
});
