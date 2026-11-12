import { generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyAdminCommand, applyDeviceCommand } from '@/lib/fixerrors/control';
import { batchHash, batchOutcomeHash, parseCapturedBatch, signBatchLease } from '@/lib/fixerrors/batch';
import { issueClaimedFixerrorsAdmission } from '@/lib/fixerrors/admission';
import { deviceResponseSchema, publicQueueState, type DeviceCommand } from '@/lib/fixerrors/protocol';
import { receiveCompanionBatch } from '@/scripts/automation/fixerrors-companion';
import { capturedBatch } from './fixerrors-batch-fixtures';
import { actorId, credential, deviceId, FixtureStore, now, workspace } from './fixerrors-control-fixtures';
import { classifyIncident } from '@/lib/fixerrors/triage';

const issuer = generateKeyPairSync('ed25519');
const release = generateKeyPairSync('ed25519');

async function connected(count = 2) {
  const store = new FixtureStore();
  const id = randomUUID();
  const batch = capturedBatch(id, count);
  await store.transact(tx => applyAdminCommand(tx, actorId,
    { op: 'enqueue', action: 'repair', requestId: id, deviceId }, now,
    { checkout: workspace, packet: null, batch }));
  let time = now;
  const request = async (command: DeviceCommand, requestDeviceId = deviceId) => deviceResponseSchema.parse(await store.transact(tx =>
    applyDeviceCommand(tx, requestDeviceId, credential, command, time, undefined,
      (job, at) => issueClaimedFixerrorsAdmission(job, at, {
        keyId: 'squires-repair-v1', privateKey: issuer.privateKey,
        releaseKeyId: 'squires-release-v1', releasePublicKey: release.publicKey,
      }),
      (job, checkpoint, at) => signBatchLease({
        runId: job.id, deviceId: requestDeviceId, manifestSha256: job.workspace.packetSha256,
        checkpointSha256: checkpoint.checkpointSha256, sequence: job.privateBatch!.sequence + 1,
        resume: checkpoint.resume,
      }, at, 'squires-repair-v1', issuer.privateKey))));
  const claim = (await request({ op: 'claim' })).claim!;
  const outcome = { runId: `fixerrors-${id}`, candidate: { baseHead: workspace.head, treeFingerprint: 'b'.repeat(64) },
    clusters: [{ id: 'cluster-1', status: 'held', reason: 'Synthetic hold', attempt: 'Synthetic analysis',
      tests: [], evidence: ['Source inspected'] }], decisions: [] };
  return { store, id, batch, request, claim, outcome, advance: (ms: number) => { time += ms; } };
}

