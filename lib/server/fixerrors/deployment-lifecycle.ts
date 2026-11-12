import 'server-only';
import { batchOutcomeHash, parseBatchBytes, validateBatchOutcome, type CapturedBatch } from '@/lib/fixerrors/batch';
import { checkEvidenceDigest, type QueueStore } from '@/lib/fixerrors/control';
import { sameCandidate, type FixerrorsJob } from '@/lib/fixerrors/protocol';
import { parseStackTrace } from '@/lib/fixerrors/stack';
import {
  applyLifecyclePlan, fetchLifecycleRecords, hasAppliedLifecycleReceipt, hashLifecycleRecord,
  makeLifecyclePlan, readLifecycle, reviewLifecycleRow,
} from '@/scripts/fixerrors-lifecycle';
import { lifecycleBlocker, reconcileBatchLifecycle } from './batch-lifecycle';
import { withFixerrorsApplicationDatabase } from './evidence';
import {
  LiveVerificationError, SYNTHETIC_REPAIR_SOURCE, SYNTHETIC_REPAIR_TEST, verifySyntheticRepairLive,
} from './live-verification';

function deploymentBinding(parent: FixerrorsJob, release: FixerrorsJob): string {
  const batch = parent.privateBatch;
  if (parent.action !== 'repair' || parent.state !== 'tested' || release.action !== 'deploy' ||
      release.state !== 'deployed' || release.parentRepairId !== parent.id ||
      release.deviceId !== parent.deviceId || !parent.candidate || !release.candidate || !release.approval ||
      !sameCandidate(parent.candidate, release.candidate) || !sameCandidate(release.approval.candidate, release.candidate) ||
      !parent.checks?.release || !release.checks?.release ||
      parent.checks.head !== parent.candidate.head || parent.checks.tree !== parent.candidate.tree ||
      release.checks.head !== parent.candidate.head || release.checks.tree !== parent.candidate.tree ||
      checkEvidenceDigest(parent.checks) !== parent.candidate.checksSha256 ||
      checkEvidenceDigest(release.checks) !== parent.candidate.checksSha256 ||
      !batch?.outcome || batch.delivery.manifestSha256 !== parent.workspace.packetSha256 ||
      release.workspace.packetSha256 !== parent.workspace.packetSha256 ||
      release.workspace.head !== release.candidate.head || release.workspace.tree !== release.candidate.tree ||
      batch.lifecycle?.state !== 'applied' || !batch.lifecycle.plan ||
      !Object.keys(batch.lifecycle.receipts).some(file => file.endsWith('.post.json'))) {
    throw new Error('Deployment candidate or retained repair evidence conflict');
  }
  const outcome = validateBatchOutcome(batch, batch.outcome, parent.id, true);
  const localHash = hashLifecycleRecord(batch.lifecycle.plan);
  const localReceipt = Object.entries(batch.lifecycle.receipts).some(([file, contents]) => {
    if (!file.endsWith('.post.json')) return false;
    const post = JSON.parse(contents);
    const preContents = batch.lifecycle!.receipts[file.replace(/\.post\.json$/u, '.pre.json')];
    if (!preContents) return false;
    const pre = JSON.parse(preContents);
    return post.planHash === localHash && pre.planHash === localHash &&
      hashLifecycleRecord(pre.plan) === localHash && Number.isSafeInteger(post.updated) && post.updated >= 0 &&
      Number.isSafeInteger(post.alreadyApplied) && post.alreadyApplied >= 0 &&
      post.updated + post.alreadyApplied === batch.lifecycle!.plan!.rows.length;
  });
  if (outcome.candidate.baseHead !== parent.workspace.head ||
      parseBatchBytes(Buffer.from(batch.manifest)).retrieval.baseHead !== parent.workspace.head ||
      batch.lifecycle.plan.databaseTargetFingerprint !== batch.target || !localReceipt) {
    throw new Error('Deployment outcome candidate conflict');
  }
  return batchOutcomeHash({
    releaseId: release.id, approval: release.approval, candidate: parent.candidate, checks: parent.checks,
    base: parent.workspace, prepared: release.workspace,
    manifest: batch.delivery.manifestSha256, outcome, localPlan: batch.lifecycle.plan,
  });
}

