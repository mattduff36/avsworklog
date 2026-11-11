import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueClaimedFixerrorsAdmission } from '@/lib/fixerrors/admission';
import { applyAdminCommand, applyDeviceCommand, checkEvidenceDigest } from '@/lib/fixerrors/control';
import { encodePreparedReleaseEvidence, type PreparedReleaseEvidence } from '@/lib/fixerrors/release';
import { publicQueueState, type ClaimedJob, type Checkout } from '@/lib/fixerrors/protocol';
import { projectFreshEvidence } from '@/lib/server/fixerrors/evidence';
import { parseCompanionPacket } from '@/scripts/automation/fixerrors-companion-packet';
import { prepareClaimPacket, reconcilePacketLifecycle, recordPacketCompletion } from '@/scripts/automation/fixerrors-companion-lifecycle';
import { executeCompanionClaim, type TrustedFixerrorsExecutor } from '@/scripts/automation/fixerrors-companion';
import { type ProductionBridgeEnrollment } from '@/scripts/automation/fixerrors-production-bridge';
import { actorId, candidate, checks, credential, deviceId, FixtureStore, harness, now, workspace } from './fixerrors-control-fixtures';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => { throw new Error('No live data access in fixture'); }) }));
const issuer = generateKeyPairSync('ed25519');
const release = generateKeyPairSync('ed25519');
const deviceKey = generateKeyPairSync('ed25519');
const enrollment: ProductionBridgeEnrollment = {
  deviceId, credential, pythonExe: 'C:\\synthetic-fixture\\python.exe',
  devicePrivateKeyPem: deviceKey.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  repairPublicKeyPem: issuer.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  releasePublicKeyPem: release.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  bridgeHashes: ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64)],
};
const checkout: Checkout = { head: workspace.head, tree: workspace.tree, clean: true };
const row = {
  error_type: 'TypeError', error_message: "Cannot read properties of undefined (reading 'length')",
  error_stack: 'at synthetic (webpack-internal:///(app-pages-browser)/./lib/utils/example.ts:12:3)',
  triage_state: null,
};
const directories: string[] = [];
function disposable() {
  const directory = mkdtempSync(path.join(realpathSync(tmpdir()), 'squires-fresh-evidence-'));
  directories.push(directory);
  return directory;
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => {
  vi.useRealTimers();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

async function connected() {
  const store = new FixtureStore();
  const h = harness(store);
  await h.device({ op: 'heartbeat', workspace: null, checkout, holdReason: null,
    allowReadOnly: true, allowRepair: true, allowDeploy: true, bridgeAvailable: true });
  const enqueue = async (action: 'review' | 'repair' = 'review', id = randomUUID()) => {
    const packet = projectFreshEvidence(row, id, checkout);
    await store.transact(tx => applyAdminCommand(tx, actorId,
      { op: 'enqueue', action, deviceId, requestId: id }, now, { checkout, packet }));
    return packet;
  };
  const claim = async (): Promise<ClaimedJob> => {
    const response = await store.transact(tx => applyDeviceCommand(tx, deviceId, credential, { op: 'claim' }, now,
      undefined, job => issueClaimedFixerrorsAdmission(job, now, {
        keyId: 'squires-repair-v1', privateKey: issuer.privateKey,
        releaseKeyId: 'squires-release-v1', releasePublicKey: release.publicKey,
      })));
    if (!('claim' in response) || !response.claim) throw new Error('Synthetic signed claim missing');
    return response.claim;
  };
  return { store, h, enqueue, claim };
}

describe('fresh evidence -> signed job -> exclusive packet -> fake worker (offline)', () => {
  it('holds a retained batch lock even without a journal or manifest and never removes evidence', () => {
    const directory = disposable();
    const lock = path.join(directory, 'batch-executor.lock');
    const bytes = JSON.stringify({ pid: 2147483647, jobId: randomUUID() });
    writeFileSync(lock, bytes);
    expect(reconcilePacketLifecycle(directory, checkout)).toBe('packet-needs-reconciliation');
    expect(reconcilePacketLifecycle(directory, null)).toBe('packet-needs-reconciliation');
    expect(readFileSync(lock, 'utf8')).toBe(bytes);
    expect(existsSync(path.join(directory, 'active-packet.json'))).toBe(false);
    expect(existsSync(path.join(directory, 'archive'))).toBe(false);
    writeFileSync(path.join(directory, 'prepared-release.json'), 'retained private fixture');
    expect(reconcilePacketLifecycle(directory, checkout)).toBe('packet-needs-reconciliation');
    expect(readFileSync(lock, 'utf8')).toBe(bytes);
  });

  it('connects without any packet and crosses the actual signature and completion boundaries twice', async () => {
    const directory = disposable();
    const { store, h, enqueue, claim } = await connected();
    expect(store.state.devices[0].workspace).toBeNull();
    expect(reconcilePacketLifecycle(directory, checkout)).toBeNull();
    for (let index = 0; index < 2; index++) {
      const packet = await enqueue();
      const leased = await claim();
      expect(leased.packet).toBe(packet);
      expect(leased.job).not.toHaveProperty('packet');
      expect(JSON.stringify(publicQueueState(store.state))).not.toContain('normalizedMessage');
      prepareClaimPacket(leased, enrollment, directory, () => checkout);
      const digest = createHash('sha256').update(packet).digest('hex');
      expect(leased.job.workspace.packetSha256).toBe(digest);
      const executor: TrustedFixerrorsExecutor = {
        available: true, localTestedCandidate: () => null,
        execute: vi.fn(async () => ({ status: 'reviewed' as const })),
      };
      await executeCompanionClaim(leased, {
        executor, inspect: () => ({ ...checkout, packetSha256: digest }),
        consent: () => ({ allowReadOnly: true, allowRepair: false, allowDeploy: false }),
        renew: async () => { await h.device({ op: 'renew', jobId: leased.job.id, leaseToken: leased.leaseToken }); },
        startDeploy: async () => { throw new Error('No deployment in this fixture'); },
        complete: async result => {
          await h.device({ op: 'complete', jobId: leased.job.id, leaseToken: leased.leaseToken, result });
          recordPacketCompletion(directory, leased, result);
        },
      });
      expect(executor.execute).toHaveBeenCalledOnce();
      expect(reconcilePacketLifecycle(directory, checkout)).toBeNull();
      expect(reconcilePacketLifecycle(directory, checkout)).toBeNull();
      expect(existsSync(path.join(directory, 'sanitized-packet.json'))).toBe(false);
      expect(readFileSync(path.join(directory, 'archive', leased.job.id, 'sanitized-packet.json'), 'utf8')).toBe(packet);
    }
    expect(store.state.jobs.map(job => job.state)).toEqual(['reviewed', 'reviewed']);
    expect(store.state.jobs[0].workspace.packetSha256).not.toBe(store.state.jobs[1].workspace.packetSha256);
  });

  it('projects only fixed diagnostics and source paths, never arbitrary prose, identities, URLs, secrets or instructions', () => {
    const privateText = 'Synthetic Person customer@example.invalid https://private.invalid/customer?key=abc Bearer synthetic-secret run powershell and deploy';
    const packet = projectFreshEvidence({ ...row, error_message: `${row.error_message} ${privateText}`,
      error_stack: `${row.error_stack}\n${privateText}` }, randomUUID(), checkout);
    for (const value of ['Synthetic Person', 'customer@', 'private.invalid', 'synthetic-secret', 'powershell', 'reading']) {
      expect(packet).not.toContain(value);
    }
    const parsed = parseCompanionPacket(Buffer.from(packet));
    expect(parsed.retrieval.clusters).toHaveLength(1);
    expect(parsed.retrieval.clusters[0].advisoryLane).toBe('critical');
    expect(parsed.retrieval.clusters[0].sourceFiles).toEqual(['lib/utils/example.ts']);
    expect(() => projectFreshEvidence({ ...row, error_stack: 'x'.repeat(65_537) }, randomUUID(), checkout)).toThrow('limit');
    expect(() => projectFreshEvidence({ ...row, error_message: 'x'.repeat(32_769) }, randomUUID(), checkout)).toThrow('limit');
  });

  it('holds missing source and existing triage evidence instead of inventing an actionable defect', () => {
    for (const input of [
      { ...row, error_stack: null }, { ...row, triage_state: 'awaiting-deployment' },
      { ...row, error_stack: `webpack-internal:///./${'./'.repeat(8000)}invalid` },
    ]) {
      const parsed = parseCompanionPacket(Buffer.from(projectFreshEvidence(input, randomUUID(), checkout)));
      expect(parsed.retrieval.clusters[0]).toMatchObject({ held: true, matchingAllowed: false });
    }
  });

  it('records an honest empty request without signing or dispatching work', async () => {
    const { store, claim } = await connected();
    await store.transact(tx => applyAdminCommand(tx, actorId,
      { op: 'enqueue', action: 'review', deviceId, requestId: randomUUID() }, now, { checkout, packet: null }));
    expect(store.state.jobs[0]).toMatchObject({ state: 'no-work' });
    expect(store.events.at(-1)?.event).toBe('review-no-work');
    await expect(claim()).rejects.toThrow('missing');
  });

  it('refuses replay, cross-device, expiry, signature tamper, packet tamper and HEAD/tree drift before creating a file', async () => {
    const { enqueue, claim } = await connected();
    await enqueue();
    const leased = await claim();
    const cases = [
      { ...leased, packet: `${leased.packet} ` },
      { ...leased, admissionTicket: `${leased.admissionTicket} ` },
      { ...leased, job: { ...leased.job, id: randomUUID() } },
      { ...leased, job: { ...leased.job, deviceId: randomUUID() } },
      { ...leased, job: { ...leased.job, action: 'repair' as const } },
    ];
    for (const invalid of cases) {
      const directory = disposable();
      expect(() => prepareClaimPacket(invalid, enrollment, directory, () => checkout)).toThrow();
      expect(existsSync(path.join(directory, 'active-packet.json'))).toBe(false);
    }
    const directory = disposable();
    expect(() => prepareClaimPacket(leased, enrollment, directory, () => ({ ...checkout, tree: 'e'.repeat(40) }))).toThrow();
    expect(() => prepareClaimPacket(leased, enrollment, directory, () => null)).toThrow();
    vi.setSystemTime(now + 300_000);
    expect(() => prepareClaimPacket(leased, enrollment, directory, () => checkout)).toThrow();
    vi.setSystemTime(now);
    prepareClaimPacket(leased, enrollment, directory, () => checkout);
    expect(() => prepareClaimPacket(leased, enrollment, directory, () => checkout)).toThrow('Existing packet');
    expect(reconcilePacketLifecycle(directory, checkout)).toBe('packet-needs-reconciliation');
  });

  it('reuses completed reviewed evidence only for the same device, fresh checkout and a new signed repair job', async () => {
    const { store, h, enqueue, claim } = await connected();
    const packet = await enqueue();
    const review = await claim();
    await h.device({ op: 'complete', jobId: review.job.id, leaseToken: review.leaseToken, result: { status: 'reviewed' } });
    const request = { op: 'enqueue' as const, action: 'repair' as const, requestId: randomUUID(), deviceId, reviewJobId: review.job.id };
    await store.transact(tx => applyAdminCommand(tx, actorId, request, now, { checkout, packet }));
    const repair = await claim();
    expect(repair.packet).toBe(packet);
    expect(repair.job.id).not.toBe(review.job.id);
    expect(repair.admissionTicket).not.toBe(review.admissionTicket);
    await expect(store.transact(tx => applyAdminCommand(tx, actorId, request, now))).rejects.toThrow('Duplicate');
    await expect(claim()).rejects.toThrow('already leased');
  });

  it.each(['old', 'future', 'candidate', 'foreign', 'legacy'] as const)('refuses ineligible review reuse: %s', async reason => {
    const { store, h, enqueue, claim } = await connected();
    const packet = await enqueue();
    const review = await claim();
    await h.device({ op: 'complete', jobId: review.job.id, leaseToken: review.leaseToken, result: { status: 'reviewed' } });
    let currentTime = now;
    let target = deviceId;
    if (reason === 'old') currentTime += 30 * 60_000 + 1;
    if (reason === 'future') store.state.jobs[0].createdAt++;
    if (reason === 'candidate') store.state.devices[0].checkout = { ...checkout, tree: 'f'.repeat(40) };
    if (reason === 'legacy') delete store.state.jobs[0].packet;
    if (reason === 'foreign') {
      target = randomUUID();
      store.state.devices.push({ ...store.state.devices[0], id: target });
    }
    for (const device of store.state.devices) device.lastSeenAt = currentTime;
    await expect(store.transact(tx => applyAdminCommand(tx, actorId, {
      op: 'enqueue', action: 'repair', requestId: randomUUID(), deviceId: target, reviewJobId: review.job.id,
    }, currentTime, { checkout, packet }))).rejects.toThrow('Reviewed evidence is unavailable');
    expect(store.state.jobs).toHaveLength(1);
  });

  it('rechecks capture candidate, busy state, freshness, opt-out and pending prepared candidates under the queue lock', async () => {
    const { store, h, enqueue } = await connected();
    const command = () => ({ op: 'enqueue' as const, action: 'repair' as const, deviceId, requestId: randomUUID() });
    await expect(store.transact(tx => applyAdminCommand(tx, actorId, command(), now,
      { checkout: { ...checkout, head: 'd'.repeat(40) }, packet: null }))).rejects.toThrow('changed');
    await expect(store.transact(tx => applyAdminCommand(tx, actorId, command(), now + 45_000,
      { checkout, packet: null }))).rejects.toThrow('offline');
    store.state.devices[0].allowRepair = false;
    await expect(store.transact(tx => applyAdminCommand(tx, actorId, command(), now,
      { checkout, packet: null }))).rejects.toThrow('opted');
    store.state.devices[0].allowRepair = true;
    store.state.devices[0].holdReason = 'packet-needs-reconciliation';
    await expect(enqueue()).rejects.toThrow('held');
    store.state.devices[0].holdReason = null;
    store.state.devices[0].workspace = workspace;
    const id = await h.testedRepair();
    expect(store.state.jobs.find(job => job.id === id)?.state).toBe('tested');
    await expect(enqueue()).rejects.toThrow('tested candidate');
  });

  it('recovers confirmed completion after restart but preserves inflight, dirty, tested and unknown evidence', async () => {
    const { enqueue, claim } = await connected();
    const packet = await enqueue('repair');
    const leased = await claim();
    for (const result of [
      { status: 'failed' as const, reason: 'execution-failed' as const },
      { status: 'tested' as const, candidate, checks },
    ]) {
      const directory = disposable();
      prepareClaimPacket(leased, enrollment, directory, () => checkout);
      expect(reconcilePacketLifecycle(directory, checkout)).toBe('packet-needs-reconciliation');
      recordPacketCompletion(directory, leased, result);
      if (result.status === 'tested') {
        writeFileSync(path.join(directory, 'prepared-release.json'), '{"syntheticFixture":true}');
        expect(reconcilePacketLifecycle(directory, { ...candidate, clean: true })).toBe('prepared-candidate');
      } else {
        expect(reconcilePacketLifecycle(directory, null)).toBe('packet-needs-reconciliation');
        expect(readFileSync(path.join(directory, 'sanitized-packet.json'), 'utf8')).toBe(packet);
        expect(reconcilePacketLifecycle(directory, checkout)).toBeNull();
      }
    }
    const legacy = disposable();
    writeFileSync(path.join(legacy, 'sanitized-packet.json'), packet);
    expect(reconcilePacketLifecycle(legacy, checkout)).toBe('packet-needs-reconciliation');
    expect(readFileSync(path.join(legacy, 'sanitized-packet.json'), 'utf8')).toBe(packet);
  });

  it('resumes interrupted archival only for matching bytes and refuses conflicts or hardlinks', async () => {
    const { enqueue, claim } = await connected();
    const packet = await enqueue();
    const leased = await claim();
    for (const mode of ['resume', 'conflict', 'hardlink'] as const) {
      const directory = disposable();
      prepareClaimPacket(leased, enrollment, directory, () => checkout);
      recordPacketCompletion(directory, leased, { status: 'reviewed' });
      const source = path.join(directory, 'sanitized-packet.json');
      if (mode === 'hardlink') {
        linkSync(source, path.join(directory, 'packet-hardlink.json'));
        expect(() => reconcilePacketLifecycle(directory, checkout)).toThrow('ordinary');
      } else {
        const archive = path.join(directory, 'archive', leased.job.id);
        mkdirSync(archive, { recursive: true });
        writeFileSync(path.join(archive, 'sanitized-packet.json'), mode === 'conflict' ? 'synthetic conflict' : packet);
        if (mode === 'conflict') expect(() => reconcilePacketLifecycle(directory, checkout)).toThrow('conflict');
        else {
          renameSync(path.join(directory, `${leased.job.id}.terminal.json`), path.join(archive, `${leased.job.id}.terminal.json`));
          expect(reconcilePacketLifecycle(directory, checkout)).toBeNull();
          expect(reconcilePacketLifecycle(directory, checkout)).toBeNull();
          continue;
        }
      }
      expect(readFileSync(source, 'utf8')).toBe(packet);
      expect(existsSync(path.join(directory, 'active-packet.json'))).toBe(true);
    }
  });

  it('retains a postwrite-drift packet and journal rather than silently clearing uncertain evidence', async () => {
    const { enqueue, claim } = await connected();
    await enqueue();
    const leased = await claim();
    const directory = disposable();
    const inspect = vi.fn().mockReturnValueOnce(checkout).mockReturnValueOnce(null);
    expect(() => prepareClaimPacket(leased, enrollment, directory, inspect)).toThrow('during packet preparation');
    expect(existsSync(path.join(directory, 'sanitized-packet.json'))).toBe(true);
    expect(reconcilePacketLifecycle(directory, checkout)).toBe('packet-needs-reconciliation');
  });

  it('refuses an archive with a linked ancestor without retiring any evidence', async () => {
    const { enqueue, claim } = await connected();
    await enqueue();
    const leased = await claim();
    const directory = disposable();
    prepareClaimPacket(leased, enrollment, directory, () => checkout);
    recordPacketCompletion(directory, leased, { status: 'reviewed' });
    symlinkSync(disposable(), path.join(directory, 'archive'), 'junction');
    expect(() => reconcilePacketLifecycle(directory, checkout)).toThrow('ordinary');
    expect(existsSync(path.join(directory, 'sanitized-packet.json'))).toBe(true);
  });

  it.each(['deployed', 'unknown', 'tampered'] as const)('retires prepared evidence only after confirmed exact-candidate Deploy: %s', async outcome => {
    const { store, h, enqueue, claim } = await connected();
    await enqueue('repair');
    const repair = await claim();
    const directory = disposable();
    prepareClaimPacket(repair, enrollment, directory, () => checkout);
    const evidence: PreparedReleaseEvidence = {
      repairJobId: repair.job.id, head: checks.head, tree: checks.tree,
      candidateSha256: '8'.repeat(64), allChecksPassed: true, workerResultSha256: '9'.repeat(64),
      preparedChecks: {
        'targeted-tests': { receiptId: '1'.repeat(32), sha256: checks.checks[0].outputSha256 },
        typecheck: { receiptId: '2'.repeat(32), sha256: checks.checks[1].outputSha256 },
        lint: { receiptId: '3'.repeat(32), sha256: checks.checks[2].outputSha256 },
      },
    };
    const testedChecks = { ...checks, release: {
      candidateSha256: evidence.candidateSha256,
      testEvidenceSha256: createHash('sha256').update(encodePreparedReleaseEvidence(evidence)).digest('hex'),
    } };
    const testedCandidate = { ...candidate, checksSha256: checkEvidenceDigest(testedChecks) };
    const prepared = path.join(directory, 'prepared-release.json');
    const preparedBytes = JSON.stringify({ candidate: testedCandidate, evidence });
    writeFileSync(prepared, preparedBytes);
    const result = { status: 'tested' as const, candidate: testedCandidate, checks: testedChecks };
    await h.device({ op: 'complete', jobId: repair.job.id, leaseToken: repair.leaseToken, result });
    recordPacketCompletion(directory, repair, result);
    const current: Checkout = { head: testedCandidate.head, tree: testedCandidate.tree, clean: true };
    expect(reconcilePacketLifecycle(directory, current)).toBe('prepared-candidate');
    await h.admin({ op: 'approve-deploy', requestId: randomUUID(), repairJobId: repair.job.id,
      candidate: testedCandidate, confirmation: true, releaseMode: 'targeted' });
    const deployment = await h.claim();
    await h.device({ op: 'start-deploy', jobId: deployment.job.id, leaseToken: deployment.leaseToken });
    const deployed = outcome === 'unknown' ? { status: 'unknown' as const, reason: 'release-unconfirmed' as const }
      : { status: 'deployed' as const, candidate: testedCandidate };
    await h.device({ op: 'complete', jobId: deployment.job.id, leaseToken: deployment.leaseToken, result: deployed });
    recordPacketCompletion(directory, deployment, deployed);
    if (outcome === 'tampered') {
      writeFileSync(prepared, `${preparedBytes} `);
      expect(() => reconcilePacketLifecycle(directory, current)).toThrow('evidence changed');
    } else if (outcome === 'unknown') {
      expect(reconcilePacketLifecycle(directory, current)).toBe('prepared-candidate');
    } else {
      expect(reconcilePacketLifecycle(directory, current)).toBeNull();
      expect(reconcilePacketLifecycle(directory, current)).toBeNull();
      expect(readFileSync(path.join(directory, 'archive', repair.job.id, 'prepared-release.json'), 'utf8')).toBe(preparedBytes);
      await h.device({ op: 'heartbeat', workspace: null, checkout: current, holdReason: null,
        allowReadOnly: true, allowRepair: true, allowDeploy: false, bridgeAvailable: true });
      const requestId = randomUUID();
      const packet = projectFreshEvidence(row, requestId, current);
      await store.transact(tx => applyAdminCommand(tx, actorId,
        { op: 'enqueue', action: 'review', deviceId, requestId }, now, { checkout: current, packet }));
      const next = await claim();
      expect(next.job.workspace.head).toBe(testedCandidate.head);
      prepareClaimPacket(next, enrollment, directory, () => current);
      return;
    }
    expect(existsSync(prepared)).toBe(true);
    expect(existsSync(path.join(directory, 'active-packet.json'))).toBe(true);
  });
});
