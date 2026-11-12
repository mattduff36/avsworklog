import { randomUUID } from 'node:crypto';
import {
  applyAdminCommand, applyDeviceCommand, checkEvidenceDigest, fulfillPreapprovedDeploy,
} from '@/lib/fixerrors/control';
import { deviceResponseSchema, type DeviceCommand, type ReleaseMode } from '@/lib/fixerrors/protocol';
import { batchOutcomeHash } from '@/lib/fixerrors/batch';
import { capturedBatch } from './fixerrors-batch-fixtures';
import { actorId, checks, credential, deviceId, FixtureStore, now, workspace } from './fixerrors-control-fixtures';

// Synthetic native result/check hashes, not evidence of a real worker or release.
export async function preapprovedFixture(mode: ReleaseMode = 'targeted', count = 1) {
  const store = new FixtureStore();
  const id = randomUUID();
  const batch = capturedBatch(id, count);
  let time = now;
  const evidence = {
    ...structuredClone(checks), release: { candidateSha256: '4'.repeat(64), testEvidenceSha256: '5'.repeat(64) },
  };
  const candidate = { head: evidence.head, tree: evidence.tree, checksSha256: checkEvidenceDigest(evidence) };
  await store.transact(tx => applyAdminCommand(tx, actorId, {
    op: 'enqueue', action: 'repair', deviceId, requestId: id,
    requestedReleaseMode: mode, autoDeployConfirmation: true,
  }, time, { checkout: workspace, packet: null, batch }));
  const send = (command: DeviceCommand) => store.transact(tx =>
    applyDeviceCommand(tx, deviceId, credential, command, time));
  const claimed = deviceResponseSchema.parse(await send({ op: 'claim' })).claim!;
  const outcome = {
    runId: `fixerrors-${id}`, candidate: { baseHead: workspace.head, treeFingerprint: 'b'.repeat(64) },
    clusters: Array.from({ length: count }, (_, index) => ({
      id: `cluster-${index + 1}`, status: 'verified-local' as const, reason: 'Synthetic repaired label',
      attempt: 'Synthetic source repair', tests: ['tests/unit/display-label.test.ts'], evidence: ['Synthetic receipts'],
    })),
    decisions: Array.from({ length: count }, (_, index) => ({
      id: `cluster-${index + 1}`, lane: 'fast' as const, action: 'fix' as const, disposition: 'outstanding' as const,
      nextStep: 'Repair synthetic label', evidencePaths: ['lib/utils/display-label.ts'],
      files: ['lib/utils/display-label.ts', 'tests/unit/display-label.test.ts'],
      requiredTestIds: ['tests/unit/display-label.test.ts'],
      forbiddenChanges: ['suppress-logging', 'empty-success', 'weaken-authorization'],
      rationale: 'Synthetic label regression', priorIncidentIds: [], evidenceEnrichmentAttempted: true,
    })),
  };
  const complete = async () => {
    // The ordinary batch protocol normally supplies this prefix through signed leases.
    store.state.jobs[0].privateBatch!.checkpoint = { cursor: count, checkpointSha256: '6'.repeat(64), outcome, resume: false };
    await send({ op: 'complete', jobId: id, leaseToken: claimed.leaseToken,
      result: { status: 'tested', candidate, checks: evidence }, outcomeSha256: batchOutcomeHash(outcome) });
  };
  const lifecycle = () => {
    const job = store.state.jobs[0];
    job.privateBatch!.lifecycle = { state: 'applied', plan: null, receipts: {} };
    job.batch!.lifecycle = 'applied';
  };
  const heartbeat = async () => {
    time++;
    await send({ op: 'heartbeat', workspace: { ...workspace, packetSha256: batch.delivery.manifestSha256,
      head: candidate.head, tree: candidate.tree },
      checkout: { head: candidate.head, tree: candidate.tree, clean: true },
      holdReason: 'prepared-candidate', allowReadOnly: true, allowRepair: true, allowDeploy: true, bridgeAvailable: true });
  };
  const fulfill = (authorized = true) => store.transact(tx => fulfillPreapprovedDeploy(tx, id, authorized, time));
  const ready = async () => { await complete(); lifecycle(); await heartbeat(); };
  return { store, id, candidate, evidence, claimed, send, complete, lifecycle, heartbeat, fulfill, ready,
    advance: (ms: number) => { time += ms; }, time: () => time };
}