function supportedRows(batch: CapturedBatch) {
  const retrieval = parseBatchBytes(Buffer.from(batch.manifest)).retrieval;
  const repaired = batch.outcome!.clusters.filter(outcome => outcome.status === 'verified-local');
  const supported: string[] = [];
  let total = 0;
  for (const outcome of repaired) {
    const cluster = retrieval.clusters.find(entry => entry.id === outcome.id)!;
    const decision = batch.outcome!.decisions.find(entry => entry.id === outcome.id);
    const binding = batch.bindings.find(entry => entry.clusterId === outcome.id);
    if (!binding) throw new Error('Deployment captured row coverage conflict');
    total += binding.records.length;
    if (cluster.held || outcome.reusedFrom || cluster.query.sourceFile !== SYNTHETIC_REPAIR_SOURCE ||
        !cluster.sourceFiles.includes(SYNTHETIC_REPAIR_SOURCE) ||
        !decision?.files.includes(SYNTHETIC_REPAIR_SOURCE) ||
        !decision.requiredTestIds.includes(SYNTHETIC_REPAIR_TEST) || !outcome.tests.includes(SYNTHETIC_REPAIR_TEST)) continue;
    for (const record of binding.records) {
      const frames = parseStackTrace(typeof record.error_stack === 'string' ? record.error_stack : null);
      if (frames[0]?.file === SYNTHETIC_REPAIR_SOURCE) supported.push(record.id);
    }
  }
  return { supported, total };
}

function publishLive(parent: FixerrorsJob) {
  const live = parent.privateBatch?.deployment;
  if (parent.batch && live) {
    parent.batch.live = { state: live.state, reason: live.reason,
      verifiedRows: live.verifiedRows, remainingRows: live.remainingRows };
  }
}

