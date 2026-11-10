import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { generateKeyPairSync, verify } from 'node:crypto';

vi.mock('@/lib/server/app-auth/session', () => ({ getCurrentAuthenticatedProfile: vi.fn() }));
vi.mock('@/lib/utils/view-as', () => ({ getEffectiveRole: vi.fn() }));
vi.mock('@/lib/server/fixerrors/store', () => ({
  localFixerrorsStore: { transact: vi.fn() }, productionFixerrorsStore: { transact: vi.fn() },
}));

import { GET, POST } from '@/app/api/debug/fixerrors/route';
import { POST as devicePost } from '@/app/api/fixerrors-device/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { localFixerrorsStore, productionFixerrorsStore } from '@/lib/server/fixerrors/store';
import { FIXERRORS_LOCAL_ORIGIN, FIXERRORS_PRODUCTION_ORIGIN } from '@/lib/fixerrors/protocol';
import { fixerrorsDeviceSigningBytes } from '@/lib/fixerrors/admission';
import { getFixerrorsLocalDatabaseUrl, getFixerrorsProductionDatabaseUrl, isFixerrorsLocalEnabled } from '@/lib/server/fixerrors/config';
import { readBoundedJson } from '@/lib/server/fixerrors/http';
import { isPublicRequestPath } from '@/lib/routes/public-routes';
import { actorId, credential, deviceId, FixtureStore, harness, now } from '../../unit/fixerrors-control-fixtures';

