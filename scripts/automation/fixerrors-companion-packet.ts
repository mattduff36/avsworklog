import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { FIXERRORS_COMPANION_PACKET_MAX_BYTES } from '../../lib/fixerrors/admission';
import { assertAutomaticFixerrorsRepair, parseAutomaticFixerrorsRetrieval } from '../fixerrors-auto';
import { captureCandidateFingerprint, validateDecision, type CandidateFingerprint } from '../fixerrors-decision';
import { FIXERRORS_WORKSPACE, inspectFixedFixerrorsWorkspace } from './fixerrors-device-admission';

export { FIXERRORS_COMPANION_PACKET_MAX_BYTES } from '../../lib/fixerrors/admission';
const inputSchema = z.object({
  schemaVersion: z.literal(1),
  snapshotChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
  retrieval: z.unknown(),
}).strict();

export function parseCompanionPacket(bytes: Buffer) {
  if (!bytes.length || bytes.length > FIXERRORS_COMPANION_PACKET_MAX_BYTES) {
    throw new Error('Companion sanitized packet exceeds transport limit or is empty');
  }
  const input = inputSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  const retrieval = parseAutomaticFixerrorsRetrieval(input.retrieval);
  if (!retrieval.clusters.length) throw new Error('Companion packet requires captured cluster evidence');
  return { schemaVersion: input.schemaVersion, snapshotChecksum: input.snapshotChecksum, retrieval };
}

export function encodeCompanionPacket(input: unknown, candidate: CandidateFingerprint): Buffer {
  const packet = parseCompanionPacket(Buffer.from(JSON.stringify(input), 'utf8'));
  if (packet.retrieval.baseHead !== candidate.baseHead || packet.retrieval.treeFingerprint !== candidate.treeFingerprint) {
    throw new Error('Companion packet candidate drift');
  }
  return Buffer.from(JSON.stringify(packet), 'utf8');
}

// A plan is not launch authority. The installed transport must revalidate it
// against the signed packet and inspect exact existing files before dispatch.
export function validateCompanionRepairDecision(bytes: Buffer, decision: unknown, candidate: CandidateFingerprint) {
  const packet = parseCompanionPacket(bytes);
  const validated = validateDecision({
    decision, candidate, retrieval: packet.retrieval,
    snapshotId: packet.retrieval.snapshotId, snapshotChecksum: packet.snapshotChecksum,
  });
  if (validated.clusters.length !== 1) throw new Error('Companion repair requires one independent validated cluster');
  const cluster = validated.clusters[0];
  if (cluster.disposition !== 'outstanding') throw new Error('Companion cannot claim a live fix');
  assertAutomaticFixerrorsRepair(cluster, packet.retrieval.clusters[0]);
  const paths = [...cluster.files, ...cluster.requiredTestIds];
  if (new Set(cluster.files).size !== cluster.files.length ||
      new Set(cluster.requiredTestIds).size !== cluster.requiredTestIds.length || new Set(paths).size > 40) {
    throw new Error('Companion repair scope is duplicate or exceeds transport limit');
  }
  return {
    decision: validated,
    plan: {
      editablePaths: [...cluster.files],
      checkIds: ['targeted-tests', 'typecheck', 'lint'],
      decisionSha256: createHash('sha256').update(JSON.stringify(validated), 'utf8').digest('hex'),
    },
  };
}

function assertCleanFixedCandidate(): CandidateFingerprint {
  const workspace = inspectFixedFixerrorsWorkspace();
  if (workspace.workspace !== FIXERRORS_WORKSPACE || workspace.topLevel !== FIXERRORS_WORKSPACE ||
      workspace.gitDirectory !== path.join(FIXERRORS_WORKSPACE, '.git') || workspace.branch !== 'main' || workspace.porcelain) {
    throw new Error('Companion packet preparation requires the fixed clean main checkout');
  }
  return captureCandidateFingerprint(FIXERRORS_WORKSPACE);
}

export async function prepareCompanionPacket(input: AsyncIterable<Uint8Array>): Promise<string> {
  const before = assertCleanFixedCandidate();
  const lockPath = path.join(FIXERRORS_WORKSPACE, '.git', 'squires-fixerrors-companion.lock');
  const lock = openSync(lockPath, 'wx');
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of input) {
      size += chunk.byteLength;
      if (size > FIXERRORS_COMPANION_PACKET_MAX_BYTES) throw new Error('Companion packet input exceeds transport limit');
      chunks.push(Buffer.from(chunk));
    }
    const encoded = encodeCompanionPacket(parseCompanionPacket(Buffer.concat(chunks)), before);
    const directory = path.join(FIXERRORS_WORKSPACE, '.git', 'squires-fixerrors');
    if (!existsSync(directory)) mkdirSync(directory);
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) {
      throw new Error('Companion packet directory must be ordinary and unlinked');
    }
    const file = path.join(directory, 'sanitized-packet.json');
    const latest = assertCleanFixedCandidate();
    if (JSON.stringify(latest) !== JSON.stringify(before)) throw new Error('Companion packet candidate drift');
    // Never replace an existing packet or clear replay state to recover.
    const descriptor = openSync(file, 'wx');
    try {
      writeFileSync(descriptor, encoded);
      fsyncSync(descriptor);
      if (!readFileSync(file).equals(encoded) || JSON.stringify(assertCleanFixedCandidate()) !== JSON.stringify(before)) {
        throw new Error('Companion packet writeback or candidate changed; owner reconciliation required');
      }
    } finally {
      closeSync(descriptor);
    }
    return createHash('sha256').update(encoded).digest('hex');
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--prepare-local-sanitized-packet') {
    console.error('Explicit local sanitized packet preparation required; no capture or execution is performed.');
    process.exitCode = 1;
  } else {
    prepareCompanionPacket(process.stdin).then((digest) => {
      console.info(`Local sanitized packet prepared: SHA-256 ${digest}. Execution remains disabled.`);
    }).catch(() => {
      console.error('Local packet preparation blocked. Check clean main, sanitized input, lock and existing packet; no automatic retry.');
      process.exitCode = 1;
    });
  }
}
