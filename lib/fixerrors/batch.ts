import { createHash, randomUUID, sign, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { parseAutomaticFixerrorsRetrieval, type AutoRunResult } from '../../scripts/fixerrors-auto';
import { parseDecision } from '../../scripts/fixerrors-decision';
import type { LifecycleBinding } from '../../scripts/fixerrors-lifecycle-run';
import { parseLifecyclePlan, type LifecyclePlan, type LifecycleRecord } from '../../scripts/fixerrors-lifecycle';

export const BATCH_CHUNK_BYTES = 48 * 1024;
export const batchHash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export function batchOutcomeHash(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) :
    item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)])) : item;
  return batchHash(JSON.stringify(canonical(value)));
}
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const batchDeliverySchema = z.object({
  version: z.literal(1), manifestSha256: digest,
  bytes: z.number().int().positive(), chunks: z.number().int().positive(),
  clusters: z.number().int().nonnegative(), rows: z.number().int().nonnegative(),
}).strict();
export type BatchDelivery = z.infer<typeof batchDeliverySchema>;
export const batchCheckpointSchema = z.object({
  checkpointSha256: digest, cursor: z.number().int().nonnegative(),
  outcome: z.unknown().optional(), resume: z.boolean().default(false),
}).strict();
export type BatchCheckpoint = z.infer<typeof batchCheckpointSchema>;
export const batchOutcomeSchema = z.object({
  runId: z.string(), candidate: z.object({ baseHead: z.string(), treeFingerprint: digest }).strict(),
  clusters: z.array(z.object({
    id: z.string(), status: z.enum(['verified-local', 'held', 'report-only', 'failed']),
    reason: z.string(), attempt: z.string(), tests: z.array(z.string()), evidence: z.array(z.string()),
    reusedFrom: z.string().optional(),
  }).strict()),
  decisions: z.array(z.unknown()),
}).strict();
export interface CapturedBatch {
  manifest: string;
  target: string;
  bindings: LifecycleBinding[];
  suppressed: LifecycleRecord[];
  delivery: BatchDelivery;
  checkpoint?: BatchCheckpoint;
  outcome?: AutoRunResult;
  sequence: number;
  started?: boolean;
  stopped?: boolean;
  lifecycle?: {
    state: 'pending' | 'applied' | 'blocked'; plan: LifecyclePlan | null; receipts: Record<string, string>;
    reason?: 'conflict' | 'schema' | 'expired' | 'uncertain' | 'unavailable';
  };
}

export function parseCapturedBatch(value: unknown, jobId: string): CapturedBatch {
  const record = z.record(z.string(), z.unknown()).transform(row => {
    const id = z.string().uuid().parse(row.id);
    return Object.assign(row, { id });
  });
  const parsed = z.object({
    manifest: z.string().min(1), target: digest,
    bindings: z.array(z.object({
      clusterId: z.string(), records: z.array(record).min(1), observedAt: z.string().datetime({ offset: true }),
    }).strict()),
    suppressed: z.array(record), delivery: batchDeliverySchema,
    checkpoint: batchCheckpointSchema.optional(), outcome: z.unknown().optional(),
    sequence: z.number().int().nonnegative(), started: z.boolean().optional(), stopped: z.boolean().optional(),
    lifecycle: z.object({
      state: z.enum(['pending', 'applied', 'blocked']),
      plan: z.unknown().transform(input => input === null ? null : parseLifecyclePlan(input)),
      receipts: z.record(z.string(), z.string()),
      reason: z.enum(['conflict', 'schema', 'expired', 'uncertain', 'unavailable']).optional(),
    }).strict().optional(),
  }).strict().parse(value);
  const manifest = parseBatchBytes(Buffer.from(parsed.manifest));
  const delivery = describeBatch(parsed.manifest, parsed.delivery.rows);
  const ids = [...parsed.bindings.flatMap(binding => binding.records), ...parsed.suppressed].map(row => row.id);
  if (Object.keys(delivery).some(key => delivery[key as keyof BatchDelivery] !== parsed.delivery[key as keyof BatchDelivery]) ||
      ids.length !== delivery.rows || new Set(ids).size !== ids.length ||
      JSON.stringify(parsed.bindings.map(binding => binding.clusterId)) !==
        JSON.stringify(manifest.retrieval.clusters.map(cluster => cluster.id))) {
    throw new Error('Retained batch coverage or binding changed');
  }
  const batch: CapturedBatch = { ...parsed, outcome: undefined };
  if (parsed.outcome !== undefined) batch.outcome = validateBatchOutcome(batch, parsed.outcome, jobId, true);
  if (batch.checkpoint?.outcome) {
    batch.checkpoint.outcome = validateBatchOutcome(batch, batch.checkpoint.outcome, jobId, false);
  }
  return batch;
}