const baseRole = {
  role_id: 'role', role_name: 'super_admin', display_name: 'Super Admin', role_class: 'admin' as const,
  is_manager_admin: true, is_super_admin: true, is_actual_super_admin: true,
  is_viewing_as: false, user_id: actorId, team_id: null, team_name: null,
};
function request(body: unknown, origin: string | null = FIXERRORS_LOCAL_ORIGIN, path = '/api/debug/fixerrors') {
  return new NextRequest(`${FIXERRORS_LOCAL_ORIGIN}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SQUIRES_FIXERRORS_LOCAL_ENABLED', '1');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('SQUIRES_FIXERRORS_PRODUCTION_ENABLED', '');
  vi.stubEnv('NODE_ENV', 'test');
  vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({ profile: { id: actorId } } as never);
  vi.mocked(getEffectiveRole).mockResolvedValue(baseRole);
  const store = new FixtureStore();
  vi.mocked(localFixerrorsStore.transact).mockImplementation(store.transact.bind(store));
  vi.mocked(productionFixerrorsStore.transact).mockImplementation(store.transact.bind(store));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('local-only Debug and outbound device routes', () => {
  it('denies unauthenticated, non-SuperAdmin and View As callers server-side', async () => {
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue(null);
    expect((await GET(new NextRequest(`${FIXERRORS_LOCAL_ORIGIN}/api/debug/fixerrors`))).status).toBe(401);
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({ profile: { id: actorId } } as never);
    vi.mocked(getEffectiveRole).mockResolvedValue({ ...baseRole, is_actual_super_admin: false });
    expect((await POST(request({ op: 'revoke-device', deviceId }))).status).toBe(403);
    vi.mocked(getEffectiveRole).mockResolvedValue({ ...baseRole, is_viewing_as: true });
    expect((await POST(request({ op: 'revoke-device', deviceId }))).status).toBe(403);
    expect(localFixerrorsStore.transact).not.toHaveBeenCalled();
  });

  it('allows an actual SuperAdmin and returns no secret or lease authenticator', async () => {
    const response = await GET(new NextRequest(`${FIXERRORS_LOCAL_ORIGIN}/api/debug/fixerrors`));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"enabled":true');
    expect(text).toContain('"executionAvailable":false');
    expect(text).not.toContain('credentialSha256');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await POST(request({ op: 'revoke-device', deviceId }))).status).toBe(200);
  });

  it('is disabled by default and hard-disabled in production even with opt-in', async () => {
    vi.stubEnv('SQUIRES_FIXERRORS_LOCAL_ENABLED', '');
    const disabled = await GET(new NextRequest(`${FIXERRORS_LOCAL_ORIGIN}/api/debug/fixerrors`));
    expect(await disabled.json()).toMatchObject({ enabled: false, devices: [], jobs: [] });
    expect((await POST(request({ op: 'revoke-device', deviceId }))).status).toBe(503);
    vi.stubEnv('SQUIRES_FIXERRORS_LOCAL_ENABLED', '1');
    vi.stubEnv('NODE_ENV', 'production');
    expect(isFixerrorsLocalEnabled()).toBe(false);
    expect((await devicePost(request({ op: 'claim' }, null, '/api/fixerrors-device'))).status).toBe(503);
    expect(localFixerrorsStore.transact).not.toHaveBeenCalled();
  });

  it('rejects cross-origin writes and non-loopback hosts', async () => {
    expect((await POST(request({ op: 'revoke-device', deviceId }, 'https://other.invalid'))).status).toBe(403);
    expect((await POST(request({ op: 'revoke-device', deviceId }, null))).status).toBe(403);
    const remote = new NextRequest('https://squires.invalid/api/debug/fixerrors');
    expect((await GET(remote)).status).toBe(403);
  });

  it('selects the production store only on the opted-in canonical production origin', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('SQUIRES_FIXERRORS_PRODUCTION_ENABLED', '1');
    const production = new NextRequest(FIXERRORS_PRODUCTION_ORIGIN + '/api/debug/fixerrors');
    expect(await (await GET(production)).json()).toMatchObject({ enabled: false });
    expect(productionFixerrorsStore.transact).not.toHaveBeenCalled();

    vi.stubEnv('VERCEL_ENV', 'production');
    expect((await GET(new NextRequest('https://preview.invalid/api/debug/fixerrors'))).status).toBe(403);
    expect((await POST(request({ op: 'revoke-device', deviceId }))).status).toBe(403);
    expect(await (await GET(production)).json()).toMatchObject({ enabled: true, origin: FIXERRORS_PRODUCTION_ORIGIN });
    expect(productionFixerrorsStore.transact).toHaveBeenCalledTimes(1);
    expect(localFixerrorsStore.transact).not.toHaveBeenCalled();
  });

  it('returns canonical admission only to the authenticated production device after the claim commits', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SQUIRES_FIXERRORS_PRODUCTION_ENABLED', '1');
    vi.stubEnv('SQUIRES_FIXERRORS_PRODUCTION_DEVICE_ID', deviceId);
    const repair = generateKeyPairSync('ed25519');
    const release = generateKeyPairSync('ed25519');
    vi.stubEnv('SQUIRES_FIXERRORS_REPAIR_PRIVATE_KEY',
      Buffer.from(repair.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64url'));
    vi.stubEnv('SQUIRES_FIXERRORS_RELEASE_PUBLIC_KEY',
      Buffer.from(release.publicKey.export({ type: 'spki', format: 'pem' })).toString('base64url'));
    const store = new FixtureStore();
    const jobId = await harness(store).enqueue('repair');
    vi.mocked(productionFixerrorsStore.transact).mockImplementation(store.transact.bind(store));
    const req = new NextRequest(`${FIXERRORS_PRODUCTION_ORIGIN}/api/fixerrors-device`, {
      method: 'POST', body: JSON.stringify({ op: 'claim' }),
      headers: { 'Content-Type': 'application/json', 'X-Squires-Device-Id': deviceId, Authorization: `Bearer ${credential}` },
    });
    const response = await devicePost(req);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(store.state.jobs[0]).toMatchObject({ id: jobId, state: 'leased' });
    const envelope = JSON.parse(result.claim.admissionTicket);
    expect(verify(null, fixerrorsDeviceSigningBytes(envelope.keyId, envelope.payload),
      repair.publicKey, Buffer.from(envelope.signature, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(envelope.payload, 'base64url').toString())).toMatchObject({
      jobId, deviceId, authority: 'bounded-repair',
    });
    const browserState = await GET(new NextRequest(`${FIXERRORS_PRODUCTION_ORIGIN}/api/debug/fixerrors`));
    expect(await browserState.text()).not.toContain('admissionTicket');
    expect(JSON.stringify(store.state)).not.toContain('admissionTicket');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('requires the scoped production queue login and exact database target', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SQUIRES_FIXERRORS_PRODUCTION_ENABLED', '1');
    const key = 'SQUIRES_FIXERRORS_PRODUCTION_DATABASE_URL';
    const host = 'db.lrhufzqfzeutgvudcowy.supabase.co';
    vi.stubEnv(key, `postgresql://postgres:fixture@${host}/postgres`);
    expect(() => getFixerrorsProductionDatabaseUrl()).toThrow('scoped Squires queue login');
    vi.stubEnv(key, 'postgresql://squires_fixerrors_queue:fixture@db.other.supabase.co/postgres');
    expect(() => getFixerrorsProductionDatabaseUrl()).toThrow('scoped Squires queue login');
    vi.stubEnv(key, `postgresql://squires_fixerrors_queue:fixture@${host}/postgres`);
    expect(getFixerrorsProductionDatabaseUrl().hostname).toBe(host);
  });

  it('rejects extra fields, malformed JSON and oversized bodies before persistence', async () => {
    expect((await POST(request({ op: 'revoke-device', deviceId, command: 'fap' }))).status).toBe(400);
    const invalid = new NextRequest(`${FIXERRORS_LOCAL_ORIGIN}/api/debug/fixerrors`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: FIXERRORS_LOCAL_ORIGIN }, body: '{',
    });
    expect((await POST(invalid)).status).toBe(400);
    expect((await POST(request({ text: 'x'.repeat(20_000) }))).status).toBe(413);
    expect(localFixerrorsStore.transact).not.toHaveBeenCalled();
  });

  it('enforces the streamed body deadline even if cancellation never settles', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const req = new NextRequest(`${FIXERRORS_LOCAL_ORIGIN}/api/debug/fixerrors`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: new ReadableStream({ cancel }),
    });
    const rejected = expect(readBoundedJson(req)).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized chunk without waiting for stream cancellation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const req = new NextRequest(`${FIXERRORS_LOCAL_ORIGIN}/api/debug/fixerrors`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(16_385)); },
        cancel,
      }),
    });
    await expect(readBoundedJson(req)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('requires separate device authentication, never a browser cookie or origin', async () => {
    expect(isPublicRequestPath('/api/fixerrors-device')).toBe(true);
    expect(isPublicRequestPath('/api/fixerrors-device/other')).toBe(false);
    expect(isPublicRequestPath('/api/fixerrors-device-escape')).toBe(false);
    const req = request({ op: 'claim' }, null, '/api/fixerrors-device');
    req.headers.set('X-Squires-Device-Id', deviceId);
    expect((await devicePost(req)).status).toBe(401);
    const browser = request({ op: 'claim' }, FIXERRORS_LOCAL_ORIGIN, '/api/fixerrors-device');
    browser.headers.set('X-Squires-Device-Id', deviceId);
    browser.headers.set('Authorization', `Bearer ${credential}`);
    expect((await devicePost(browser)).status).toBe(403);
  });

  it('accepts an outbound heartbeat with provisioned credentials but rejects revoked/wrong secrets', async () => {
    const req = request({
      op: 'heartbeat', workspace: null, allowReadOnly: false, allowRepair: false, allowDeploy: false, bridgeAvailable: false,
    }, null, '/api/fixerrors-device');
    req.headers.set('X-Squires-Device-Id', deviceId);
    req.headers.set('Authorization', `Bearer ${credential}`);
    expect((await devicePost(req)).status).toBe(200);
    const bad = request({ op: 'claim' }, null, '/api/fixerrors-device');
    bad.headers.set('X-Squires-Device-Id', deviceId);
    bad.headers.set('Authorization', `Bearer ${'y'.repeat(43)}`);
    expect((await devicePost(bad)).status).toBe(401);
  });

  it.each([
    'postgresql://user:password@remote.invalid:5432/squires_fixerrors_local',
    'postgresql://user:password@localhost:5432/postgres',
    'postgresql://user:password@localhost:5432/squires_fixerrors_local?host=remote.invalid',
  ])('rejects remote or redirected database configuration', (url) => {
    expect(() => getFixerrorsLocalDatabaseUrl({
      NODE_ENV: 'test', SQUIRES_FIXERRORS_LOCAL_ENABLED: '1', SQUIRES_FIXERRORS_LOCAL_DATABASE_URL: url,
    })).toThrow('dedicated loopback');
  });
});
