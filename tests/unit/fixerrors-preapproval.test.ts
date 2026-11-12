import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyAdminCommand, applyDeviceCommand, fulfillPreapprovedDeploy, type PreparedFixerrorsEvidence,
} from '@/lib/fixerrors/control';
import {
  adminCommandSchema, deviceCommandSchema, deviceResponseSchema, FIXERRORS_PREAPPROVAL_MS,
  publicQueueState, type FixerrorsJob,
} from '@/lib/fixerrors/protocol';
import { issueStartedReleaseTicket, verifyReleaseTicket } from '@/lib/fixerrors/release';
import { capturedBatch } from './fixerrors-batch-fixtures';
import { actorId, credential, deviceId, FixtureStore, now, workspace } from './fixerrors-control-fixtures';
import { preapprovedFixture } from './fixerrors-preapproval-fixtures';

describe('one-run conditional automatic Deploy', () => {
  it.each(['review', 'missing-mode', 'review-reuse', 'missing-batch', 'read-only-opt-out', 'repair-opt-out',
    'deploy-opt-out', 'bridge-unavailable'] as const)('rejects grant creation for %s without persisting authority', async reason => {
    const store = new FixtureStore();
    const requestId = randomUUID();
    const command = {
      op: 'enqueue' as const, action: reason === 'review' ? 'review' as const : 'repair' as const,
      deviceId, requestId, autoDeployConfirmation: true as const,
      ...(reason !== 'missing-mode' ? { requestedReleaseMode: 'targeted' as const } : {}),
      ...(reason === 'review-reuse' ? { reviewJobId: randomUUID() } : {}),
    };
    const evidence: PreparedFixerrorsEvidence = {
      checkout: workspace, packet: null, ...(reason !== 'missing-batch' ? { batch: capturedBatch(requestId) } : {}),
    };
    if (reason === 'read-only-opt-out') store.state.devices[0].allowReadOnly = false;
    if (reason === 'repair-opt-out') store.state.devices[0].allowRepair = false;
    if (reason === 'deploy-opt-out') store.state.devices[0].allowDeploy = false;
    if (reason === 'bridge-unavailable') store.state.devices[0].bridgeAvailable = false;
    await expect(store.transact(tx => applyAdminCommand(tx, actorId, command, now, evidence))).rejects.toThrow(
      reason.endsWith('opt-out') ? /opt/ : reason === 'bridge-unavailable' ? /bridge/ : /fresh repair batch/,
    );
    expect(store.state.jobs).toEqual([]);
    expect(store.events).toEqual([]);
  });

  it.each(['targeted', 'full'] as const)('freezes %s authority and creates only one separately signed exact-candidate release', async mode => {
    const f = await preapprovedFixture(mode);
    const grant = structuredClone(f.store.state.jobs[0].autoDeployPreapproval);
    expect(grant).toMatchObject({ actorId, runId: f.id, deviceId, base: { head: workspace.head, tree: workspace.tree },
      state: 'pending', releaseMode: mode, grantedAt: now, expiresAt: now + FIXERRORS_PREAPPROVAL_MS });
    expect(f.claimed.job).not.toHaveProperty('autoDeployPreapproval');
    await f.ready();
    const batch = f.store.state.jobs[0].privateBatch!;
    expect(batch.outcome!.candidate.treeFingerprint).not.toBe(JSON.parse(batch.manifest).retrieval.treeFingerprint);
    await Promise.all([f.fulfill(), f.fulfill(), f.fulfill()]);
    expect(f.store.state.jobs).toHaveLength(2);
    const deploy = f.store.state.jobs[1];
    expect(deploy).toMatchObject({ action: 'deploy', state: 'queued', parentRepairId: f.id,
      candidate: f.candidate, checks: f.evidence, approval: { actorId, releaseMode: mode, candidate: f.candidate } });
    expect(f.store.state.jobs[0].autoDeployPreapproval).toMatchObject({ state: 'consumed', deployJobId: deploy.id });
    expect(f.store.events.filter(event => event.event === 'deploy-preapproval-consumed')).toHaveLength(1);
    expect(f.store.events.filter(event => event.event === 'auto-exact-candidate-deploy-approved')).toHaveLength(1);
    const repair = generateKeyPairSync('ed25519');
    const release = generateKeyPairSync('ed25519');
    const claim = deviceResponseSchema.parse(await f.send({ op: 'claim' })).claim!;
    const result = await f.store.transact(tx => applyDeviceCommand(tx, deviceId, credential,
      { op: 'start-deploy', jobId: deploy.id, leaseToken: claim.leaseToken }, f.time(),
      job => issueStartedReleaseTicket(job, f.time(), {
        keyId: 'release', privateKey: release.privateKey, repairKeyId: 'repair', repairPublicKey: repair.publicKey,
      })));
    expect('releaseTicket' in result).toBe(true);
    const ticket = verifyReleaseTicket((result as { releaseTicket: string }).releaseTicket, {
      keyId: 'release', publicKey: release.publicKey, repairKeyId: 'repair', repairPublicKey: repair.publicKey,
    }, Math.floor(f.time() / 1000));
    expect(ticket).toMatchObject({ approvalId: deploy.id, repairJobId: f.id, head: f.candidate.head,
      tree: f.candidate.tree, releaseMode: mode, approvedBy: actorId, ...f.evidence.release });
  });

  it('waits for tests, lifecycle reconciliation and a subsequent prepared heartbeat in either order', async () => {
    const f = await preapprovedFixture();
    await f.fulfill();
    expect(f.store.state.jobs).toHaveLength(1);
    await f.complete();
    await f.fulfill();
    expect(f.store.state.jobs).toHaveLength(1);
    await f.heartbeat();
    await f.fulfill();
    expect(f.store.state.jobs).toHaveLength(1);
    f.lifecycle();
    await f.fulfill();
    expect(f.store.state.jobs).toHaveLength(2);
  });

  it('does not treat a claim poll as an independent prepared heartbeat', async () => {
    const f = await preapprovedFixture();
    await f.complete(); f.lifecycle();
    f.store.state.devices[0].holdReason = 'prepared-candidate';
    f.advance(1);
    await f.send({ op: 'claim' });
    await f.fulfill();
    expect(f.store.state.jobs).toHaveLength(1);
    await f.heartbeat(); await f.fulfill();
    expect(f.store.state.jobs).toHaveLength(2);
  });

  it('never extends an automatic release admission beyond the four-hour grant', async () => {
    const f = await preapprovedFixture();
    await f.complete(); f.lifecycle();
    f.advance(FIXERRORS_PREAPPROVAL_MS - 2);
    await f.heartbeat(); await f.fulfill();
    expect(f.store.state.jobs[1].expiresAt).toBe(now + FIXERRORS_PREAPPROVAL_MS);
    f.advance(1);
    await f.send({ op: 'claim' });
    expect(f.store.state.jobs[1].state).toBe('expired');
  });

  it('permanently withdraws authority after checkout drift, even when it later returns', async () => {
    const f = await preapprovedFixture();
    await f.complete(); f.lifecycle(); f.advance(1);
    await f.send({ op: 'heartbeat', workspace: null, checkout: null, holdReason: 'checkout-unavailable',
      allowReadOnly: true, allowRepair: true, allowDeploy: true, bridgeAvailable: true });
    await f.heartbeat(); await f.fulfill();
    expect(f.store.state.jobs[0].autoDeployPreapproval?.state).toBe('revoked');
    expect(f.store.state.jobs).toHaveLength(1);
  });

  it.each(['opt-out', 'checkout-drift'] as const)('blocks an already leased automatic release on %s before start', async reason => {
    const f = await preapprovedFixture();
    await f.ready(); await f.fulfill();
    const claim = deviceResponseSchema.parse(await f.send({ op: 'claim' })).claim!;
    const device = f.store.state.devices[0];
    await f.send({
      op: 'heartbeat', workspace: reason === 'opt-out' ? device.workspace : null,
      checkout: reason === 'opt-out' ? device.checkout : null,
      holdReason: reason === 'opt-out' ? 'prepared-candidate' : 'checkout-unavailable',
      allowReadOnly: true, allowRepair: true, allowDeploy: reason !== 'opt-out', bridgeAvailable: true,
    });
    await f.heartbeat();
    expect(f.store.state.jobs[0].autoDeployPreapproval?.state).toBe('revoked');
    expect(f.store.state.jobs[1].state).toBe('blocked');
    await expect(f.send({ op: 'start-deploy', jobId: claim.job.id, leaseToken: claim.leaseToken })).rejects.toThrow('Lease lost');
  });

  it.each(['failed', 'blocked', 'no-change', 'no-work', 'unknown', 'paused', 'remaining', 'failed-case', 'lifecycle', 'no-release', 'stale-heartbeat',
    'revoked', 'opt-out', 'role-lost', 'candidate', 'checks', 'checkout', 'manifest', 'mode', 'base', 'run', 'device', 'actor', 'expired'] as const)(
    'never auto-approves %s evidence', async reason => {
      const f = await preapprovedFixture();
      await f.ready();
      const job = f.store.state.jobs[0];
      const device = f.store.state.devices[0];
      if (['failed', 'blocked', 'no-change', 'no-work', 'unknown', 'paused'].includes(reason)) job.state = reason as FixerrorsJob['state'];
      if (reason === 'remaining') job.batch!.remaining = 1;
      if (reason === 'failed-case') job.batch!.counts.failed = 1;
      if (reason === 'lifecycle') job.batch!.lifecycle = 'blocked';
      if (reason === 'no-release') delete job.checks!.release;
      if (reason === 'stale-heartbeat') f.advance(45_000);
      if (reason === 'revoked') device.revoked = true;
      if (reason === 'opt-out') device.allowDeploy = false;
      if (reason === 'candidate') job.candidate!.head = 'f'.repeat(40);
      if (reason === 'checks') job.checks!.checks[0].outputSha256 = 'f'.repeat(64);
      if (reason === 'checkout') device.checkout!.tree = 'f'.repeat(40);
      if (reason === 'manifest') job.workspace.packetSha256 = 'f'.repeat(64);
      if (reason === 'mode') job.requestedReleaseMode = 'full';
      if (reason === 'base') job.autoDeployPreapproval!.base.tree = 'f'.repeat(40);
      if (reason === 'run') job.autoDeployPreapproval!.runId = randomUUID();
      if (reason === 'device') job.autoDeployPreapproval!.deviceId = randomUUID();
      if (reason === 'actor') job.autoDeployPreapproval!.actorId = randomUUID();
      if (reason === 'expired') f.advance(FIXERRORS_PREAPPROVAL_MS);
      await f.fulfill(reason !== 'role-lost');
      expect(f.store.state.jobs).toHaveLength(1);
      expect(f.store.events.some(event => event.event === 'auto-exact-candidate-deploy-approved')).toBe(false);
      if (reason === 'expired') expect(f.store.state.jobs[0].autoDeployPreapproval?.state).toBe('expired');
    },
  );

  it.each(['pending', 'tested', 'queued-release', 'leased-release'] as const)('revokes %s without deleting run/history', async stage => {
    const f = await preapprovedFixture();
    if (stage !== 'pending') await f.ready();
    if (stage === 'queued-release' || stage === 'leased-release') await f.fulfill();
    let leaseToken: string | undefined;
    if (stage === 'leased-release') leaseToken = deviceResponseSchema.parse(await f.send({ op: 'claim' })).claim!.leaseToken;
    await f.store.transact(tx => applyAdminCommand(tx, actorId, { op: 'revoke-preapproval', jobId: f.id }, f.time()));
    await f.fulfill();
    expect(f.store.state.jobs[0].autoDeployPreapproval?.state).toBe('revoked');
    if (f.store.state.jobs[1]) expect(f.store.state.jobs[1].state).toBe('blocked');
    if (leaseToken) await expect(f.send({ op: 'start-deploy', jobId: f.store.state.jobs[1].id, leaseToken })).rejects.toThrow('Lease lost');
    expect(f.store.events.some(event => event.event === 'deploy-preapproval-revoked')).toBe(true);
  });

  it('refuses to claim an already-started deployment was undone', async () => {
    const f = await preapprovedFixture();
    await f.ready(); await f.fulfill();
    const claim = deviceResponseSchema.parse(await f.send({ op: 'claim' })).claim!;
    await f.send({ op: 'start-deploy', jobId: claim.job.id, leaseToken: claim.leaseToken });
    await expect(f.store.transact(tx => applyAdminCommand(tx, actorId,
      { op: 'revoke-preapproval', jobId: f.id }, f.time()))).rejects.toThrow('already begun');
    expect(f.store.state.jobs[1].lease?.deployStartedAt).toBe(f.time());
  });

  it.each(['cancel', 'revoke-device', 'heartbeat'] as const)('withdraws authority on %s and cannot restore it by opting back in', async op => {
    const f = await preapprovedFixture();
    if (op === 'heartbeat') await f.send({ op, workspace, allowReadOnly: true, allowRepair: true, allowDeploy: false, bridgeAvailable: true });
    else await f.store.transact(tx => applyAdminCommand(tx, actorId, op === 'cancel'
      ? { op, jobId: f.id } : { op, deviceId }, f.time()));
    expect(f.store.state.jobs[0].autoDeployPreapproval?.state).toBe('revoked');
    expect(f.store.state.jobs).toHaveLength(1);
  });

  it('keeps manual exact confirmation valid and prevents a subsequent automatic duplicate', async () => {
    const f = await preapprovedFixture();
    await f.ready();
    await f.store.transact(tx => applyAdminCommand(tx, actorId, {
      op: 'approve-deploy', requestId: randomUUID(), repairJobId: f.id,
      confirmation: true, candidate: f.candidate, releaseMode: 'full',
    }, f.time()));
    await f.fulfill();
    expect(f.store.state.jobs).toHaveLength(2);
    expect(f.store.state.jobs[0].autoDeployPreapproval?.state).toBe('revoked');
    expect(f.store.state.jobs[1].approval?.releaseMode).toBe('full');
  });

  it('does not consume authority if audit or approval persistence fails', async () => {
    const f = await preapprovedFixture();
    await f.ready();
    await expect(f.store.transact(tx => fulfillPreapprovedDeploy({ ...tx, audit: event => {
      if (event.event === 'deploy-preapproval-consumed') throw new Error('Synthetic audit failure');
      tx.audit(event);
    } }, f.id, true, f.time()))).rejects.toThrow('audit failure');
    expect(f.store.state.jobs).toHaveLength(1);
    expect(f.store.state.jobs[0].autoDeployPreapproval?.state).toBe('pending');
    await f.fulfill();
    expect(f.store.state.jobs).toHaveLength(2);
  });

  it('strictly rejects device injection and projects only bounded public status, not private grant bindings', async () => {
    const f = await preapprovedFixture();
    expect(deviceCommandSchema.safeParse({ op: 'claim', autoDeployConfirmation: true }).success).toBe(false);
    expect(deviceCommandSchema.safeParse({ op: 'heartbeat', workspace, allowReadOnly: true, allowRepair: true,
      allowDeploy: true, bridgeAvailable: true, autoDeployPreapproval: f.store.state.jobs[0].autoDeployPreapproval }).success).toBe(false);
    expect(adminCommandSchema.safeParse({ op: 'enqueue', action: 'repair', deviceId, requestId: randomUUID(),
      autoDeployConfirmation: false }).success).toBe(false);
    const projected = publicQueueState(f.store.state).jobs[0];
    expect(projected.autoDeployment).toEqual({
      state: 'pending', grantedAt: now, expiresAt: now + FIXERRORS_PREAPPROVAL_MS, releaseMode: 'targeted',
    });
    expect(JSON.stringify(projected)).not.toMatch(/autoDeployPreapproval|manifestSha256|testedAt|testedCandidate|privateBatch/);
  });
});
