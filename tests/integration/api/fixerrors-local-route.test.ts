import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash, generateKeyPairSync, randomUUID, verify } from 'node:crypto';

vi.mock('@/lib/server/app-auth/session', () => ({ getCurrentAuthenticatedProfile: vi.fn() }));
vi.mock('@/lib/utils/view-as', () => ({ getEffectiveRole: vi.fn(), getEffectiveRoleForUser: vi.fn() }));
vi.mock('@/lib/server/app-auth/profile', () => ({ getAppAuthProfile: vi.fn() }));
vi.mock('@/lib/server/fixerrors/store', () => ({
  localFixerrorsStore: { transact: vi.fn() }, productionFixerrorsStore: { transact: vi.fn() },
}));
const capture = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/server/fixerrors/evidence', () => ({ captureFreshFixerrorsEvidence: capture.read }));
vi.mock('@/lib/server/fixerrors/batch-lifecycle', () => ({ reconcileBatchLifecycle: vi.fn() }));

import { GET, POST } from '@/app/api/debug/fixerrors/route';
import { POST as devicePost } from '@/app/api/fixerrors-device/route';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { getEffectiveRole, getEffectiveRoleForUser } from '@/lib/utils/view-as';
import { getAppAuthProfile } from '@/lib/server/app-auth/profile';
import { localFixerrorsStore, productionFixerrorsStore } from '@/lib/server/fixerrors/store';
import { reconcileBatchLifecycle } from '@/lib/server/fixerrors/batch-lifecycle';
import { batchOutcomeHash } from '@/lib/fixerrors/batch';
import { FIXERRORS_LOCAL_ORIGIN, FIXERRORS_PREAPPROVAL_MS, FIXERRORS_PRODUCTION_ORIGIN } from '@/lib/fixerrors/protocol';
import { fixerrorsDeviceSigningBytes } from '@/lib/fixerrors/admission';
import { getFixerrorsLocalDatabaseUrl, getFixerrorsProductionDatabaseUrl, isFixerrorsLocalEnabled } from '@/lib/server/fixerrors/config';
import { readBoundedJson } from '@/lib/server/fixerrors/http';
import { isPublicRequestPath } from '@/lib/routes/public-routes';
import { actorId, credential, deviceId, FixtureStore, harness, now, workspace } from '../../unit/fixerrors-control-fixtures';
import { capturedBatch } from '../../unit/fixerrors-batch-fixtures';
import { preapprovedFixture } from '../../unit/fixerrors-preapproval-fixtures';

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
  vi.mocked(getEffectiveRoleForUser).mockResolvedValue(baseRole);
  vi.mocked(getAppAuthProfile).mockResolvedValue({
    id: actorId, full_name: 'Synthetic fixture', deleted_at: null, email: null,
    phone_number: null, employee_id: null, avatar_url: null, must_change_password: false,
  });
  const store = new FixtureStore();
  vi.mocked(localFixerrorsStore.transact).mockImplementation(store.transact.bind(store));
  vi.mocked(productionFixerrorsStore.transact).mockImplementation(store.transact.bind(store));
  capture.read.mockImplementation(async (id: string) => capturedBatch(id));
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
    store.state.devices[0].workspace = null;
    store.state.devices[0].checkout = { head: workspace.head, tree: workspace.tree, clean: true };
    vi.mocked(productionFixerrorsStore.transact).mockImplementation(store.transact.bind(store));
    const jobId = randomUUID();
    const queued = await POST(new NextRequest(`${FIXERRORS_PRODUCTION_ORIGIN}/api/debug/fixerrors`, {
      method: 'POST', body: JSON.stringify({ op: 'enqueue', action: 'repair', deviceId, requestId: jobId }),
      headers: { 'Content-Type': 'application/json', Origin: FIXERRORS_PRODUCTION_ORIGIN },
    }));
    expect(queued.status).toBe(200);
    expect(capture.read).toHaveBeenCalledOnce();
    expect(capture.read).toHaveBeenCalledWith(jobId, store.state.devices[0].checkout);
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
      jobId, deviceId, authority: 'bounded-repair', head: workspace.head, tree: workspace.tree,
      packetSha256: store.state.jobs[0].privateBatch!.delivery.manifestSha256,
    });
    expect(result.claim.job).not.toHaveProperty('packet');
    expect(result.claim).not.toHaveProperty('packet');
    expect(result.claim.job).not.toHaveProperty('privateBatch');
    expect(result.claim.batch).toEqual(store.state.jobs[0].privateBatch!.delivery);
    const chunkRequest = new NextRequest(`${FIXERRORS_PRODUCTION_ORIGIN}/api/fixerrors-device`, {
      method: 'POST', body: JSON.stringify({ op: 'batch-chunk', jobId, leaseToken: result.claim.leaseToken, index: 0 }),
      headers: req.headers,
    });
    const chunkResponse = await devicePost(chunkRequest);
    expect(chunkResponse.status).toBe(200);
    const { chunk } = await chunkResponse.json();
    const bytes = Buffer.from(chunk.data, 'base64url');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(chunk.sha256);
    expect(JSON.parse(bytes.toString()).retrieval.snapshotId).toBe(jobId);
    const browserState = await GET(new NextRequest(`${FIXERRORS_PRODUCTION_ORIGIN}/api/debug/fixerrors`));
    const browserText = await browserState.text();
    expect(browserText).not.toContain('admissionTicket');
    expect(browserText).not.toContain('normalizedMessage');
    expect(JSON.stringify(store.state)).not.toContain('admissionTicket');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const outcome = {
      runId: `fixerrors-${jobId}`, candidate: { baseHead: workspace.head, treeFingerprint: 'b'.repeat(64) },
      clusters: [{ id: 'cluster-1', status: 'held', reason: 'Synthetic source investigation',
        attempt: 'Inspected named source', tests: [], evidence: ['Source inspected'] }], decisions: [],
    };
    const send = (command: unknown, headers = req.headers) => devicePost(new NextRequest(
      `${FIXERRORS_PRODUCTION_ORIGIN}/api/fixerrors-device`, {
        method: 'POST', body: JSON.stringify(command), headers,
      }));
    const lease = { jobId, leaseToken: result.claim.leaseToken };
    expect((await send({ op: 'batch-lease', ...lease, cursor: 1,
      checkpointSha256: '1'.repeat(64), resume: false, outcome })).status).toBe(200);
    vi.mocked(reconcileBatchLifecycle).mockImplementationOnce(async (queue, id) => {
      expect(queue).toBe(productionFixerrorsStore);
      expect(id).toBe(jobId);
      expect(store.state.jobs[0]).toMatchObject({ state: 'no-change', privateBatch: { outcome } });
      return 'blocked';
    });
    const completed = await send({ op: 'complete', ...lease, result: { status: 'no-change' },
      outcomeSha256: batchOutcomeHash(outcome) });
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({ ok: true, lifecycle: 'blocked' });
    expect(reconcileBatchLifecycle).toHaveBeenCalledOnce();
    vi.mocked(reconcileBatchLifecycle).mockResolvedValueOnce('applied');
    const reconciled = await send({ op: 'batch-reconcile', jobId });
    expect(await reconciled.json()).toMatchObject({
      lifecycle: 'applied', completion: { job: { id: jobId, state: 'no-change' },
        outcomeSha256: batchOutcomeHash(outcome) },
    });
    const unauthorized = new Headers(req.headers);
    unauthorized.delete('authorization');
    expect((await send({ op: 'batch-reconcile', jobId }, unauthorized)).status).toBe(401);
    expect(reconcileBatchLifecycle).toHaveBeenCalledTimes(2);
  });

  it('captures no data for denied, busy, duplicate, revoked or opted-out requests', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const body = { op: 'enqueue', action: 'review', deviceId, requestId: randomUUID() };
    vi.mocked(getEffectiveRole).mockResolvedValue({ ...baseRole, is_viewing_as: true });
    expect((await POST(request(body))).status).toBe(403);
    vi.mocked(getEffectiveRole).mockResolvedValue(baseRole);
    expect((await POST(request(body, 'https://other.invalid'))).status).toBe(403);
    const store = new FixtureStore();
    vi.mocked(localFixerrorsStore.transact).mockImplementation(store.transact.bind(store));
    store.state.devices[0].allowReadOnly = false;
    expect((await POST(request(body))).status).toBe(409);
    store.state.devices[0].allowReadOnly = true;
    store.state.devices[0].revoked = true;
    expect((await POST(request(body))).status).toBe(403);
    store.state.devices[0].revoked = false;
    expect(capture.read).not.toHaveBeenCalled();
    expect((await POST(request(body))).status).toBe(200);
    expect((await POST(request(body))).status).toBe(409);
    expect((await POST(request({ ...body, requestId: randomUUID() }))).status).toBe(409);
    expect(capture.read).toHaveBeenCalledOnce();
  });

  it.each(['active', 'role-lost', 'deleted', 'view-as', 'wrong-actor', 'read-error'] as const)(
    'rereads the original grant actor on device-only heartbeat with %s authority', async authority => {
      vi.useFakeTimers();
      const f = await preapprovedFixture('targeted', 2);
      await f.complete(); f.lifecycle();
      vi.setSystemTime(now + 1);
      const store = f.store;
      vi.mocked(localFixerrorsStore.transact).mockImplementation(store.transact.bind(store));
      if (authority === 'role-lost') vi.mocked(getEffectiveRoleForUser).mockResolvedValue({ ...baseRole, is_actual_super_admin: false });
      if (authority === 'deleted') vi.mocked(getAppAuthProfile).mockResolvedValue({
        ...(await getAppAuthProfile(actorId, null)), deleted_at: '2027-01-01T00:00:00Z',
      });
      if (authority === 'view-as') vi.mocked(getEffectiveRoleForUser).mockResolvedValue({ ...baseRole, is_viewing_as: true });
      if (authority === 'wrong-actor') vi.mocked(getEffectiveRoleForUser).mockResolvedValue({ ...baseRole, user_id: randomUUID() });
      if (authority === 'read-error') vi.mocked(getAppAuthProfile).mockRejectedValue(new Error('Synthetic private lookup failure'));
      const heartbeat = request({ op: 'heartbeat', workspace: { ...workspace, head: f.candidate.head, tree: f.candidate.tree, packetSha256: store.state.jobs[0].workspace.packetSha256 }, checkout: { head: f.candidate.head, tree: f.candidate.tree, clean: true }, holdReason: 'prepared-candidate',
        allowReadOnly: true, allowRepair: true, allowDeploy: true, bridgeAvailable: true }, null, '/api/fixerrors-device');
      heartbeat.headers.set('X-Squires-Device-Id', deviceId);
      heartbeat.headers.set('Authorization', `Bearer ${credential}`);
      const response = await devicePost(heartbeat);
      expect(response.status).toBe(200);
      expect(getAppAuthProfile).toHaveBeenCalledWith(actorId, null);
      expect(store.state.jobs[0].autoDeployPreapproval?.state).toBe(
        authority === 'active' ? 'consumed' : authority === 'read-error' ? 'pending' : 'revoked',
      );
      expect(store.state.jobs).toHaveLength(authority === 'active' ? 2 : 1);
      expect(await response.text()).not.toContain('Synthetic private lookup');
    },
  );

  it('does not block queued-run heartbeats on deployment authority lookups', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const store = new FixtureStore();
    vi.mocked(localFixerrorsStore.transact).mockImplementation(store.transact.bind(store));
    expect((await POST(request({ op: 'enqueue', action: 'repair', deviceId, requestId: randomUUID(),
      requestedReleaseMode: 'targeted', autoDeployConfirmation: true }))).status).toBe(200);
    vi.mocked(getAppAuthProfile).mockRejectedValue(new Error('Unneeded authority lookup'));
    const heartbeat = request({ op: 'heartbeat', workspace, checkout: { head: workspace.head, tree: workspace.tree, clean: true },
      allowReadOnly: true, allowRepair: true, allowDeploy: true, bridgeAvailable: true }, null, '/api/fixerrors-device');
    heartbeat.headers.set('X-Squires-Device-Id', deviceId);
    heartbeat.headers.set('Authorization', `Bearer ${credential}`);
    expect((await devicePost(heartbeat)).status).toBe(200);
    expect(getAppAuthProfile).not.toHaveBeenCalled();
    expect(getEffectiveRoleForUser).not.toHaveBeenCalled();
    expect(store.state.jobs).toHaveLength(1);
    expect(store.state.jobs[0].autoDeployPreapproval?.state).toBe('pending');
  });

  it('automatically approves exactly once from the authenticated prepared heartbeat without an open browser', async () => {
    vi.useFakeTimers();
    const f = await preapprovedFixture('full', 2);
    await f.complete(); f.lifecycle();
    vi.setSystemTime(now + 1);
    vi.mocked(localFixerrorsStore.transact).mockImplementation(f.store.transact.bind(f.store));
    const heartbeat = () => {
      const req = request({ op: 'heartbeat', workspace: { ...workspace, head: f.candidate.head, tree: f.candidate.tree,
        packetSha256: f.store.state.jobs[0].workspace.packetSha256 },
      checkout: { head: f.candidate.head, tree: f.candidate.tree, clean: true }, holdReason: 'prepared-candidate',
      allowReadOnly: true, allowRepair: true, allowDeploy: true, bridgeAvailable: true }, null, '/api/fixerrors-device');
      req.headers.set('X-Squires-Device-Id', deviceId);
      req.headers.set('Authorization', `Bearer ${credential}`);
      return devicePost(req);
    };
    expect((await heartbeat()).status).toBe(200);
    expect((await heartbeat()).status).toBe(200);
    expect(f.store.state.jobs).toHaveLength(2);
    expect(f.store.state.jobs[1]).toMatchObject({ action: 'deploy', parentRepairId: f.id,
      approval: { actorId, candidate: f.candidate, releaseMode: 'full' } });
    expect(f.store.state.jobs[0].autoDeployPreapproval?.state).toBe('consumed');
    expect(getEffectiveRoleForUser).toHaveBeenCalledWith(actorId);
    expect(getCurrentAuthenticatedProfile).not.toHaveBeenCalled();
    expect(f.store.events.filter(event => event.event === 'auto-exact-candidate-deploy-approved')).toHaveLength(1);
  });

  it('persists expiry on reload without an authorizer read, and immediately withdraws empty-run authority', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const store = new FixtureStore();
    vi.mocked(localFixerrorsStore.transact).mockImplementation(store.transact.bind(store));
    const command = { op: 'enqueue', action: 'repair', deviceId, requestId: randomUUID(),
      requestedReleaseMode: 'targeted', autoDeployConfirmation: true };
    expect((await POST(request(command))).status).toBe(200);
    vi.setSystemTime(now + FIXERRORS_PREAPPROVAL_MS);
    const refreshed = await GET(new NextRequest(`${FIXERRORS_LOCAL_ORIGIN}/api/debug/fixerrors`));
    expect(await refreshed.json()).toMatchObject({ jobs: [{ autoDeployment: { state: 'expired' } }] });
    expect(store.events.filter(event => event.event === 'deploy-preapproval-expired')).toHaveLength(1);
    expect(getAppAuthProfile).not.toHaveBeenCalled();
    vi.setSystemTime(now);
    store.state.jobs = [];
    capture.read.mockImplementation(async (id: string) => capturedBatch(id, 0));
    expect(await (await POST(request({ ...command, requestId: randomUUID() }))).json()).toMatchObject({ ok: true, noWork: true });
    expect(store.state.jobs[0].autoDeployPreapproval?.state).toBe('revoked');
  });

  it('returns no-work for an empty read, but never hides capture failures as success', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    capture.read.mockImplementation(async (id: string) => capturedBatch(id, 0));
    const requestId = randomUUID();
    expect(await (await POST(request({ op: 'enqueue', action: 'review', deviceId, requestId }))).json())
      .toMatchObject({ ok: true, jobId: requestId, noWork: true });
    const before = await (await GET(new NextRequest(`${FIXERRORS_LOCAL_ORIGIN}/api/debug/fixerrors`))).json();
    expect(before.jobs).toHaveLength(1);
    expect(before.jobs[0].state).toBe('no-work');
    capture.read.mockRejectedValue(new Error('synthetic-private-database-error'));
    const failed = await POST(request({ op: 'enqueue', action: 'review', deviceId, requestId: randomUUID() }));
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('synthetic-private');
    const after = await (await GET(new NextRequest(`${FIXERRORS_LOCAL_ORIGIN}/api/debug/fixerrors`))).json();
    expect(after.jobs).toHaveLength(1);
  });

  it('rejects a candidate or device race between capture and enqueue without creating a job', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    for (const change of ['candidate', 'revocation'] as const) {
      const store = new FixtureStore();
      vi.mocked(localFixerrorsStore.transact).mockImplementation(store.transact.bind(store));
      capture.read.mockImplementationOnce(async () => {
        if (change === 'candidate') store.state.devices[0].workspace = { ...workspace, tree: 'f'.repeat(40) };
        else store.state.devices[0].revoked = true;
        return capturedBatch(randomUUID(), 0);
      });
      expect((await POST(request({ op: 'enqueue', action: 'review', deviceId, requestId: randomUUID() }))).status)
        .toBe(change === 'candidate' ? 409 : 403);
      expect(store.state.jobs).toEqual([]);
    }
  });

  it.each(['Invalid exact snapshot', 'Duplicate private binding', 'Batch coverage mismatch'])('fails closed on rejected capture: %s', async message => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const store = new FixtureStore();
    vi.mocked(localFixerrorsStore.transact).mockImplementation(store.transact.bind(store));
    capture.read.mockRejectedValue(new Error(message));
    const response = await POST(request({ op: 'enqueue', action: 'review', deviceId, requestId: randomUUID() }));
    expect(response.status).toBe(503);
    expect(store.state.jobs).toEqual([]);
  });

  it('rejects legacy single-packet review reuse without capturing or creating another job', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const store = new FixtureStore();
    const h = harness(store);
    vi.mocked(localFixerrorsStore.transact).mockImplementation(store.transact.bind(store));
    const reviewJobId = randomUUID();
    await h.enqueue('review', reviewJobId);
    const review = await h.claim();
    await h.device({ op: 'complete', jobId: reviewJobId, leaseToken: review.leaseToken, result: { status: 'reviewed' } });
    store.state.jobs[0].packet = 'Synthetic legacy private packet';
    const result = await POST(request({ op: 'enqueue', action: 'repair', deviceId, requestId: randomUUID(), reviewJobId }));
    expect(capture.read).not.toHaveBeenCalled();
    expect(result.status).toBe(409);
    expect(store.state.jobs).toHaveLength(1);
  });

  it('never exposes capture success when the final queue commit fails', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const store = new FixtureStore();
    vi.mocked(localFixerrorsStore.transact).mockImplementationOnce(store.transact.bind(store))
      .mockRejectedValueOnce(new Error('Synthetic final commit failure'));
    const result = await POST(request({ op: 'enqueue', action: 'review', deviceId, requestId: randomUUID() }));
    expect(capture.read).toHaveBeenCalledOnce();
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('normalizedMessage');
    expect(store.state.jobs).toEqual([]);
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
