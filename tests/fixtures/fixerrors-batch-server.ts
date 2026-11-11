import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { writeSync } from 'node:fs';
import { buildFixerrorsBatchRetrieval, fetchFixerrorsBatchSnapshot } from '../../scripts/fixerrors-capture';
import type { LifecycleRecord } from '../../scripts/fixerrors-lifecycle';
import type { PgClientLike } from '../../scripts/fixerrors-safety';
import { describeBatch, signBatchLease, batchOutcomeHash } from '../../lib/fixerrors/batch';
import { applyAdminCommand, applyDeviceCommand, hash, type QueueStore } from '../../lib/fixerrors/control';
import { issueClaimedFixerrorsAdmission } from '../../lib/fixerrors/admission';
import { deviceCommandSchema, deviceResponseSchema, queueStateSchema, type DeviceCommand, type QueueState } from '../../lib/fixerrors/protocol';
import { receiveCompanionBatch } from '../../scripts/automation/fixerrors-companion';
import { prepareProductionBatchProof, type ProductionBridgeEnrollment } from '../../scripts/automation/fixerrors-production-bridge';
import { nativeBatchLineReader } from '../../scripts/automation/fixerrors-batch-engine';

async function main() {
  const line = nativeBatchLineReader();
  const input = line() as {
    root: string; head: string; tree: string; fingerprint: string; jobId: string; deviceId: string;
    issuer: string; device: string;
  };
  const issuer = createPrivateKey(input.issuer);
  const device = createPrivateKey(input.device);
  const release = generateKeyPairSync('ed25519').publicKey;
  const now = new Date();
  const rows: LifecycleRecord[] = Array.from({ length: 281 }, (_, index) => {
    const group = index < 120 ? 0 : index < 240 ? 1 : index < 280 ? 2 : 3;
    const source = group < 2 ? 'lib/utils/display-label.ts' : 'lib/utils/second-label.ts';
    const timestamp = new Date(now.getTime() - index - 1).toISOString().replace(/Z$/u, '000Z');
    return {
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      created_at: timestamp, timestamp, status: 'active', triage_state: index === 280 ? 'outstanding' : null,
      triage_local_commit: null, error_type: 'Error',
      error_message: ['Permission label failure', 'Synthetic first label failure',
        'Synthetic second label failure', 'Database label failure'][group],
      error_stack: Array.from({ length: 24 }, (_, offset) =>
        `at label (/app/${source}:${index * 24 + offset + 1}:1)`).join('\n'),
      component_name: 'Label', page_url: 'https://example.invalid/dashboard',
      user_id: null, user_email: null, user_agent: 'Synthetic fixture', additional_data: {},
    };
  }).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  let pages = 0;
  const client: PgClientLike = {
    async query<T extends Record<string, unknown>>(text: string, values: unknown[] = []) {
      const fresh = rows.filter(row => row.triage_state === null);
      let result: Record<string, unknown>[] = [];
      const compare = (row: LifecycleRecord, at: unknown, id: unknown) =>
        String(row.created_at).localeCompare(String(at)) || row.id.localeCompare(String(id));
      if (text.includes('fixerrors:transaction-time')) result = [{ transaction_started_at: now }];
      if (text.includes('fixerrors:snapshot-boundary')) {
        const last = fresh.at(-1)!;
        result = [{ id: last.id, created_at: last.created_at }];
      }
      if (text.includes('fixerrors:snapshot-count')) result = [{ count: String(fresh.length) }];
      if (text.includes('fixerrors:snapshot-page')) result = fresh.filter(row =>
        values[2] === null || compare(row, values[2], values[3]) > 0).slice(0, Number(values[4]));
      if (text.includes('fixerrors:batch-count')) result = [{ count: String(rows.length) }];
      if (text.includes('fixerrors:batch-page')) {
        pages++;
        result = rows.filter(row => values[0] === null || compare(row, values[0], values[1]) > 0)
          .slice(0, Number(values[2])).map(record => ({ record, id: record.id, created_at: record.created_at }));
      }
      return { rows: result as T[], rowCount: result.length };
    },
  };
  const captured = await fetchFixerrorsBatchSnapshot(client, 'c'.repeat(64), now);
  const built = buildFixerrorsBatchRetrieval({
    ...captured, candidate: { baseHead: input.head, treeFingerprint: input.fingerprint },
    knowledge: { version: 1, incidents: [] }, repoRoot: input.root,
  });
  const manifest = JSON.stringify({ schemaVersion: 1, snapshotChecksum: captured.snapshot.checksum, retrieval: built.retrieval });
  const delivery = describeBatch(manifest, rows.length);
  if (pages < 2 || delivery.bytes <= 96 * 1024 || delivery.clusters !== 4 ||
      built.retrieval.clusters[0].advisoryLane !== 'critical' || built.retrieval.clusters[3].advisoryLane !== 'critical') {
    throw new Error(`Integrated capture coverage changed: ${JSON.stringify({ pages, delivery })}`);
  }
  let state: QueueState = { version: 1, jobs: [], devices: [{
    id: input.deviceId, name: 'Synthetic fixture', credentialSha256: hash('x'.repeat(43)),
    revoked: false, lastSeenAt: Date.now(), workspace: null,
    checkout: { head: input.head, tree: input.tree, clean: true },
    allowReadOnly: true, allowRepair: true, allowDeploy: false, bridgeAvailable: true,
  }] };
  const store: QueueStore = { async transact(work) {
    const next = structuredClone(state);
    const result = work({ state: next, audit: () => {} });
    state = queueStateSchema.parse(next);
    return result;
  } };
  await store.transact(tx => applyAdminCommand(tx, input.deviceId, {
    op: 'enqueue', action: 'repair', requestId: input.jobId, deviceId: input.deviceId,
  }, Date.now(), { checkout: state.devices[0].checkout!, packet: null, batch: {
    manifest, target: 'c'.repeat(64), bindings: built.bindings, suppressed: built.suppressed, delivery, sequence: 0,
  } }));
  const request = async (command: DeviceCommand) => deviceResponseSchema.parse(await store.transact(tx =>
    applyDeviceCommand(tx, input.deviceId, 'x'.repeat(43), command, Date.now(), undefined,
      (job, at) => issueClaimedFixerrorsAdmission(job, at, {
        keyId: 'squires-repair-v1', privateKey: issuer, releaseKeyId: 'squires-release-v1', releasePublicKey: release,
      }), (job, checkpoint, at) => signBatchLease({
        runId: job.id, deviceId: input.deviceId, manifestSha256: job.workspace.packetSha256,
        checkpointSha256: checkpoint.checkpointSha256, sequence: job.privateBatch!.sequence + 1,
        resume: checkpoint.resume,
      }, at, 'squires-repair-v1', issuer))));
  let claim = (await request({ op: 'claim' })).claim!;
  const bytes = await receiveCompanionBatch(claim, request);
  const enrollment: ProductionBridgeEnrollment = {
    deviceId: input.deviceId, credential: 'x'.repeat(43), pythonExe: 'C:\\fixture\\python.exe',
    devicePrivateKeyPem: device.export({ format: 'pem', type: 'pkcs8' }).toString(),
    repairPublicKeyPem: createPublicKey(issuer).export({ format: 'pem', type: 'spki' }).toString(),
    releasePublicKeyPem: release.export({ format: 'pem', type: 'spki' }).toString(),
    bridgeHashes: ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64)],
  };
  const proof = () => prepareProductionBatchProof(claim.admissionTicket!, bytes, claim.job, enrollment,
    Math.floor(Date.now() / 1000)).toString();
  writeSync(1, `${JSON.stringify({ manifest, ticket: claim.admissionTicket, proof: proof(), pages,
    rows: delivery.rows, bytes: delivery.bytes, newRows: captured.records.captured.length,
    heldRows: captured.records.held.length })}\n`);
  for (;;) {
    const message = line() as { op: string; value: unknown };
    await request({ op: 'heartbeat', workspace: null, checkout: null, holdReason: 'packet-needs-reconciliation',
      allowReadOnly: true, allowRepair: true, allowDeploy: false, bridgeAvailable: true });
    if (message.op === 'heartbeat') {
      await request({ op: 'renew', jobId: input.jobId, leaseToken: claim.leaseToken });
      writeSync(1, '{}\n');
    } else if (message.op === 'lease') {
      const value = message.value as { checkpointSha256: string; cursor: number; resume: boolean;
        outcome: { clusters: { id: string }[]; decisions: { id: string }[] } | null };
      const outcome = value.outcome?.clusters.length ? {
        ...value.outcome, clusters: value.outcome.clusters.slice(-1),
        decisions: value.outcome.decisions.filter(entry => entry.id === value.outcome!.clusters.at(-1)!.id),
      } : value.outcome;
      const result = await request({ op: 'batch-lease', jobId: input.jobId, leaseToken: claim.leaseToken,
        checkpointSha256: value.checkpointSha256, cursor: value.cursor, resume: value.resume, outcome });
      writeSync(1, `${JSON.stringify({ lease: result.batchLease })}\n`);
    } else if (message.op === 'pause') {
      await request({ op: 'pause-batch', jobId: input.jobId, leaseToken: claim.leaseToken,
        checkpointSha256: String(message.value) });
      await request({ op: 'heartbeat', checkout: null, workspace: null, holdReason: 'packet-needs-reconciliation',
        allowReadOnly: true, allowRepair: true, allowDeploy: false, bridgeAvailable: true });
      claim = (await request({ op: 'claim' })).claim!;
      if (!claim.resume) throw new Error('Connected checkpoint resume missing');
      writeSync(1, `${JSON.stringify({ ticket: claim.admissionTicket, proof: proof() })}\n`);
    } else if (message.op === 'complete') {
      const value = message.value as { result: unknown; outcomeSha256: string };
      const command = deviceCommandSchema.parse({ op: 'complete', jobId: input.jobId, leaseToken: claim.leaseToken,
        result: value.result, outcomeSha256: value.outcomeSha256 });
      await request(command);
      const batch = state.jobs[0].privateBatch!;
      if (batchOutcomeHash(batch.outcome) !== value.outcomeSha256) throw new Error('Cross-language outcome hash changed');
      writeSync(1, `${JSON.stringify({ state: state.jobs[0].state, processed: state.jobs[0].batch?.processed,
        planRows: batch.bindings.flatMap(binding => binding.records).length })}\n`);
      return;
    } else throw new Error('Unknown fixture command');
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
