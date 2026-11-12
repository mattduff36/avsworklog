import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ auth: vi.fn(), manager: vi.fn(), interval: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mock.auth } }) }));
vi.mock('@/lib/utils/rbac', () => ({ isEffectiveRoleManagerOrHigher: mock.manager }));
vi.mock('@/lib/server/asset-service', () => ({ plantServiceInterval: mock.interval, AssetServiceError: class extends Error {} }));
import { GET, PUT } from '@/app/api/maintenance/plant-service-interval/route';
const plantId = '20000000-0000-4000-8000-000000000001';
const put = (body: unknown) => PUT(new NextRequest('http://localhost/api/maintenance/plant-service-interval', {
  method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
}));
describe('Plant service interval manager endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.auth.mockResolvedValue({ data: { user: { id: 'actor' } }, error: null });
    mock.manager.mockResolvedValue(true);
    mock.interval.mockResolvedValue({ globalIntervalHours: 500, overrideIntervalHours: 250, effectiveIntervalHours: 250 });
  });
  it('requires authentication and manager rights before reading or writing', async () => {
    mock.auth.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await put({ plantId, intervalHours: 250 })).status).toBe(401);
    mock.manager.mockResolvedValue(false);
    expect((await put({ plantId, intervalHours: 250 })).status).toBe(403);
    expect((await GET(new NextRequest(`http://localhost/api/maintenance/plant-service-interval?plantId=${plantId}`))).status).toBe(403);
    expect(mock.interval).not.toHaveBeenCalled();
  });
  it.each([0, -1, 0.5, 1000001, '250', undefined])('rejects invalid interval %s', async intervalHours => {
    expect((await put({ plantId, intervalHours })).status).toBe(400);
    expect(mock.interval).not.toHaveBeenCalled();
  });
  it('uses the authenticated actor and supports restoring the global interval', async () => {
    expect((await put({ plantId, intervalHours: 250 })).status).toBe(200);
    expect(mock.interval).toHaveBeenLastCalledWith(plantId, { intervalHours: 250, actorId: 'actor' });
    expect((await put({ plantId, intervalHours: null })).status).toBe(200);
    expect(mock.interval).toHaveBeenLastCalledWith(plantId, { intervalHours: null, actorId: 'actor' });
    expect((await put({ plantId, intervalHours: 250, actorId: 'forged' })).status).toBe(400);
  });
});
