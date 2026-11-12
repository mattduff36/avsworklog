import { randomUUID } from 'node:crypto';
import * as synthetic from '@/lib/utils/fixerrors-controlled-acceptance';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAdminCommand, applyDeviceCommand, checkEvidenceDigest } from '@/lib/fixerrors/control';
import { batchOutcomeHash, describeBatch, parseBatchBytes, parseCapturedBatch } from '@/lib/fixerrors/batch';
import { deviceResponseSchema, publicQueueState, type DeviceCommand } from '@/lib/fixerrors/protocol';
import { reconcileBatchLifecycle } from '@/lib/server/fixerrors/batch-lifecycle';
import { reconcileDeployedBatchLifecycle, reconcileDeviceDeployments } from '@/lib/server/fixerrors/deployment-lifecycle';
import { SYNTHETIC_REPAIR_SOURCE, SYNTHETIC_REPAIR_TEST } from '@/lib/server/fixerrors/live-verification';
import { hashLifecycleRecord, readLifecycle, type LifecycleRecord } from '@/scripts/fixerrors-lifecycle';
import { parseAutomaticFixerrorsRetrieval } from '@/scripts/fixerrors-auto';
import type { PgClientLike } from '@/scripts/fixerrors-safety';
import { capturedBatch } from './fixerrors-batch-fixtures';
import { actorId, checks, credential, deviceId, FixtureStore, now, workspace } from './fixerrors-control-fixtures';

const database = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/server/fixerrors/evidence', () => ({ withFixerrorsApplicationDatabase: database.run }));
beforeEach(() => {
  // Exercise reconciliation against a repaired deployment, independent of E2E rearming.
  vi.spyOn(synthetic, 'syntheticDisplayLabel').mockImplementation(value => value.trim());
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL', '1'); vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('SQUIRES_FIXERRORS_PRODUCTION_ENABLED', '1');
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', checks.head); vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_Synthetic');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    commit_sha: checks.head, deployment_id: 'dpl_Synthetic',
  }))));
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); database.run.mockReset();
});

