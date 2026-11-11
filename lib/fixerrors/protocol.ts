import { z } from 'zod';
import type { CapturedBatch } from './batch';

export const FIXERRORS_LOCAL_ORIGIN = 'https://localhost:4443';
export const FIXERRORS_PRODUCTION_ORIGIN = 'https://www.squiresapp.com';
export const FIXERRORS_DEVICE_PATH = '/api/fixerrors-device';
export const FIXERRORS_DEPLOY_TIMEOUT_MS = 25 * 60_000;
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const gitOid = z.string().regex(/^[a-f0-9]{40}$/u);
export const candidateSchema = z.object({
  head: gitOid,
  tree: gitOid,
  checksSha256: sha256Schema,
}).strict();
export const workspaceSchema = z.object({
  head: gitOid,
  tree: gitOid,
  packetSha256: sha256Schema,
  clean: z.literal(true),
}).strict();
export const checkoutSchema = workspaceSchema.omit({ packetSha256: true });
export const runnerHoldSchema = z.enum(['packet-needs-reconciliation', 'prepared-candidate', 'checkout-unavailable', 'checks-preparing', 'checks-unavailable']);
export const checksSchema = z.object({
  head: gitOid,
  tree: gitOid,
  checks: z.tuple([
    z.object({ id: z.literal('targeted-tests'), outputSha256: sha256Schema, passed: z.literal(true) }).strict(),
    z.object({ id: z.literal('typecheck'), outputSha256: sha256Schema, passed: z.literal(true) }).strict(),
    z.object({ id: z.literal('lint'), outputSha256: sha256Schema, passed: z.literal(true) }).strict(),
  ]),
  release: z.object({
    candidateSha256: sha256Schema,
    testEvidenceSha256: sha256Schema,
  }).strict().optional(),
}).strict();
export const actionSchema = z.enum(['review', 'repair', 'deploy']);
export const releaseModeSchema = z.enum(['full', 'targeted']);
export type ReleaseMode = z.infer<typeof releaseModeSchema>;
export const jobStateSchema = z.enum(['queued', 'leased', 'paused', 'reviewed', 'tested', 'blocked', 'failed', 'expired', 'deployed', 'unknown', 'no-work', 'no-change']);
export const blockReasonSchema = z.enum([
  'bridge-unavailable', 'local-opt-out', 'checkout-drift', 'lease-lost', 'timeout', 'execution-failed', 'release-unconfirmed',
]);
export const nativeDiagnosticSchema = z.enum([
  'native-import-unavailable', 'typecheck-cache-not-ready', 'batch-initialization-refused', 'batch-execution-unconfirmed',
]);
export const batchProgressSchema = z.object({
  captured: z.number().int().nonnegative(), rows: z.number().int().nonnegative(),
  processed: z.number().int().nonnegative(), remaining: z.number().int().nonnegative(),
  counts: z.object({
    'verified-local': z.number().int().nonnegative(), held: z.number().int().nonnegative(),
    'report-only': z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
  }).strict(),
  lifecycle: z.enum(['pending', 'applied', 'blocked']),
  lifecycleReason: z.enum(['conflict', 'schema', 'expired', 'uncertain', 'unavailable']).optional(),
}).strict();
const batchDelivery = z.object({
  version: z.literal(1), manifestSha256: sha256Schema, bytes: z.number().int().positive(),
  chunks: z.number().int().positive(), clusters: z.number().int().nonnegative(), rows: z.number().int().nonnegative(),
}).strict();
export const jobSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid(),
  action: actionSchema,
  state: jobStateSchema,
  requestedBy: z.string().uuid(),
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  workspace: workspaceSchema,
  parentRepairId: z.string().uuid().nullable(),
  candidate: candidateSchema.nullable(),
  checks: checksSchema.nullable(),
  approval: z.object({
    actorId: z.string().uuid(),
    confirmedAt: z.number().int(),
    candidate: candidateSchema,
    releaseMode: releaseModeSchema.optional(),
  }).strict().nullable(),
  lease: z.object({
    tokenSha256: sha256Schema,
    until: z.number().int(),
    deployStartedAt: z.number().int().optional(),
  }).strict().nullable(),
  reason: blockReasonSchema.nullable(),
  diagnostic: nativeDiagnosticSchema.optional(),
  // Validation preference only; this grants no deployment authority.
  requestedReleaseMode: releaseModeSchema.optional(),
  // Private sanitized evidence, not browser-visible queue state or launch authority.
  packet: z.string().min(1).max(96 * 1024).optional(),
  batch: batchProgressSchema.optional(),
  // Trusted server retention only. Omitted from every public/claim projection.
  privateBatch: z.custom<CapturedBatch>(value => typeof value === 'object' && value !== null).optional(),
}).strict();
export const deviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().regex(/^[A-Za-z0-9 -]{1,60}$/u),
  credentialSha256: sha256Schema,
  revoked: z.boolean(),
  lastSeenAt: z.number().int().nullable(),
  workspace: workspaceSchema.nullable(),
  allowReadOnly: z.boolean(),
  allowRepair: z.boolean(),
  allowDeploy: z.boolean(),
  bridgeAvailable: z.boolean(),
  checkout: checkoutSchema.nullable().optional(),
  holdReason: runnerHoldSchema.nullable().optional(),
}).strict();
export const queueStateSchema = z.object({
  version: z.literal(1),
  devices: z.array(deviceSchema).max(20),
  jobs: z.array(jobSchema).max(500),
}).strict();
export const adminCommandSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('enqueue'),
    requestId: z.string().uuid(),
    deviceId: z.string().uuid(),
    action: z.enum(['review', 'repair']),
    reviewJobId: z.string().uuid().optional(),
    requestedReleaseMode: releaseModeSchema.optional(),
    }).strict(),
  z.object({
    op: z.literal('approve-deploy'),
    requestId: z.string().uuid(),
    repairJobId: z.string().uuid(),
    candidate: candidateSchema,
    confirmation: z.literal(true),
    releaseMode: releaseModeSchema,
  }).strict(),
  z.object({ op: z.literal('revoke-device'), deviceId: z.string().uuid() }).strict(),
  z.object({ op: z.literal('cancel'), jobId: z.string().uuid() }).strict(),
]);
export const resultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('blocked'), reason: blockReasonSchema }).strict(),
  z.object({ status: z.literal('failed'), reason: z.literal('execution-failed'), diagnostic: nativeDiagnosticSchema.optional() }).strict(),
  z.object({ status: z.literal('reviewed') }).strict(),
  z.object({ status: z.literal('tested'), candidate: candidateSchema, checks: checksSchema }).strict(),
  z.object({ status: z.literal('deployed'), candidate: candidateSchema }).strict(),
  z.object({ status: z.literal('unknown'), reason: z.literal('release-unconfirmed') }).strict(),
  z.object({ status: z.literal('no-change') }).strict(),
]);
const leasedCommand = {
  jobId: z.string().uuid(),
  leaseToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
};
export const deviceCommandSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('heartbeat'),
    workspace: workspaceSchema.nullable(),
    allowReadOnly: z.boolean(),
    allowRepair: z.boolean(),
    allowDeploy: z.boolean(),
    bridgeAvailable: z.boolean(),
    checkout: checkoutSchema.nullable().optional(),
    holdReason: runnerHoldSchema.nullable().optional(),
  }).strict(),
  z.object({ op: z.literal('claim') }).strict(),
  z.object({ op: z.literal('renew'), ...leasedCommand }).strict(),
  z.object({ op: z.literal('batch-chunk'), ...leasedCommand, index: z.number().int().nonnegative() }).strict(),
  z.object({ op: z.literal('batch-lease'), ...leasedCommand,
    checkpointSha256: sha256Schema, cursor: z.number().int().nonnegative(), outcome: z.unknown().optional(),
    resume: z.boolean(),
  }).strict(),
  z.object({ op: z.literal('pause-batch'), ...leasedCommand, checkpointSha256: sha256Schema }).strict(),
  z.object({ op: z.literal('batch-reconcile'), jobId: z.string().uuid() }).strict(),
  z.object({ op: z.literal('start-deploy'), ...leasedCommand }).strict(),
  z.object({ op: z.literal('complete'), ...leasedCommand, result: resultSchema, outcomeSha256: sha256Schema.optional() }).strict(),
]);
export const claimSchema = z.object({
  job: jobSchema.omit({ packet: true, privateBatch: true }),
  leaseToken: leasedCommand.leaseToken,
  admissionTicket: z.string().min(1).max(4096).optional(),
  packet: z.string().min(1).max(96 * 1024).optional(),
  batch: batchDelivery.optional(),
  resume: z.boolean().optional(),
}).strict();
export const deviceResponseSchema = z.object({
  claim: claimSchema.nullable().optional(),
  leaseUntil: z.number().int().optional(),
  releaseTicket: z.string().min(1).max(4096).optional(),
  batchLease: z.string().min(1).max(4096).optional(),
  chunk: z.object({ index: z.number().int().nonnegative(), sha256: sha256Schema, data: z.string().max(65536) }).strict().optional(),
  lifecycle: z.enum(['pending', 'applied', 'blocked']).optional(),
  completion: z.object({
    job: jobSchema.omit({ packet: true, privateBatch: true }),
    outcomeSha256: sha256Schema,
  }).strict().optional(),
  ok: z.literal(true),
}).strict();