describe('authenticated retained batch control', () => {
  it('projects bounded importance and timings, rejecting invented importance and private details', async () => {
    const { store, claim, request, outcome } = await connected();
    const enriched = { ...outcome, clusters: [{ ...outcome.clusters[0],
      triage: classifyIncident(), timings: { analysisMs: 12, repairAndChecksMs: 0, totalMs: 14 } }] };
    const command = { op: 'batch-lease' as const, jobId: claim.job.id, leaseToken: claim.leaseToken,
      cursor: 1, checkpointSha256: batchHash('timed checkpoint'), resume: false, outcome: enriched };
    const invented = structuredClone(enriched);
    invented.clusters[0].triage = { ...classifyIncident(), importance: 'Routine' };
    await expect(request({ ...command, outcome: invented })).rejects.toThrow('importance');
    await request(command);
    const progress = publicQueueState(store.state).jobs[0].batch;
    expect(progress).toMatchObject({ triage: { Routine: 0, Important: 1, Urgent: 0 },
      latest: { importance: 'Important', reason: 'impact-uncertain', effort: 'focused', route: 'held',
        analysisMs: 12, repairAndChecksMs: 0, totalMs: 14 } });
    expect(JSON.stringify(progress)).not.toMatch(/Synthetic hold|Source inspected|normalizedMessage/u);
  });
  it('delivers every authenticated chunk above the old packet limit and never exposes private bindings', async () => {
    const { store, batch, claim, request } = await connected(240);
    expect(Buffer.byteLength(batch.manifest)).toBeGreaterThan(96 * 1024);
    expect((await receiveCompanionBatch(claim, request)).toString()).toBe(batch.manifest);
    const publicText = JSON.stringify(publicQueueState(store.state));
    expect(publicText).not.toContain('Synthetic private row');
    expect(publicText).not.toContain('normalizedMessage');
    expect(publicText).not.toContain('manifestSha256');
    const lease = { jobId: claim.job.id, leaseToken: claim.leaseToken };
    await expect(request({ op: 'batch-chunk', ...lease, leaseToken: 'z'.repeat(43), index: 0 })).rejects.toThrow();
    await expect(receiveCompanionBatch(claim, async command => {
      const result = await request(command);
      if (result.chunk) result.chunk.data = Buffer.from('tampered').toString('base64url');
      return result;
    })).rejects.toThrow('changed');
  });

  it('admits only the authenticated confirmed paused run after a repaired-prefix null-checkout heartbeat', async () => {
    const { store, claim, request, outcome, advance } = await connected();
    const lease = { jobId: claim.job.id, leaseToken: claim.leaseToken };
    const checkpointSha256 = batchHash('synthetic repaired prefix');
    await request({ op: 'batch-lease', ...lease, cursor: 1, checkpointSha256, resume: false, outcome });
    await request({ op: 'pause-batch', ...lease, checkpointSha256 });
    advance(610_000);
    await request({ op: 'heartbeat', workspace: null, checkout: null, holdReason: 'packet-needs-reconciliation',
      allowReadOnly: true, allowRepair: true, allowDeploy: false, bridgeAvailable: true });
    const resumed = (await request({ op: 'claim' })).claim!;
    expect(resumed.resume).toBe(true);
    expect(resumed.admissionTicket).not.toBe(claim.admissionTicket);
    const ticket = JSON.parse(resumed.admissionTicket!);
    expect(JSON.parse(Buffer.from(ticket.payload, 'base64url').toString()).expiresAt).toBeGreaterThan(now / 1000 + 610);
    const authority = await request({ op: 'batch-lease', jobId: claim.job.id, leaseToken: resumed.leaseToken,
      cursor: 1, checkpointSha256, resume: true, outcome });
    const signed = JSON.parse(authority.batchLease!);
    expect(verify(null, Buffer.from(`squires-fixerrors-batch-lease-v1\n${signed.keyId}\n${signed.payload}`),
      issuer.publicKey, Buffer.from(signed.signature, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(signed.payload, 'base64url').toString()).authority).toBe('resume');
    expect(store.state.jobs[0].batch).toMatchObject({ processed: 1, remaining: 1 });
    await expect(store.transact(tx => applyAdminCommand(tx, actorId,
      { op: 'enqueue', action: 'repair', deviceId, requestId: randomUUID() }, now + 610_000)))
      .rejects.toThrow('checkout unavailable');
  });

  it('rejects unconfirmed dirty new admission, checkpoint changes, prefix rewrites and revoked/cancelled authority', async () => {
    const { store, claim, request, outcome } = await connected();
    const lease = { jobId: claim.job.id, leaseToken: claim.leaseToken };
    const checkpointSha256 = batchHash('checkpoint');
    const command = { op: 'batch-lease' as const, ...lease, cursor: 1, checkpointSha256, resume: false, outcome };
    await request(command);
    await request(structuredClone(command));
    await expect(request({ ...command, outcome: { ...outcome, clusters: [{ ...outcome.clusters[0], reason: 'rewrite' }] } }))
      .rejects.toThrow('prefix changed');
    await expect(request({ ...command, checkpointSha256: batchHash('drift') })).rejects.toThrow('mismatch');
    await store.transact(tx => applyAdminCommand(tx, actorId, { op: 'cancel', jobId: claim.job.id }, now));
    await expect(request(command)).rejects.toThrow('Lease lost');
    store.state.devices[0].workspace = null;
    store.state.devices[0].checkout = null;
    store.state.jobs[0].state = 'queued';
    await expect(request({ op: 'claim' })).rejects.toThrow('checkout unavailable');
  });

  it('renews identical decision content after JSONB-style key reordering and still rejects changed content', async () => {
    const { store, claim, request, outcome } = await connected();
    const decision = { id: 'cluster-1', lane: 'fast', action: 'manual-investigation', disposition: 'outstanding',
      nextStep: 'Inspect the synthetic source failure', evidencePaths: ['lib/utils/display-label.ts'],
      files: [], requiredTestIds: [], forbiddenChanges: ['suppress-logging', 'empty-success', 'weaken-authorization'],
      rationale: 'Synthetic evidence requires investigation', priorIncidentIds: [], evidenceEnrichmentAttempted: true };
    const full = { ...outcome, decisions: [decision] };
    const command = { op: 'batch-lease' as const, jobId: claim.job.id, leaseToken: claim.leaseToken,
      cursor: 1, checkpointSha256: batchHash('ordered keys'), resume: false, outcome: full };
    await request(structuredClone(command));
    const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) :
      value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) =>
        a.length - b.length || a.localeCompare(b)).map(([key, entry]) => [key, reorder(entry)])) : value;
    const checkpoint = store.state.jobs[0].privateBatch!.checkpoint!;
    checkpoint.outcome = reorder(checkpoint.outcome);
    expect(JSON.stringify(checkpoint.outcome)).not.toBe(JSON.stringify(full));
    await expect(request(structuredClone(command))).resolves.toMatchObject({ ok: true });
    const changed = structuredClone(command);
    changed.outcome.decisions[0].rationale = 'Changed evidence';
    await expect(request(changed)).rejects.toThrow('Completed batch prefix changed');
  });

  it('binds final completion to the exact full outcome and retains a strictly parsed private record set', async () => {
    const { store, id, claim, request, outcome } = await connected(1);
    const lease = { jobId: id, leaseToken: claim.leaseToken };
    await request({ op: 'batch-lease', ...lease, cursor: 1, checkpointSha256: batchHash('done'), resume: false, outcome });
    await expect(request({ op: 'complete', ...lease, result: { status: 'no-change' }, outcomeSha256: batchHash('wrong') }))
      .rejects.toThrow('hash mismatch');
    await request({ op: 'complete', ...lease, result: { status: 'no-change' }, outcomeSha256: batchOutcomeHash(outcome) });
    const retained = store.state.jobs[0].privateBatch!;
    expect(parseCapturedBatch(retained, id).outcome).toEqual(outcome);
    await expect(request({ op: 'batch-chunk', ...lease, index: 0 })).rejects.toThrow('Lease lost');
    expect(() => parseCapturedBatch({ ...retained, suppressed: retained.bindings[0].records }, id)).toThrow('coverage');
  });

  it.each([
    ['leased', 'revoked'], ['leased', 'withdrawn'], ['leased', 'stale'],
    ['paused', 'revoked'], ['paused', 'withdrawn'], ['paused', 'stale'],
  ] as const)('denies %s batch authority when device consent is %s', async (state, denial) => {
    const { store, claim, request, outcome, advance } = await connected();
    const lease = { jobId: claim.job.id, leaseToken: claim.leaseToken };
    const checkpointSha256 = batchHash('confirmed prefix');
    await request({ op: 'batch-lease', ...lease, cursor: 1, checkpointSha256, resume: false, outcome });
    if (state === 'paused') await request({ op: 'pause-batch', ...lease, checkpointSha256 });
    if (denial === 'revoked') {
      await store.transact(tx => applyAdminCommand(tx, actorId, { op: 'revoke-device', deviceId }, now));
    } else if (denial === 'withdrawn') {
      await request({ op: 'heartbeat', workspace,
        checkout: { head: workspace.head, tree: workspace.tree, clean: true },
        allowReadOnly: true, allowRepair: false, allowDeploy: false, bridgeAvailable: true });
    } else advance(45_000);
    const before = structuredClone(store.state);
    await expect(request(state === 'paused' ? { op: 'claim' } :
      { op: 'batch-lease', ...lease, cursor: 1, checkpointSha256, resume: false, outcome }))
      .rejects.toThrow(denial === 'revoked' ? 'Unauthorized device' :
        denial === 'withdrawn' ? 'not opted into' : 'Device offline');
    expect(store.state).toEqual(before);
  });

  it('never gives another authenticated device the retained paused run or its checkpoint authority', async () => {
    const { store, claim, request, outcome } = await connected();
    const otherDeviceId = randomUUID();
    store.state.devices.push({ ...structuredClone(store.state.devices[0]), id: otherDeviceId });
    const lease = { jobId: claim.job.id, leaseToken: claim.leaseToken };
    const checkpointSha256 = batchHash('owned checkpoint');
    await request({ op: 'batch-lease', ...lease, cursor: 1, checkpointSha256, resume: false, outcome });
    await request({ op: 'pause-batch', ...lease, checkpointSha256 });
    expect((await request({ op: 'claim' }, otherDeviceId)).claim).toBeNull();
    await expect(request({ op: 'batch-lease', ...lease, cursor: 1, checkpointSha256, resume: true, outcome },
      otherDeviceId)).rejects.toThrow('Lease lost or not owned');
    expect(store.state.jobs[0]).toMatchObject({ state: 'paused', privateBatch: { stopped: true } });
  });
});