export function parseBatchBytes(bytes: Buffer) {
  const value = z.object({
    schemaVersion: z.literal(1), snapshotChecksum: digest, retrieval: z.unknown(),
  }).strict().parse(JSON.parse(bytes.toString('utf8')));
  const manifest = { ...value, retrieval: parseAutomaticFixerrorsRetrieval(value.retrieval) };
  if (JSON.stringify(manifest) !== bytes.toString('utf8')) throw new Error('Noncanonical batch manifest');
  return manifest;
}

export function describeBatch(manifest: string, rows: number): BatchDelivery {
  const bytes = Buffer.from(manifest);
  const parsed = parseBatchBytes(bytes);
  return batchDeliverySchema.parse({
    version: 1, manifestSha256: batchHash(bytes), bytes: bytes.length,
    chunks: Math.ceil(bytes.length / BATCH_CHUNK_BYTES), clusters: parsed.retrieval.clusters.length, rows,
  });
}

export function readBatchChunk(batch: CapturedBatch, index: number) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= batch.delivery.chunks) throw new Error('Invalid batch chunk');
  const bytes = Buffer.from(batch.manifest);
  if (batchHash(bytes) !== batch.delivery.manifestSha256 || bytes.length !== batch.delivery.bytes) {
    throw new Error('Stored batch manifest changed');
  }
  const chunk = bytes.subarray(index * BATCH_CHUNK_BYTES, (index + 1) * BATCH_CHUNK_BYTES);
  return { index, sha256: batchHash(chunk), data: chunk.toString('base64url') };
}

export function validateBatchOutcome(batch: CapturedBatch, value: unknown, runId: string, complete: boolean): AutoRunResult {
  const result = batchOutcomeSchema.parse(value);
  const manifest = parseBatchBytes(Buffer.from(batch.manifest));
  const expected = manifest.retrieval.clusters;
  if (result.runId !== `fixerrors-${runId}` || result.clusters.length > expected.length ||
      (complete && result.clusters.length !== expected.length) ||
      result.clusters.some((cluster, index) => cluster.id !== expected[index].id)) {
    throw new Error('Batch outcome is not the exact completed prefix');
  }
  const decisions = result.decisions.length ? parseDecision({
    schemaVersion: 1, snapshotId: manifest.retrieval.snapshotId, analyst: 'MPDEE Worker',
    ...result.candidate, clusters: result.decisions,
  }).clusters : [];
  if (new Set(decisions.map(entry => entry.id)).size !== decisions.length ||
      decisions.some(entry => !result.clusters.some(cluster => cluster.id === entry.id)) ||
      decisions.some(entry => entry.disposition === 'fixed_live')) throw new Error('Invalid batch decisions');
  for (const cluster of result.clusters) {
    const decision = decisions.find(entry => entry.id === cluster.id);
    if ((cluster.status === 'verified-local' && decision?.action !== 'fix') ||
        (cluster.status === 'report-only' && decision?.action !== 'report-only')) {
      throw new Error('Batch disposition contradicts decision');
    }
  }
  return { ...result, decisions };
}

export function signBatchLease(input: {
  runId: string; deviceId: string; manifestSha256: string; checkpointSha256: string;
  sequence: number; resume: boolean;
}, now: number, keyId: string, privateKey: KeyObject): string {
  const payload = Buffer.from(JSON.stringify({
    version: 1, runId: input.runId, deviceId: input.deviceId, manifestSha256: input.manifestSha256,
    checkpointSha256: input.checkpointSha256, leaseId: randomUUID(), sequence: input.sequence,
    authority: input.resume ? 'resume' : 'continue', issuedAt: Math.floor(now / 1000),
    expiresAt: Math.floor(now / 1000) + 60,
  })).toString('base64url');
  return JSON.stringify({
    version: 1, keyId, payload,
    signature: sign(null, Buffer.from(`squires-fixerrors-batch-lease-v1\n${keyId}\n${payload}`, 'ascii'), privateKey).toString('base64url'),
  });
}
