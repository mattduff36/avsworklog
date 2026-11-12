import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readSync, realpathSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { FIXERRORS_COMPANION_PACKET_MAX_BYTES } from '../../lib/fixerrors/admission';
import { candidateSchema, deviceResponseSchema, resultSchema, sameCandidate, type Checkout, type ClaimedJob, type DeviceCommand, type ExecutionResult } from '../../lib/fixerrors/protocol';
import { batchOutcomeHash, parseBatchBytes } from '../../lib/fixerrors/batch';
import { encodePreparedReleaseEvidence, preparedReleaseEvidenceSchema } from '../../lib/fixerrors/release';
import { encodeCompanionPacket, parseCompanionPacket } from './fixerrors-companion-packet';
import { prepareProductionRepairProof, type ProductionBridgeEnrollment } from './fixerrors-production-bridge';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const batchDigest = z.string().regex(/^[a-f0-9]{64}$/u);
const nativeSnapshot = z.object({
  head: z.string(), branch: z.string(), index_sha256: batchDigest, status: z.string(),
  files: z.record(z.string(), z.string()), candidate_sha256: batchDigest,
}).strict();
const batchJournalSchema = z.object({
  version: z.literal(1), manifestSha256: batchDigest, codeSha256: batchDigest, admissionSha256: batchDigest,
  phase: z.enum(['checkpoint', 'inflight', 'preparing', 'completed']), sequence: z.number().int(),
  initial: nativeSnapshot,
  records: z.array(z.object({
    taskId: z.string(), readonly: z.boolean(), clusterId: z.string(),
    artifacts: z.record(z.string(), batchDigest), decisionSha256: batchDigest.optional(),
  }).strict()),
  checkpoint: z.object({
    cursor: z.number().int().nonnegative(), outcome: z.unknown(), snapshot: nativeSnapshot, recordsSha256: batchDigest,
  }).strict(),
  result: z.unknown().optional(),
}).strict();
const journalSchema = z.object({
  jobId: z.string().uuid(), action: z.enum(['review', 'repair']),
  packetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  head: z.string().regex(/^[a-f0-9]{40}$/u), tree: z.string().regex(/^[a-f0-9]{40}$/u),
  batch: batchJournalSchema.optional(),
}).strict();
const receiptSchema = z.object({
  jobId: z.string().uuid(), packetJobId: z.string().uuid(),
  packetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  status: z.enum(['reviewed', 'no-change', 'tested', 'blocked', 'failed', 'deployed', 'unknown']),
  candidate: candidateSchema.optional(),
  preparedSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
}).strict();

function ordinaryDirectory(directory: string): void {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory) {
    throw new Error('Packet lifecycle directory is not ordinary');
  }
}

export function readLifecycleFile(file: string, max = FIXERRORS_COMPANION_PACKET_MAX_BYTES): Buffer {
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || realpathSync(file) !== file) {
    throw new Error('Packet lifecycle file is not ordinary');
  }
  const fd = openSync(file, 'r');
  try {
    const held = fstatSync(fd);
    if (held.dev !== before.dev || held.ino !== before.ino || held.size > max) throw new Error('Packet lifecycle identity changed');
    const bytes = Buffer.alloc(held.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, size);
      if (!count) break;
      size += count;
    }
    const after = fstatSync(fd);
    const latest = lstatSync(file);
    if (size > max || after.size !== size || after.nlink !== 1 ||
        latest.dev !== held.dev || latest.ino !== held.ino || latest.isSymbolicLink()) {
      throw new Error('Packet lifecycle file changed or too large');
    }
    return bytes.subarray(0, size);
  } finally { closeSync(fd); }
}