export type Candidate = z.infer<typeof candidateSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type Checkout = z.infer<typeof checkoutSchema>;
export type CheckEvidence = z.infer<typeof checksSchema>;
export type FixerrorsJob = z.infer<typeof jobSchema>;
export type FixerrorsDevice = z.infer<typeof deviceSchema>;
export type QueueState = z.infer<typeof queueStateSchema>;
export type AdminCommand = z.infer<typeof adminCommandSchema>;
export type DeviceCommand = z.infer<typeof deviceCommandSchema>;
export type ExecutionResult = z.infer<typeof resultSchema>;
export type ClaimedJob = z.infer<typeof claimSchema>;

export function sameCandidate(a: Candidate, b: Candidate): boolean {
  return a.head === b.head && a.tree === b.tree && a.checksSha256 === b.checksSha256;
}

export function sameWorkspace(a: Workspace, b: Workspace): boolean {
  return a.head === b.head && a.tree === b.tree && a.packetSha256 === b.packetSha256;
}

// Credentials and lease authenticators never reach the browser.
export function publicQueueState(state: QueueState) {
  return {
    releaseNeedsReconciliation: state.jobs.some((job) => job.state === 'unknown'),
    devices: state.devices.map(({ credentialSha256: _credential, ...device }) => device),
    jobs: state.jobs.slice().reverse().map(({ lease, packet: _packet, privateBatch: _batch, ...job }) => ({
      ...job,
      leaseUntil: lease?.until ?? null,
      evidenceAvailable: Boolean(_packet || _batch),
      lifecycleReconciliationRequired: Boolean(_batch?.outcome && job.batch?.lifecycle !== 'applied'),
    })),
  };
}

export type PublicQueueState = ReturnType<typeof publicQueueState>;

export const adminResponseSchema = z.object({
  releaseNeedsReconciliation: z.boolean().default(false),
  enabled: z.boolean(),
  executionAvailable: z.boolean(),
  origin: z.enum([FIXERRORS_LOCAL_ORIGIN, FIXERRORS_PRODUCTION_ORIGIN]),
  devices: z.array(deviceSchema.omit({ credentialSha256: true })).max(20),
  jobs: z.array(jobSchema.omit({ lease: true, packet: true, privateBatch: true }).extend({
    leaseUntil: z.number().int().nullable(), evidenceAvailable: z.boolean().default(false),
    lifecycleReconciliationRequired: z.boolean().default(true),
  })).max(500),
}).strict();