type Case = 'synthetic' | 'unsupported' | 'held' | 'report-only' | 'failed';
async function fixture(cases: Case[] = ['synthetic']) {
  const store = new FixtureStore();
  const id = randomUUID();
  const batch = capturedBatch(id, cases.length);
  const manifest = parseBatchBytes(Buffer.from(batch.manifest));
  manifest.retrieval = parseAutomaticFixerrorsRetrieval({ ...manifest.retrieval,
    clusters: manifest.retrieval.clusters.map((cluster, index) => {
      if (cases[index] === 'unsupported') return cluster;
      return { ...cluster, query: { ...cluster.query, sourceFile: SYNTHETIC_REPAIR_SOURCE },
        sourceFiles: [SYNTHETIC_REPAIR_SOURCE], held: cases[index] === 'held' };
    }),
  });
  batch.manifest = JSON.stringify(manifest);
  batch.delivery = describeBatch(batch.manifest, cases.length);
  for (const binding of batch.bindings) {
    binding.records[0] = { ...binding.records[0], error_stack: `at label (./${SYNTHETIC_REPAIR_SOURCE}:3:2)`,
      archived_at: null, triaged_at: null, triage_incident_id: null, triage_summary: null, triage_next_step: null,
      triage_local_commit: null, triage_live_verified_at: null, triage_live_evidence: null, additional_data: {} };
  }
  const evidence = { ...structuredClone(checks), release: {
    candidateSha256: '4'.repeat(64), testEvidenceSha256: '5'.repeat(64),
  } };
  const candidate = { head: evidence.head, tree: evidence.tree, checksSha256: checkEvidenceDigest(evidence) };
  const outcome = {
    runId: `fixerrors-${id}`, candidate: { baseHead: workspace.head, treeFingerprint: 'c'.repeat(64) },
    clusters: cases.map((kind, index) => ({
      id: `cluster-${index + 1}`, status: kind === 'synthetic' || kind === 'unsupported' ? 'verified-local' as const : kind,
      reason: 'Synthetic source investigation', attempt: 'Synthetic scoped repair',
      tests: [SYNTHETIC_REPAIR_TEST], evidence: ['Synthetic candidate-bound receipts'],
    })),
    decisions: cases.flatMap((kind, index) => kind === 'held' || kind === 'failed' ? [] : [{
      id: `cluster-${index + 1}`, lane: 'fast' as const,
      action: kind === 'report-only' ? 'report-only' as const : 'fix' as const,
      disposition: kind === 'report-only' ? 'no_fix_required' as const : 'outstanding' as const,
      nextStep: kind === 'report-only' ? null : 'Inspect synthetic source evidence',
      evidencePaths: [SYNTHETIC_REPAIR_SOURCE], files: [SYNTHETIC_REPAIR_SOURCE, SYNTHETIC_REPAIR_TEST],
      requiredTestIds: [SYNTHETIC_REPAIR_TEST], forbiddenChanges: ['suppress-logging', 'empty-success', 'weaken-authorization'],
      rationale: 'Synthetic label regression', priorIncidentIds: [], evidenceEnrichmentAttempted: true,
    }]),
  };
  await store.transact(tx => applyAdminCommand(tx, actorId, {
    op: 'enqueue', action: 'repair', deviceId, requestId: id,
  }, now, { checkout: workspace, packet: null, batch }));
  const send = (command: DeviceCommand) => store.transact(tx => applyDeviceCommand(tx, deviceId, credential, command, Date.now()));
  const claimed = deviceResponseSchema.parse(await send({ op: 'claim' })).claim!;
  store.state.jobs[0].privateBatch!.checkpoint = {
    cursor: cases.length, checkpointSha256: '6'.repeat(64), outcome, resume: false,
  };
  await send({ op: 'complete', jobId: id, leaseToken: claimed.leaseToken,
    result: { status: 'tested', candidate, checks: evidence }, outcomeSha256: batchOutcomeHash(outcome) });
  const records = new Map(batch.bindings.flatMap(binding => binding.records).map(row => [row.id, structuredClone(row)]));
  let staged = new Map<string, LifecycleRecord>();
  let updates = 0, loseCommit = false, unsafeSchema = false;
  const client: PgClientLike = { async query<T extends Record<string, unknown>>(text: string, values: unknown[] = []) {
    let rows: Record<string, unknown>[] = [];
    if (text.includes('FROM pg_class')) rows = [
      { relkind: 'r', rules: false, triggers: unsafeSchema, cascading: false, inherits: false },
    ];
    if (text.includes('FROM public.error_logs')) rows = (values[0] as string[])
      .flatMap(key => records.has(key) ? [{ record: structuredClone(records.get(key)!) }] : []);
    if (text.includes('UPDATE public.error_logs')) {
      const row = records.get(String(values[0]))!;
      const additional = JSON.parse(String(values[11]));
      const live = additional.fixerrorsLifecycle.state === 'fixed-live';
      const retained = store.state.jobs[0].privateBatch!;
      expect(Object.keys(live ? retained.deployment!.receipts : retained.lifecycle!.receipts)
        .some(file => file.endsWith('.pre.json'))).toBe(true);
      updates++;
      const next = { ...row, status: values[1], archived_at: values[2], triage_state: values[3], triaged_at: values[4],
        triage_incident_id: values[5], triage_summary: values[6], triage_next_step: values[7],
        triage_local_commit: values[8], triage_live_verified_at: values[9],
        triage_live_evidence: values[10] ? JSON.parse(String(values[10])) : null, additional_data: additional };
      staged.set(row.id, next);
      rows = [{ record: next }];
    }
    if (text === 'COMMIT') {
      for (const [key, row] of staged) records.set(key, row);
      staged = new Map();
      if (loseCommit) { loseCommit = false; throw new Error('Synthetic lost commit acknowledgement'); }
    }
    if (text === 'ROLLBACK') staged = new Map();
    return { rows: rows as T[], rowCount: rows.length };
  } };
  database.run.mockImplementation(async (work: (client: PgClientLike, target: string) => Promise<unknown>) => work(client, batch.target));
  expect(await reconcileBatchLifecycle(store, id)).toBe('applied');
  const localUpdates = updates;
  let releaseId = '';
  const approve = async () => {
    await send({ op: 'heartbeat', workspace: { ...workspace, packetSha256: batch.delivery.manifestSha256,
      head: candidate.head, tree: candidate.tree }, checkout: { head: candidate.head, tree: candidate.tree, clean: true },
      holdReason: 'prepared-candidate', allowReadOnly: true, allowRepair: true, allowDeploy: true, bridgeAvailable: true });
    releaseId = randomUUID();
    await store.transact(tx => applyAdminCommand(tx, actorId, {
      op: 'approve-deploy', requestId: releaseId, repairJobId: id, candidate, confirmation: true, releaseMode: 'targeted',
    }, Date.now()));
  };
  const deploy = async () => {
    if (!releaseId) await approve();
    const claim = deviceResponseSchema.parse(await send({ op: 'claim' })).claim!;
    await send({ op: 'start-deploy', jobId: releaseId, leaseToken: claim.leaseToken });
    await send({ op: 'complete', jobId: releaseId, leaseToken: claim.leaseToken, result: { status: 'deployed', candidate } });
  };
  return { store, id, records, outcome, candidate, send, approve, deploy, releaseId: () => releaseId,
    live: () => store.state.jobs[0].privateBatch!.deployment, updates: () => updates - localUpdates,
    loseCommit: () => { loseCommit = true; }, unsafeSchema: () => { unsafeSchema = true; } };
}

