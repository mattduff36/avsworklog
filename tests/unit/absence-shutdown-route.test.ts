import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  user: { id: 'fixture-actor' } as { id: string } | null,
  allowed: true, scope: true,
  book: vi.fn(), list: vi.fn(), undo: vi.fn(), log: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }) }));
vi.mock('@/lib/utils/permissions', () => ({ getProfileWithRole: async () => ({ id: 'fixture-actor' }) }));
vi.mock('@/lib/utils/rbac', () => ({ canEffectiveRoleAccessModule: async () => mocks.allowed }));
vi.mock('@/lib/utils/view-as', () => ({ getEffectiveRole: async () => ({ user_id: 'fixture-actor', role_name: 'fixture-role' }) }));
vi.mock('@/lib/utils/role-access', () => ({ hasEffectiveRoleFullAccess: () => false }));
vi.mock('@/lib/server/absence-secondary-permissions', () => ({ getActorAbsenceSecondaryPermissions: async () => ({ effective: { see_manage_overview_all: mocks.scope } }) }));
vi.mock('@/lib/services/absence-bank-holiday-sync', () => ({ bookBulkAbsence: mocks.book, listBulkAbsenceBatches: mocks.list, undoBulkAbsenceBatch: mocks.undo }));
vi.mock('@/lib/utils/server-error-logger', () => ({ logServerError: mocks.log }));
import { GET, POST, DELETE } from '@/app/api/absence/shutdown/route';

const body = { reasonId: 'fixture-reason', startDate: '2026-10-14', notes: 'private booking notes', employeeIds: ['private-selection'] };
const request = (payload: object, method = 'POST') => new NextRequest('http://localhost/api/absence/shutdown', { method, body: JSON.stringify(payload) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'fixture-actor' }; mocks.allowed = true; mocks.scope = true;
  mocks.book.mockResolvedValue({ createdCount: 0, wouldCreate: 2 });
  mocks.list.mockResolvedValue([]); mocks.undo.mockResolvedValue({ removedCount: 1 }); mocks.log.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('bulk absence route failure boundaries', () => {
  it('retains 401 and 403 responses without invoking booking', async () => {
    mocks.user = null; expect((await POST(request(body))).status).toBe(401);
    mocks.user = { id: 'fixture-actor' }; mocks.allowed = false; expect((await POST(request(body))).status).toBe(403);
    mocks.allowed = true; mocks.scope = false; expect((await POST(request(body))).status).toBe(403);
    expect(mocks.book).not.toHaveBeenCalled();
  });
  it('rejects missing required inputs before invoking booking', async () => {
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request({ reasonId: 'fixture' }))).status).toBe(400);
    expect(mocks.book).not.toHaveBeenCalled();
  });
  it('preserves preview and confirm intent and successful responses', async () => {
    const preview = await POST(request(body));
    expect(preview.status).toBe(200); expect(await preview.json()).toMatchObject({ success: true, wouldCreate: 2 });
    expect(mocks.book).toHaveBeenLastCalledWith(expect.objectContaining({ confirm: false }));
    await POST(request({ ...body, confirm: true }));
    expect(mocks.book).toHaveBeenLastCalledWith(expect.objectContaining({ confirm: true }));
  });
  it('persists plain database failures while keeping a generic failed client response', async () => {
    mocks.book.mockRejectedValue({ message: 'Fixture database constraint failure', code: '23514', details: 'private row details' });
    const response = await POST(request(body));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Failed to book bulk absence' });
    const record = mocks.log.mock.calls[0][0];
    expect(record.error.message).toBe('Fixture database constraint failure');
    expect(record.additionalData).toEqual({ operation: 'book', databaseCode: '23514' });
    expect(JSON.stringify(record.additionalData)).not.toMatch(/private|employeeIds|notes|details/);
  });
  it('keeps original Error failures and does not turn diagnostic failure into success', async () => {
    mocks.book.mockRejectedValue(new Error('Selected date range does not include a working day'));
    mocks.log.mockRejectedValue(new Error('Logger unavailable'));
    const response = await POST(request(body));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false, error: 'Selected date range does not include a working day' });
  });
  it('also persists list and undo failures', async () => {
    mocks.list.mockRejectedValue({ message: 'List failed', code: '42501' });
    mocks.undo.mockRejectedValue({ message: 'Undo failed', code: '23503' });
    expect((await GET()).status).toBe(500);
    expect((await DELETE(request({ batchId: 'fixture-batch' }, 'DELETE'))).status).toBe(500);
    expect(mocks.log.mock.calls.map(([entry]) => entry.additionalData.operation)).toEqual(['list', 'undo']);
  });
});