// Deployment acknowledgement is not incident resolution. This second immutable
// exact-row plan reuses the original plan's database receipts and trigger guards.
export async function reconcileDeployedBatchLifecycle(store: QueueStore, jobId: string) {
  const saved = await store.transact(({ state }) => {
    const job = state.jobs.find(entry => entry.id === jobId);
    const parent = job?.parentRepairId ? state.jobs.find(entry => entry.id === job.parentRepairId) : job;
    const release = state.jobs.find(entry => entry.parentRepairId === parent?.id && entry.state === 'deployed');
    if (!parent?.privateBatch?.outcome || !release) return null;
    return { parent: structuredClone(parent), release: structuredClone(release) };
  });
  if (!saved) return;
  const parentId = saved.parent.id;
  let bindingSha256: string | undefined;
  try {
    if (await reconcileBatchLifecycle(store, parentId) !== 'applied') return;
    // Reread after the local lifecycle's own acknowledgement recovery.
    const current = await store.transact(({ state }) => structuredClone(state.jobs.find(entry => entry.id === parentId)!));
    bindingSha256 = deploymentBinding(current, saved.release);
    const batch = current.privateBatch!;
    const { supported, total } = supportedRows(batch);
    if (batch.deployment && (batch.deployment.bindingSha256 !== bindingSha256 ||
        batch.deployment.releaseJobId !== saved.release.id)) throw new Error('Retained deployment binding conflict');
    if (batch.deployment?.planApplied) return;
    await store.transact(({ state }) => {
      const parent = state.jobs.find(entry => entry.id === parentId)!;
      parent.privateBatch!.deployment ??= {
        state: 'pending', releaseJobId: saved.release.id, bindingSha256: bindingSha256!,
        verifiedRows: 0, remainingRows: total, plan: null, planApplied: false, receipts: {},
      };
      publishLive(parent);
    });
    if (!supported.length) {
      await store.transact(({ state }) => {
        const parent = state.jobs.find(entry => entry.id === parentId)!;
        Object.assign(parent.privateBatch!.deployment!, { state: 'blocked', reason: 'live-verification-required' });
        publishLive(parent);
      });
      return;
    }
    const live = await verifySyntheticRepairLive(current.candidate!.head);
    let plan = batch.deployment?.plan;
    if (!plan) {
      const localPlan = batch.lifecycle!.plan!;
      const rows = await withFixerrorsApplicationDatabase(async (client, target) => {
        if (target !== batch.target) throw new Error('Deployment database target conflict');
        return fetchLifecycleRecords(client, supported);
      });
      if (rows.length !== supported.length || new Set(rows.map(row => row.id)).size !== supported.length ||
          rows.some(row => !supported.includes(row.id))) throw new Error('Deployment exact row coverage conflict');
      plan = makeLifecyclePlan(batch.target, rows.map(record => {
        const local = localPlan.rows.find(row => row.id === record.id);
        const metadata = readLifecycle(record);
        const attempt = metadata?.history.at(-1);
        if (!local || !hasAppliedLifecycleReceipt(record, local, hashLifecycleRecord(localPlan)) ||
            metadata?.state !== 'awaiting-deployment' || record.status !== 'active' ||
            record.triage_state !== 'outstanding' || attempt?.result !== 'verified-local' ||
            !attempt.tests.includes(SYNTHETIC_REPAIR_TEST) || !attempt.verifiedCandidate ||
            batchOutcomeHash(attempt.verifiedCandidate) !== batchOutcomeHash(batch.outcome!.candidate)) {
          throw new Error('Deployment local repair receipt or row state conflict');
        }
        return reviewLifecycleRow(record, {
          fingerprint: metadata.fingerprint, state: 'fixed-live', nextStep: null, liveEvidence: live,
          attempt: {
            id: `fixerrors-${saved.release.id}-live`, reviewedAt: live.verifiedAt,
            diagnosis: 'Synthetic label repair verified on the exact approved live deployment',
            attempt: 'Executed fixed synthetic label cases on the deployed server revision and verified live deployment identity',
            tests: [SYNTHETIC_REPAIR_TEST], result: 'verified-live',
            evidence: [live.check, 'Candidate-bound targeted-tests, typecheck and lint evidence verified'],
          },
        });
      }));
      plan = await store.transact(({ state }) => {
        const parent = state.jobs.find(entry => entry.id === parentId)!;
        const release = state.jobs.find(entry => entry.id === saved.release.id)!;
        if (deploymentBinding(parent, release) !== bindingSha256) throw new Error('Deployment candidate binding conflict');
        const retained = parent.privateBatch!.deployment!;
        retained.plan ??= plan!;
        return structuredClone(retained.plan);
      });
    }
    const retainedPlan = plan;
    await withFixerrorsApplicationDatabase(async (client, target) => {
      await applyLifecyclePlan(client, retainedPlan, target, {
        writer: async (file, contents) => {
          if (JSON.parse(contents).planHash !== hashLifecycleRecord(retainedPlan)) throw new Error('Deployment receipt binding conflict');
          await store.transact(({ state }) => {
            const parent = state.jobs.find(entry => entry.id === parentId)!;
            const release = state.jobs.find(entry => entry.id === saved.release.id)!;
            const retained = parent.privateBatch!.deployment!;
            if (deploymentBinding(parent, release) !== bindingSha256 ||
                hashLifecycleRecord(retained.plan) !== hashLifecycleRecord(retainedPlan)) {
              throw new Error('Retained deployment plan conflict');
            }
            retained.receipts[file] = contents;
          });
        },
      });
    });
    await store.transact(({ state, audit }) => {
      const parent = state.jobs.find(entry => entry.id === parentId)!;
      const release = state.jobs.find(entry => entry.id === saved.release.id)!;
      const retained = parent.privateBatch!.deployment!;
      if (deploymentBinding(parent, release) !== bindingSha256 ||
          hashLifecycleRecord(retained.plan) !== hashLifecycleRecord(retainedPlan)) throw new Error('Retained deployment plan conflict');
      retained.planApplied = true;
      retained.verifiedRows = retainedPlan.rows.length;
      retained.remainingRows = total - retained.verifiedRows;
      retained.state = retained.remainingRows ? 'blocked' : 'applied';
      retained.reason = retained.remainingRows ? 'live-verification-required' : undefined;
      publishLive(parent);
      audit({ at: Date.now(), actor: parent.deviceId, event: 'batch-live-reconciled', jobId: parentId, deviceId: parent.deviceId });
    });
  } catch (error) {
    const reason = error instanceof LiveVerificationError ? error.reason : lifecycleBlocker(error);
    console.error(`Fixerrors deployed incident reconciliation blocked: ${reason}; exact evidence retained.`);
    await store.transact(({ state, audit }) => {
      const parent = state.jobs.find(entry => entry.id === parentId)!;
      const batch = parent.privateBatch!;
      batch.deployment ??= {
        releaseJobId: saved.release.id, bindingSha256: bindingSha256 ?? '0'.repeat(64),
        plan: null, planApplied: false, receipts: {}, state: 'blocked', verifiedRows: 0,
        remainingRows: batch.bindings.filter(binding => batch.outcome!.clusters.some(outcome =>
          outcome.id === binding.clusterId && outcome.status === 'verified-local')).reduce((sum, binding) => sum + binding.records.length, 0),
      };
      if (!batch.deployment.planApplied) Object.assign(batch.deployment, { state: 'blocked', reason });
      publishLive(parent);
      audit({ at: Date.now(), actor: parent.deviceId, event: 'batch-live-blocked', jobId: parentId, deviceId: parent.deviceId });
    });
  }
}

export async function reconcileDeviceDeployments(store: QueueStore, deviceId: string) {
  const servingHead = process.env.VERCEL_GIT_COMMIT_SHA;
  if (!servingHead || !/^[a-f0-9]{40}$/u.test(servingHead)) return;
  const jobId = await store.transact(({ state }) => [...state.jobs].sort((a, b) => b.createdAt - a.createdAt).find(release => {
    if (release.deviceId !== deviceId || release.state !== 'deployed' || !release.parentRepairId) return false;
    // This runtime can verify only its own revision. Old deployments must not
    // monopolize retries after a new release or a lost completion response.
    if (release.candidate?.head !== servingHead) return false;
    const batch = state.jobs.find(parent => parent.id === release.parentRepairId)?.privateBatch;
    return batch?.outcome && !batch.deployment?.planApplied &&
      batch.deployment?.reason !== 'live-verification-required';
  })?.id);
  if (jobId) await reconcileDeployedBatchLifecycle(store, jobId);
}
