import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeGuest, guestError, guestHash, guestRead, readGuestJson, startGuestSession, submitGuestPlant } from '@/lib/server/guest-plant-checks';
import { POST as uploadPhoto } from '@/app/api/guest-plant-checks/photos/route';
import { GET, PUT } from '@/app/api/admin/settings/guest-plant-checks/route';
import { guestInspectorName, guestPlantRoleCanRead, londonToday, numericJobCode } from '@/lib/inspections/guest-plant';
import { filterGuestPlantReportSubjects, filterHiddenReportSubjects } from '@/lib/server/system-accounts';
import { heavyRowStillAuthorised } from '@/lib/server/inspection-export-manifest';

const state = vi.hoisted(() => ({ access: vi.fn(), database: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server/admin-settings-access', () => ({ requireAdminSettingsAccess: state.access }));
vi.mock('@/lib/server/inspection-deletion', () => ({ withInspectionDeletionDatabase: state.database }));
const request = (body = '{}', origin = 'https://squires.test') => new NextRequest('https://squires.test/api/admin/settings/guest-plant-checks', { method: 'PUT', headers: { origin, 'content-type': 'application/json' }, body });

describe('Guest QR boundary and report access', () => {
  beforeEach(() => { vi.clearAllMocks(); state.access.mockResolvedValue({ userId: 'admin' }); });
  it('requires exact same origin and bounds streamed input without trusting Content-Length', async () => {
    await expect(readGuestJson(request('{}', 'https://elsewhere.test'))).rejects.toMatchObject({ status: 403 });
    await expect(readGuestJson(request('x'.repeat(400001)))).rejects.toMatchObject({ status: 413 });
    await expect(readGuestJson(request('{'))).rejects.toMatchObject({ status: 400 });
    expect(await readGuestJson(request('{"enabled":true}'))).toEqual({ enabled: true });
  });
  it('denies guest reads without a scoped cookie before accessing settings', async () => {
    const query = vi.fn();
    await expect(authorizeGuest({ query }, request())).rejects.toMatchObject({ status: 401 });
    expect(query).not.toHaveBeenCalled();
    await expect(guestRead(request())).rejects.toMatchObject({ status: 401 });
    await expect(submitGuestPlant(request(), {})).rejects.toMatchObject({ status: 401 });
    await expect(startGuestSession(request(), 'invalid')).rejects.toMatchObject({ status: 403 });
    expect((await uploadPhoto(request())).status).toBe(401);
    expect(state.database).not.toHaveBeenCalled();
  });
  it('rejects disabled, expired and rotated sessions', async () => {
    for (const [enabled, generation, sessions] of [[false, 1, [{ id: 's', generation: 1 }]], [true, 1, []], [true, 2, [{ id: 's', generation: 1 }]]] as const) {
      const query = vi.fn().mockResolvedValueOnce({ rows: [{ enabled, generation }] }).mockResolvedValueOnce({ rows: sessions });
      const req = request(); req.cookies.set('avs_guest_plant', 'a'.repeat(64));
      await expect(authorizeGuest({ query }, req)).rejects.toMatchObject({ status: 401 });
    }
  });
  it('honours the existing sensitive Admin Settings denial before reading or mutating QR settings', async () => {
    state.access.mockResolvedValue({ response: NextResponse.json({ error: 'denied' }, { status: 403 }) });
    expect((await GET()).status).toBe(403); expect((await PUT(request('{"enabled":true}'))).status).toBe(403);
    expect(state.database).not.toHaveBeenCalled();
  });
  it('rejects CSRF and mixed or unknown admin changes before database mutation', async () => {
    expect((await PUT(request('{"enabled":true}', 'https://elsewhere.test'))).status).toBe(403);
    expect((await PUT(request('{"enabled":true,"rotate":true}'))).status).toBe(400);
    expect(state.database).not.toHaveBeenCalled();
  });
  it('never returns provider errors or cacheable guest responses', async () => {
    const response = guestError(new Error('postgres credential secret'));
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('secret');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('recovers only the exact committed receipt after session expiry without authorizing another write', async () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const body = { requestId: id, plantId: id, name: 'Pat Smith', date: '2026-11-16', jobNumber: '12345', jobSourceType: 'live_quote', jobSourceId: id, hours: 100, hoursConfirmed: true, signature: `data:image/png;base64,${'A'.repeat(100)}`, comments: '', informWorkshop: false, items: Array.from({ length: 23 }, (_, i) => ({ number: i + 1, status: 'ok', comment: '', repeatConfirmed: false })), photoIds: [] };
    const query = vi.fn().mockResolvedValue({ rows: [{ inspection_id: id, payload_hash: guestHash(JSON.stringify(body)) }] });
    state.database.mockImplementation(fn => fn({ query }));
    const req = request(); req.cookies.set('avs_guest_plant', 'a'.repeat(64));
    expect(await submitGuestPlant(req, body)).toEqual({ id, date: body.date });
    expect(query).toHaveBeenCalledTimes(1);
    await expect(submitGuestPlant(req, { ...body, name: 'Changed name' })).rejects.toMatchObject({ status: 409 });
  });
  it('allows only explicit guest plant report exceptions without exposing other system-account rows', () => {
    const guest = { user_id: 'system', guest_name: 'Pat Smith', guest_submission_id: 'receipt', source: 'plant', status: 'submitted', inspection_date: '2026-11-16' };
    const hidden = new Set(['system']); const rows = [guest, { user_id: 'system' }, { user_id: 'employee' }];
    expect(filterHiddenReportSubjects(rows, hidden)).toEqual([rows[2]]);
    expect(filterGuestPlantReportSubjects(rows, hidden, false)).toEqual([rows[2]]);
    expect(filterGuestPlantReportSubjects(rows, hidden, true)).toEqual([guest, rows[2]]);
    const args = { dateFrom: '2026-11-16', dateTo: '2026-11-16', ownerScope: new Set<string>(), hiddenProfileIds: hidden, includeGuestPlant: true };
    expect(heavyRowStillAuthorised(guest, args)).toBe(true);
    for (const patch of [{ source: 'hgv' }, { status: 'draft' }, { inspection_date: '2026-11-15' }, { guest_submission_id: null }]) expect(heavyRowStillAuthorised({ ...guest, ...patch }, args)).toBe(false);
    expect(heavyRowStillAuthorised(guest, { ...args, includeGuestPlant: false })).toBe(false);
    expect(guestInspectorName(guest)).toBe('Pat Smith — Temporary staff');
    expect(guestPlantRoleCanRead({ role_name: 'employee' })).toBe(false);
    expect(guestPlantRoleCanRead({ role_name: 'supervisor' })).toBe(true);
    expect(guestPlantRoleCanRead({ is_manager_admin: true })).toBe(true);
  });
  it('matches exact numeric job codes and uses UK dates over BST midnight', () => {
    expect(numericJobCode('12345 - Example')).toBe('12345'); expect(numericJobCode('12345A')).toBeNull();
    expect(londonToday(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02');
  });
});