function exclusive(file: string, bytes: Buffer): void {
  const fd = openSync(file, 'wx', 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  if (!readLifecycleFile(file, Math.max(bytes.length, FIXERRORS_COMPANION_PACKET_MAX_BYTES)).equals(bytes)) throw new Error('Packet lifecycle writeback changed');
}

// Copy durably before removing the identity-checked original. Interrupted copies
// are resumed only when their exact bytes agree, never by overwriting evidence.
function archiveFile(source: string, target: string, expectedSha256: string, max = FIXERRORS_COMPANION_PACKET_MAX_BYTES): void {
  if (!existsSync(source)) {
    if (digest(readLifecycleFile(target, max)) !== expectedSha256) throw new Error('Packet archive digest changed');
    return;
  }
  const identity = lstatSync(source);
  const bytes = readLifecycleFile(source, max);
  if (digest(bytes) !== expectedSha256) throw new Error('Packet archive digest changed');
  if (existsSync(target)) {
    if (!readLifecycleFile(target, max).equals(bytes)) throw new Error('Packet archive conflict');
  } else exclusive(target, bytes);
  const latest = lstatSync(source);
  if (latest.dev !== identity.dev || latest.ino !== identity.ino || !readLifecycleFile(source, max).equals(bytes)) {
    throw new Error('Packet archive source changed');
  }
  unlinkSync(source);
}

function journalAt(directory: string) {
  return journalSchema.parse(JSON.parse(readLifecycleFile(path.join(directory, 'active-packet.json'), 16 * 1024 * 1024).toString('utf8')));
}

export function prepareClaimPacket(
  claim: ClaimedJob, enrollment: ProductionBridgeEnrollment, directory: string, inspect: () => Checkout | null,
): void {
  if (!claim.packet || !claim.admissionTicket || claim.job.action === 'deploy') throw new Error('Signed request packet required');
  const bytes = Buffer.from(claim.packet, 'utf8');
  // Authenticity precedes filesystem preparation; this is the same verifier as dispatch.
  prepareProductionRepairProof(claim.admissionTicket, bytes, claim.job, enrollment, Math.floor(Date.now() / 1000));
  const packet = parseCompanionPacket(bytes);
  const current = inspect();
  if (!current || current.head !== claim.job.workspace.head || current.tree !== claim.job.workspace.tree ||
      digest(bytes) !== claim.job.workspace.packetSha256 ||
      !encodeCompanionPacket(packet, {
        baseHead: current.head, treeFingerprint: createHash('sha256').update(`${current.tree}\n`).digest('hex'),
      }).equals(bytes)) throw new Error('Fresh packet or checkout changed');
  if (!existsSync(directory)) mkdirSync(directory);
  ordinaryDirectory(directory);
  for (const name of ['sanitized-packet.json', 'active-packet.json', 'prepared-release.json']) {
    if (existsSync(path.join(directory, name))) throw new Error('Existing packet requires reconciliation');
  }
  const journal = journalSchema.parse({
    jobId: claim.job.id, action: claim.job.action, packetSha256: digest(bytes),
    head: current.head, tree: current.tree,
  });
  exclusive(path.join(directory, 'active-packet.json'), Buffer.from(JSON.stringify(journal)));
  exclusive(path.join(directory, 'sanitized-packet.json'), bytes);
  const after = inspect();
  if (!after || after.head !== current.head || after.tree !== current.tree) throw new Error('Checkout changed during packet preparation');
}

// Invoke only after the authenticated completion transaction has committed.
export function recordPacketCompletion(directory: string, claim: Pick<ClaimedJob, 'job'>, result: ExecutionResult): void {
  resultSchema.parse(result);
  ordinaryDirectory(directory);
  const journal = journalAt(directory);
  if (journal.batch) {
    const native = journal.batch.result as Record<string, unknown> | undefined;
    if (journal.batch.phase !== 'completed' || !native ||
        (claim.job.action !== 'deploy' && JSON.stringify(Object.fromEntries(
          Object.entries(native).filter(([key]) => key !== 'batch'))) !== JSON.stringify(result))) {
      throw new Error('Native batch completion is not confirmed');
    }
  }
  if (journal.packetSha256 !== claim.job.workspace.packetSha256 ||
      (claim.job.action === 'deploy' ? claim.job.parentRepairId !== journal.jobId
        : claim.job.id !== journal.jobId || claim.job.action !== journal.action) ||
      (result.status === 'reviewed' && claim.job.action !== 'review') ||
      (result.status === 'tested' && claim.job.action !== 'repair') ||
      ((result.status === 'deployed' || result.status === 'unknown') && claim.job.action !== 'deploy')) {
    throw new Error('Packet completion identity mismatch');
  }
  let preparedSha256: string | undefined;
  if (result.status === 'tested' && result.checks.release) {
    const bytes = readLifecycleFile(path.join(directory, 'prepared-release.json'), 16_384);
    const prepared = z.object({ candidate: candidateSchema, evidence: preparedReleaseEvidenceSchema }).strict()
      .parse(JSON.parse(bytes.toString('utf8')));
    if (!sameCandidate(prepared.candidate, result.candidate) || prepared.evidence.repairJobId !== journal.jobId ||
        prepared.evidence.head !== result.candidate.head || prepared.evidence.tree !== result.candidate.tree ||
        prepared.evidence.candidateSha256 !== result.checks.release.candidateSha256 ||
        digest(Buffer.from(encodePreparedReleaseEvidence(prepared.evidence))) !== result.checks.release.testEvidenceSha256 ||
        !result.checks.checks.every(check => prepared.evidence.preparedChecks[check.id].sha256 === check.outputSha256)) {
      throw new Error('Prepared completion evidence mismatch');
    }
    preparedSha256 = digest(bytes);
  }
  const receipt = receiptSchema.parse({
    jobId: claim.job.id, packetJobId: journal.jobId, packetSha256: journal.packetSha256,
    status: result.status, ...('candidate' in result ? { candidate: result.candidate } : {}),
    ...(preparedSha256 ? { preparedSha256 } : {}),
  });
  const file = path.join(directory, `${journal.jobId}.${result.status === 'tested' ? 'tested' : 'terminal'}.json`);
  const bytes = Buffer.from(JSON.stringify(receipt));
  if (existsSync(file)) {
    if (!readLifecycleFile(file, 2048).equals(bytes)) throw new Error('Completion receipt changed');
  } else exclusive(file, bytes);
}

export function inspectBatchResume(directory: string): boolean {
  if (!existsSync(path.join(directory, 'active-packet.json'))) return false;
  const journal = journalAt(directory);
  return journal.batch?.phase === 'checkpoint' && !existsSync(path.join(directory, 'batch-executor.lock'));
}

export async function recoverBatchCompletion(
  directory: string, request: (command: DeviceCommand) => Promise<z.infer<typeof deviceResponseSchema>>,
): Promise<void> {
  if (!existsSync(path.join(directory, 'active-packet.json'))) return;
  const journal = journalAt(directory);
  if (journal.batch?.phase !== 'completed' || existsSync(path.join(directory, `${journal.jobId}.terminal.json`))) return;
  const response = await request({ op: 'batch-reconcile', jobId: journal.jobId });
  const completion = response.completion;
  if (response.lifecycle !== 'applied' || !completion ||
      completion.outcomeSha256 !== batchOutcomeHash(journal.batch.checkpoint.outcome)) {
    throw new Error('Batch completion or lifecycle requires reconciliation');
  }
  const job = completion.job;
  if ((job.id !== journal.jobId && job.parentRepairId !== journal.jobId) ||
      job.workspace.packetSha256 !== journal.packetSha256) throw new Error('Batch recovery identity changed');
  const result = job.state === 'tested' && job.candidate && job.checks
    ? { status: 'tested' as const, candidate: job.candidate, checks: job.checks }
    : job.state === 'deployed' && job.candidate ? { status: 'deployed' as const, candidate: job.candidate }
      : job.state === 'reviewed' || job.state === 'no-change' ? { status: job.state } : null;
  if (!result) throw new Error('Batch completion is not terminal');
  recordPacketCompletion(directory, { job }, result);
}

export function reconcilePacketLifecycle(
  directory: string, checkout: Checkout | null,
): 'packet-needs-reconciliation' | 'prepared-candidate' | null {
  if (!existsSync(directory)) return null;
  ordinaryDirectory(directory);
  const active = path.join(directory, 'active-packet.json');
  const packet = path.join(directory, 'sanitized-packet.json');
  const prepared = path.join(directory, 'prepared-release.json');
  // Initialization can retain its exclusive lock before writing any journal.
  if (existsSync(path.join(directory, 'batch-executor.lock'))) {
    return 'packet-needs-reconciliation';
  }
  if (!existsSync(active)) return existsSync(prepared) ? 'prepared-candidate'
    : existsSync(packet) || existsSync(path.join(directory, 'batch-manifest.json')) ? 'packet-needs-reconciliation' : null;
  const journalBytes = readLifecycleFile(active, 16 * 1024 * 1024);
  const journal = journalSchema.parse(JSON.parse(journalBytes.toString('utf8')));
  if (journal.batch && journal.batch.phase !== 'completed') {
    return existsSync(prepared) ? 'prepared-candidate' : 'packet-needs-reconciliation';
  }
  const archive = path.join(directory, 'archive');
  const destination = path.join(archive, journal.jobId);
  if (existsSync(archive)) ordinaryDirectory(archive);
  if (existsSync(destination)) ordinaryDirectory(destination);
  const terminalName = `${journal.jobId}.terminal.json`;
  const terminal = path.join(directory, terminalName);
  const archivedTerminal = path.join(destination, terminalName);
  if (!existsSync(terminal) && !existsSync(archivedTerminal)) {
    return existsSync(prepared) ? 'prepared-candidate' : 'packet-needs-reconciliation';
  }
  const receiptBytes = readLifecycleFile(existsSync(terminal) ? terminal : archivedTerminal, 2048);
  const receipt = receiptSchema.parse(JSON.parse(receiptBytes.toString('utf8')));
  if (receipt.packetJobId !== journal.jobId || receipt.packetSha256 !== journal.packetSha256) {
    throw new Error('Packet retirement receipt mismatch');
  }
  const deployed = receipt.status === 'deployed';
  if (receipt.status === 'unknown' || receipt.status === 'tested') return 'prepared-candidate';
  const testedName = `${journal.jobId}.tested.json`;
  const tested = path.join(directory, testedName);
  const archivedTested = path.join(destination, testedName);
  if (!deployed && (existsSync(tested) || existsSync(archivedTested))) return 'prepared-candidate';
  if (!deployed && (receipt.jobId !== journal.jobId || (receipt.status === 'reviewed' && journal.action !== 'review'))) {
    return 'packet-needs-reconciliation';
  }
  if (!checkout || (deployed
    ? !receipt.candidate || checkout.head !== receipt.candidate.head || checkout.tree !== receipt.candidate.tree
    : checkout.head !== journal.head || checkout.tree !== journal.tree || existsSync(prepared))) {
    return existsSync(prepared) ? 'prepared-candidate' : 'packet-needs-reconciliation';
  }
  let testedBytes: Buffer | undefined;
  let preparedSha256: string | undefined;
  if (deployed) {
    if (journal.action !== 'repair' || receipt.jobId === journal.jobId ||
        (!existsSync(tested) && !existsSync(archivedTested))) return 'prepared-candidate';
    testedBytes = readLifecycleFile(existsSync(tested) ? tested : archivedTested, 2048);
    const proof = receiptSchema.parse(JSON.parse(testedBytes.toString('utf8')));
    if (proof.status !== 'tested' || proof.jobId !== journal.jobId || proof.packetJobId !== journal.jobId ||
        proof.packetSha256 !== journal.packetSha256 || !proof.preparedSha256 || !proof.candidate ||
        !receipt.candidate || !sameCandidate(proof.candidate, receipt.candidate)) return 'prepared-candidate';
    const preparedBytes = readLifecycleFile(existsSync(prepared) ? prepared : path.join(destination, 'prepared-release.json'), 16_384);
    if (digest(preparedBytes) !== proof.preparedSha256) throw new Error('Prepared retirement evidence changed');
    preparedSha256 = proof.preparedSha256;
  }
  const packetName = journal.batch ? 'batch-manifest.json' : 'sanitized-packet.json';
  const packetPath = journal.batch ? path.join(directory, packetName) : packet;
  const max = journal.batch ? 16 * 1024 * 1024 : FIXERRORS_COMPANION_PACKET_MAX_BYTES;
  const packetBytes = readLifecycleFile(existsSync(packetPath) ? packetPath : path.join(destination, packetName), max);
  if (journal.batch) {
    parseBatchBytes(packetBytes);
    if (existsSync(path.join(directory, 'batch-executor.lock')) ||
        journal.batch.manifestSha256 !== journal.packetSha256) throw new Error('Native batch retirement remains held');
  }
  if (digest(packetBytes) !== journal.packetSha256) throw new Error('Packet retirement digest changed');
  const scope = path.join(directory, 'batch-check-scope.json');
  const archivedScope = path.join(destination, 'batch-check-scope.json');
  const scopeBytes = deployed && journal.batch && (existsSync(scope) || existsSync(archivedScope))
    ? readLifecycleFile(existsSync(scope) ? scope : archivedScope, 16 * 1024 * 1024) : undefined;
  // Retire only with verified deployed evidence. Preserve conflicts before moving
  // any other artifacts, and support resuming after the scope was already moved.
  if (scopeBytes && existsSync(archivedScope) &&
      !readLifecycleFile(archivedScope, 16 * 1024 * 1024).equals(scopeBytes)) {
    throw new Error('Batch check scope archive conflict');
  }
  if (!existsSync(archive)) mkdirSync(archive);
  ordinaryDirectory(archive);
  if (!existsSync(destination)) mkdirSync(destination);
  ordinaryDirectory(destination);
  archiveFile(packetPath, path.join(destination, packetName), journal.packetSha256, max);
  if (preparedSha256) archiveFile(prepared, path.join(destination, 'prepared-release.json'), preparedSha256);
  archiveFile(terminal, archivedTerminal, digest(receiptBytes));
  if (testedBytes) archiveFile(tested, archivedTested, digest(testedBytes));
  if (scopeBytes) archiveFile(scope, archivedScope, digest(scopeBytes), 16 * 1024 * 1024);
  archiveFile(active, path.join(destination, 'active-packet.json'), digest(journalBytes), 16 * 1024 * 1024);
  return null;
}
