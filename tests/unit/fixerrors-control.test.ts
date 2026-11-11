import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  adminCommandSchema, deviceCommandSchema, publicQueueState, queueStateSchema,
} from '@/lib/fixerrors/protocol';
import {
  actorId, candidate, checks, credential, deviceId, FixtureStore, harness, workspace,
} from './fixerrors-control-fixtures';

describe('local Fixerrors durable queue contract (transaction fixture)', () => {
  it('retains only a fixed diagnostic code on a failed job and projects no private evidence', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    await h.enqueue();
    const claim = await h.claim();
    await h.device({ op: 'complete', jobId: claim.job.id, leaseToken: claim.leaseToken,
      result: { status: 'failed', reason: 'execution-failed', diagnostic: 'typecheck-cache-not-ready' } });
    expect(queueStateSchema.parse(store.state).jobs[0].diagnostic).toBe('typecheck-cache-not-ready');
    expect(publicQueueState(store.state).jobs[0]).toMatchObject({
      state: 'failed', reason: 'execution-failed', diagnostic: 'typecheck-cache-not-ready',
    });
    expect(publicQueueState(store.state).jobs[0]).not.toHaveProperty('lease');
    expect(deviceCommandSchema.safeParse({
      op: 'complete', jobId: claim.job.id, leaseToken: claim.leaseToken,
      result: { status: 'failed', reason: 'execution-failed', diagnostic: 'private exception text' },
    }).success).toBe(false);
    expect(store.state.jobs).toHaveLength(1);
    expect(store.state.jobs[0].approval).toBeNull();
  });

  it('requires a distinct approval transaction after candidate-bound checks pass', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    const repair = await h.testedRepair();
    expect(store.state.jobs).toHaveLength(1);
    expect(store.state.jobs[0]).toMatchObject({ state: 'tested', approval: null });
    await h.approve(repair);
    expect(store.state.jobs[1]).toMatchObject({
      action: 'deploy', state: 'queued', candidate,
      approval: { actorId, candidate },
    });
    expect(store.events.at(-1)).toMatchObject({
      event: 'exact-candidate-deploy-confirmed', candidate, actor: actorId,
    });
    const claim = await h.claim();
    await h.device({ op: 'start-deploy', jobId: claim.job.id, leaseToken: claim.leaseToken });
    await h.device({ op: 'complete', jobId: claim.job.id, leaseToken: claim.leaseToken, result: { status: 'deployed', candidate } });
    expect(store.state.jobs[1].state).toBe('deployed');
  });

  it('allows review without repair or deploy authority and never creates a deploy job', async () => {
    const store = new FixtureStore();
    store.state.devices[0].allowRepair = false;
    store.state.devices[0].allowDeploy = false;
    const h = harness(store);
    await h.enqueue('review');
    const claim = await h.claim();
    await h.device({ op: 'complete', jobId: claim.job.id, leaseToken: claim.leaseToken, result: { status: 'reviewed' } });
    expect(store.state.jobs.map((job) => job.action)).toEqual(['review']);
    await expect(h.enqueue('repair')).rejects.toThrow('opted');
  });

  it('keeps a started deployment leased past the five-minute approval window', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    await h.approve(await h.testedRepair());
    const claim = await h.claim();
    const lease = { jobId: claim.job.id, leaseToken: claim.leaseToken };
    await expect(h.device({ op: 'complete', ...lease, result: { status: 'deployed', candidate } }))
      .rejects.toThrow('has not started');
    await h.device({ op: 'start-deploy', ...lease });
    await expect(h.device({ op: 'start-deploy', ...lease })).rejects.toThrow('cannot be started');
    for (let elapsed = 0; elapsed < 6 * 60_000; elapsed += 15_000) {
      h.advance(15_000);
      await h.device({ op: 'renew', ...lease });
    }
    await h.device({ op: 'complete', ...lease, result: { status: 'deployed', candidate } });
    expect(store.state.jobs[1].state).toBe('deployed');
  });

  it('requires reconciliation after a started deployment loses its lease', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    await h.approve(await h.testedRepair());
    const claim = await h.claim();
    const lease = { jobId: claim.job.id, leaseToken: claim.leaseToken };
    await h.device({ op: 'start-deploy', ...lease });
    h.advance(60_000);
    await h.device({ op: 'heartbeat', workspace, allowReadOnly: true, allowRepair: true, allowDeploy: true, bridgeAvailable: true });
    expect(store.state.jobs[1]).toMatchObject({ state: 'unknown', reason: 'release-unconfirmed', lease: null });
    expect(publicQueueState(store.state).releaseNeedsReconciliation).toBe(true);
    await expect(h.device({ op: 'renew', ...lease })).rejects.toThrow('Lease lost');
    await expect(h.enqueue('repair')).rejects.toThrow('needs reconciliation');
    await expect(h.enqueue('review')).rejects.toThrow('tested candidate');
  });

  it('does not allow a claim to start after the original approval expires', async () => {
    const h = harness();
    await h.approve(await h.testedRepair());
    h.advance(290_000);
    await h.device({ op: 'heartbeat', workspace: { ...workspace, head: candidate.head, tree: candidate.tree },
      allowReadOnly: true, allowRepair: true, allowDeploy: true, bridgeAvailable: true });
    const claim = await h.claim();
    h.advance(10_000);
    await expect(h.device({ op: 'start-deploy', jobId: claim.job.id, leaseToken: claim.leaseToken }))
      .rejects.toThrow('Lease lost');
  });

  it('atomically denies duplicate request ids and simultaneous duplicate claims', async () => {
    const h = harness();
    const id = await h.enqueue();
    await expect(h.enqueue('repair', id)).rejects.toThrow('Duplicate');
    const claims = await Promise.allSettled([h.claim(), h.claim()]);
    expect(claims.filter((claim) => claim.status === 'fulfilled')).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === 'rejected')).toHaveLength(1);
  });

  it('does not reclaim an expired lease or accept its old completion', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    await h.enqueue();
    const claim = await h.claim();
    h.advance(60_000);
    await h.device({ op: 'heartbeat', workspace, allowReadOnly: true, allowRepair: true, allowDeploy: true, bridgeAvailable: true });
    await expect(h.device({ op: 'renew', jobId: claim.job.id, leaseToken: claim.leaseToken })).rejects.toThrow('Lease lost');
    expect(await h.device({ op: 'claim' })).toMatchObject({ claim: null });
    expect(store.state.jobs[0].state).toBe('expired');
  });

  it('expires queued jobs with no retry and consumes request ids permanently', async () => {
    const h = harness();
    const id = await h.enqueue();
    h.advance(600_000);
    await h.device({ op: 'heartbeat', workspace, allowReadOnly: true, allowRepair: true, allowDeploy: true, bridgeAvailable: true });
    expect(await h.device({ op: 'claim' })).toMatchObject({ claim: null });
    await expect(h.enqueue('repair', id)).rejects.toThrow('Duplicate');
  });

  it('rejects wrong secret, foreign device and wrong lease owner', async () => {
    const h = harness();
    await expect(h.device({ op: 'claim' }, 'q'.repeat(43))).rejects.toThrow('Unauthorized');
    await expect(h.device({ op: 'claim' }, credential, randomUUID())).rejects.toThrow('Unauthorized');
    await h.enqueue();
    const claim = await h.claim();
    await expect(h.device({ op: 'renew', jobId: claim.job.id, leaseToken: 'y'.repeat(43) })).rejects.toThrow('Lease lost');
  });

  it('revokes the credential and blocks active work atomically', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    await h.enqueue();
    const claim = await h.claim();
    await h.admin({ op: 'revoke-device', deviceId });
    expect(store.state.jobs[0]).toMatchObject({ state: 'blocked', lease: null });
    await expect(h.device({ op: 'renew', jobId: claim.job.id, leaseToken: claim.leaseToken })).rejects.toThrow('Unauthorized');
  });

  it.each(['head', 'tree', 'checksSha256'] as const)('rejects changed approval %s', async (field) => {
    const h = harness();
    const repairJobId = await h.testedRepair();
    await expect(h.admin({
      op: 'approve-deploy', requestId: randomUUID(), repairJobId,
      candidate: { ...candidate, [field]: 'f'.repeat(field === 'checksSha256' ? 64 : 40) },
      confirmation: true, releaseMode: 'full',
    })).rejects.toThrow('mismatch');
  });

  it('rejects stale candidates at confirmation and again at claim', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    const repair = await h.testedRepair();
    store.state.devices[0].workspace = { ...workspace, head: 'f'.repeat(40) };
    await expect(h.approve(repair)).rejects.toThrow('Stale');
    store.state.devices[0].workspace = { ...workspace, head: candidate.head, tree: candidate.tree };
    await h.approve(repair);
    store.state.devices[0].workspace = { ...workspace };
    await expect(h.claim()).rejects.toThrow('Checkout changed');
  });

  it('denies approval before checks, automatic deploy, and repeat confirmations', async () => {
    const h = harness();
    const id = await h.enqueue();
    await expect(h.approve(id)).rejects.toThrow('mismatch');
    const claim = await h.claim();
    await h.device({ op: 'complete', jobId: id, leaseToken: claim.leaseToken, result: { status: 'tested', candidate, checks } });
    await h.approve(id);
    await expect(h.approve(id)).rejects.toThrow('already approved');
    expect(adminCommandSchema.safeParse({ op: 'enqueue', requestId: randomUUID(), deviceId, action: 'deploy' }).success).toBe(false);
  });

  it('rejects false evidence digests, wrong actions and duplicate completion', async () => {
    const h = harness();
    await h.enqueue();
    const claim = await h.claim();
    const lease = { jobId: claim.job.id, leaseToken: claim.leaseToken };
    await expect(h.device({ op: 'complete', ...lease, result: { status: 'tested', candidate: { ...candidate, checksSha256: '0'.repeat(64) }, checks } })).rejects.toThrow('evidence');
    await expect(h.device({ op: 'complete', ...lease, result: { status: 'reviewed' } })).rejects.toThrow('Wrong result');
    await h.device({ op: 'complete', ...lease, result: { status: 'blocked', reason: 'bridge-unavailable' } });
    await expect(h.device({ op: 'complete', ...lease, result: { status: 'tested', candidate, checks } })).rejects.toThrow('Lease lost');
  });

  it('hides authenticators from the browser and bounds history', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    await h.enqueue();
    await h.claim();
    const snapshot = JSON.stringify(publicQueueState(store.state));
    expect(snapshot).not.toContain('credentialSha256');
    expect(snapshot).not.toContain('tokenSha256');
    expect(snapshot).not.toContain('leaseToken');
  });

  it.each([
    { op: 'enqueue', requestId: randomUUID(), deviceId, action: 'repair', command: 'fap' },
    { op: 'enqueue', requestId: randomUUID(), deviceId, action: 'repair', path: 'D:\\elsewhere' },
    { op: 'enqueue', requestId: randomUUID(), deviceId, action: 'repair', prompt: 'do anything' },
    { op: 'approve-deploy', requestId: randomUUID(), repairJobId: randomUUID(), candidate, confirmation: 'yes' },
  ])('rejects arbitrary site fields or missing exact confirmation %j', (input) => {
    expect(adminCommandSchema.safeParse(input).success).toBe(false);
  });

  it('rejects malformed device messages and failed check evidence', () => {
    expect(deviceCommandSchema.safeParse({ op: 'exec', argv: ['fap'] }).success).toBe(false);
    expect(deviceCommandSchema.safeParse({
      op: 'complete', jobId: randomUUID(), leaseToken: credential,
      result: { status: 'tested', candidate, checks: { ...checks, checks: [] } },
    }).success).toBe(false);
  });

  it.each(['full', 'targeted'] as const)('stores explicit %s consent in the approval, audit and leased job', async (mode) => {
    const store = new FixtureStore();
    const h = harness(store);
    await h.approve(await h.testedRepair(), mode);
    expect(store.state.jobs[1].approval?.releaseMode).toBe(mode);
    expect(store.events.at(-1)?.releaseMode).toBe(mode);
    expect((await h.claim()).job.approval?.releaseMode).toBe(mode);
  });

  it('does not claim an approved deployment while an execution reconciliation hold remains', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    await h.approve(await h.testedRepair());
    store.state.devices[0].holdReason = 'packet-needs-reconciliation';
    await expect(h.claim()).rejects.toThrow('reconciliation');
    expect(store.state.jobs[1].state).toBe('queued');
  });

  it('requires true consent and a known explicit mode, while preserving historical full-only jobs', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    const repairJobId = await h.testedRepair();
    const input = { op: 'approve-deploy', requestId: randomUUID(), repairJobId, candidate, confirmation: true, releaseMode: 'full' };
    for (const change of [{ confirmation: false }, { confirmation: undefined }, { confirmation: 'DEPLOY EXACT TESTED CANDIDATE' }, { releaseMode: undefined }, { releaseMode: 'fast' }, { releaseMode: null }]) {
      expect(adminCommandSchema.safeParse({ ...input, ...change }).success).toBe(false);
    }
    await h.approve(repairJobId);
    delete store.state.jobs[1].approval!.releaseMode;
    expect(queueStateSchema.parse(store.state).jobs[1].approval?.releaseMode).toBeUndefined();
    expect((await h.claim()).job.approval?.releaseMode ?? 'full').toBe('full');
  });
});