describe('post-deployment exact incident reconciliation (synthetic mock application DB)', () => {
  it('retries the serving candidate despite an older unreconcilable deployment', async () => {
    const f = await fixture();
    await f.deploy();
    const oldParent = structuredClone(f.store.state.jobs[0]);
    const oldRelease = structuredClone(f.store.state.jobs[1]);
    oldParent.id = randomUUID(); oldRelease.id = randomUUID();
    oldRelease.parentRepairId = oldParent.id;
    oldRelease.candidate!.head = 'f'.repeat(40);
    oldParent.candidate!.head = 'f'.repeat(40);
    f.store.state.jobs.splice(1, 0, oldRelease);
    f.store.state.jobs.push(oldParent);
    await reconcileDeviceDeployments(f.store, deviceId);
    expect(f.updates()).toBe(1);
    expect([...f.records.values()][0].triage_state).toBe('fixed_live');
    expect(oldParent.privateBatch!.deployment).toBeUndefined();
  });

  it('does not close anything before a confirmed deployment, including after approval', async () => {
    const f = await fixture();
    await reconcileDeployedBatchLifecycle(f.store, f.id);
    await f.approve();
    await reconcileDeployedBatchLifecycle(f.store, f.releaseId());
    expect(f.live()).toBeUndefined();
    expect(f.updates()).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect([...f.records.values()][0]).toMatchObject({ status: 'active', triage_state: 'outstanding' });
  });

  it('closes only exact repaired synthetic rows and preserves held, report-only, failed and unrelated rows', async () => {
    const f = await fixture(['synthetic', 'report-only', 'failed', 'unsupported', 'held']);
    const before = [...f.records.values()].map(row => structuredClone(row));
    const unrelated = { ...before[0], id: randomUUID() };
    f.records.set(unrelated.id, unrelated);
    await f.deploy();
    await reconcileDeployedBatchLifecycle(f.store, f.releaseId());
    expect(f.updates()).toBe(1);
    expect([...f.records.values()][0]).toMatchObject({ status: 'archived', triage_state: 'fixed_live',
      triage_live_evidence: { deployedCommit: f.candidate.head, deploymentId: 'dpl_Synthetic', result: 'passed' } });
    for (const row of before.slice(1)) expect(f.records.get(row.id)).toEqual(row);
    expect(f.records.get(unrelated.id)).toEqual(unrelated);
    expect(f.live()).toMatchObject({ state: 'blocked', reason: 'live-verification-required',
      planApplied: true, verifiedRows: 1, remainingRows: 1 });
    const projection = publicQueueState(f.store.state).jobs.find(job => job.id === f.id)!;
    expect(projection.batch?.live).toEqual({ state: 'blocked', reason: 'live-verification-required', verifiedRows: 1, remainingRows: 1 });
    expect(JSON.stringify(projection)).not.toContain('fixerrorsLifecycleReceipts');
    expect(JSON.stringify(projection)).not.toContain('Synthetic private row');
    expect(readLifecycle([...f.records.values()][0])?.history).toHaveLength(2);
    expect(f.store.events.at(-1)).toMatchObject({ actor: deviceId, event: 'batch-live-reconciled' });
  });

  it('does not treat deployment as original-error verification for an unsupported source', async () => {
    const f = await fixture(['unsupported']);
    await f.deploy();
    await reconcileDeployedBatchLifecycle(f.store, f.releaseId());
    expect(f.live()).toMatchObject({ state: 'blocked', reason: 'live-verification-required',
      plan: null, planApplied: false, verifiedRows: 0, remainingRows: 1 });
    expect(f.updates()).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    await reconcileDeviceDeployments(f.store, deviceId);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['server', 'identity', 'candidate', 'checks', 'source', 'tests', 'local-receipt', 'diagnostics', 'schema'] as const)(
    'keeps incidents outstanding on %s mismatch', async mismatch => {
      const f = await fixture();
      await f.deploy();
      if (mismatch === 'server') vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'f'.repeat(40));
      if (mismatch === 'identity') vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        commit_sha: 'f'.repeat(40), deployment_id: 'dpl_Synthetic',
      }))));
      if (mismatch === 'candidate') f.store.state.jobs[1].approval!.candidate.head = 'f'.repeat(40);
      if (mismatch === 'checks') f.store.state.jobs[1].checks!.checks[0].outputSha256 = 'f'.repeat(64);
      if (mismatch === 'source') [...f.records.values()][0].error_stack = 'at unrelated (./lib/utils/other.ts:1:1)';
      if (mismatch === 'tests') {
        const parent = f.store.state.jobs[0];
        parent.privateBatch!.outcome!.clusters[0].tests = [];
      }
      if (mismatch === 'local-receipt') f.store.state.jobs[0].privateBatch!.lifecycle!.receipts = {};
      if (mismatch === 'diagnostics') [...f.records.values()][0].error_message = 'Changed synthetic diagnostics';
      if (mismatch === 'schema') f.unsafeSchema();
      await reconcileDeployedBatchLifecycle(f.store, f.id);
      expect(f.updates()).toBe(0);
      expect([...f.records.values()][0]).toMatchObject({ status: 'active', triage_state: 'outstanding' });
      expect(f.live()?.state).toBe('blocked');
      if (mismatch === 'server') expect(f.live()?.reason).toBe('server-revision-mismatch');
      if (mismatch === 'identity') expect(f.live()?.reason).toBe('deployment-identity-mismatch');
    });

  it('retries stale-server refusal on an authenticated heartbeat and ignores duplicate reconciliation receipts', async () => {
    const f = await fixture();
    await f.deploy();
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'f'.repeat(40));
    await reconcileDeployedBatchLifecycle(f.store, f.releaseId());
    expect(f.live()?.state).toBe('blocked');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', f.candidate.head);
    await reconcileDeviceDeployments(f.store, deviceId);
    expect(f.live()).toMatchObject({ state: 'applied', verifiedRows: 1, remainingRows: 0 });
    const planHash = hashLifecycleRecord(f.live()!.plan);
    expect(await f.send({ op: 'batch-reconcile', jobId: f.id })).toMatchObject({
      completion: { job: { id: f.releaseId(), state: 'deployed' }, outcomeSha256: batchOutcomeHash(f.outcome) },
    });
    await reconcileDeployedBatchLifecycle(f.store, f.id);
    await reconcileDeviceDeployments(f.store, deviceId);
    expect(f.updates()).toBe(1);
    expect(hashLifecycleRecord(f.live()!.plan)).toBe(planHash);
  });

  it.each(['pre-receipt', 'commit', 'post-receipt'])('recovers %s failure using the identical durable plan', async failure => {
    const f = await fixture();
    await f.deploy();
    if (failure === 'commit') f.loseCommit();
    else {
      const transact = f.store.transact.bind(f.store);
      let failed = false;
      vi.spyOn(f.store, 'transact').mockImplementation(work => transact(tx => {
        const result = work(tx);
        const receipts = tx.state.jobs[0].privateBatch!.deployment?.receipts;
        if (!failed && Object.keys(receipts ?? {}).some(file => file.endsWith(
          failure === 'pre-receipt' ? '.pre.json' : '.post.json'))) {
          failed = true;
          throw new Error('Synthetic queue persistence failure');
        }
        return result;
      }));
    }
    await reconcileDeployedBatchLifecycle(f.store, f.releaseId());
    expect(f.live()).toMatchObject({ state: 'blocked', planApplied: false,
      reason: failure === 'pre-receipt' ? 'unavailable' : 'uncertain' });
    const hash = hashLifecycleRecord(f.live()!.plan);
    const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) :
      value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, reorder(item)])) : value;
    f.store.state.jobs[0].privateBatch = parseCapturedBatch(reorder(f.store.state.jobs[0].privateBatch), f.id);
    expect(hashLifecycleRecord(f.live()!.plan)).toBe(hash);
    // An already-committed plan can be acknowledged even after its expiry.
    if (failure !== 'pre-receipt') vi.setSystemTime(now + 31 * 60_000);
    await reconcileDeployedBatchLifecycle(f.store, f.id);
    expect(f.live()).toMatchObject({ state: 'applied', planApplied: true, verifiedRows: 1 });
    expect(hashLifecycleRecord(f.live()!.plan)).toBe(hash);
    expect(f.updates()).toBe(1);
    expect(Object.keys(f.live()!.receipts)).toHaveLength(2);
  });

  it('does not rebuild an expired unapplied plan or close its incident on a later retry', async () => {
    const f = await fixture();
    await f.deploy();
    const transact = f.store.transact.bind(f.store);
    let failed = false;
    vi.spyOn(f.store, 'transact').mockImplementation(work => transact(tx => {
      const result = work(tx);
      if (!failed && Object.keys(tx.state.jobs[0].privateBatch!.deployment?.receipts ?? {}).length) {
        failed = true;
        throw new Error('Synthetic queue pre-receipt failure');
      }
      return result;
    }));
    await reconcileDeployedBatchLifecycle(f.store, f.releaseId());
    const hash = hashLifecycleRecord(f.live()!.plan);
    vi.setSystemTime(now + 31 * 60_000);
    await reconcileDeployedBatchLifecycle(f.store, f.id);
    expect(f.live()).toMatchObject({ state: 'blocked', reason: 'expired', planApplied: false, verifiedRows: 0 });
    expect(f.updates()).toBe(0);
    expect(hashLifecycleRecord(f.live()!.plan)).toBe(hash);
    expect([...f.records.values()][0]).toMatchObject({ status: 'active', triage_state: 'outstanding' });
  });
});
