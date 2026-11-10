import { z } from 'zod';

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
export const jobStateSchema = z.enum(['queued', 'leased', 'reviewed', 'tested', 'blocked', 'failed', 'expired', 'deployed', 'unknown']);
export const blockReasonSchema = z.enum([
  'bridge-unavailable', 'local-opt-out', 'checkout-drift', 'lease-lost', 'timeout', 'execution-failed', 'release-unconfirmed',
]);
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
  }).strict().nullable(),
  lease: z.object({
    tokenSha256: sha256Schema,
    until: z.number().int(),
    deployStartedAt: z.number().int().optional(),
  }).strict().nullable(),
  reason: blockReasonSchema.nullable(),
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
  }).strict(),
  z.object({
    op: z.literal('approve-deploy'),
    requestId: z.string().uuid(),
    repairJobId: z.string().uuid(),
    candidate: candidateSchema,
    confirmation: z.literal('DEPLOY EXACT TESTED CANDIDATE'),
  }).strict(),
  z.object({ op: z.literal('revoke-device'), deviceId: z.string().uuid() }).strict(),
]);
export const resultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('blocked'), reason: blockReasonSchema }).strict(),
  z.object({ status: z.literal('failed'), reason: z.literal('execution-failed') }).strict(),
  z.object({ status: z.literal('reviewed') }).strict(),
  z.object({ status: z.literal('tested'), candidate: candidateSchema, checks: checksSchema }).strict(),
  z.object({ status: z.literal('deployed'), candidate: candidateSchema }).strict(),
  z.object({ status: z.literal('unknown'), reason: z.literal('release-unconfirmed') }).strict(),
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
  }).strict(),
  z.object({ op: z.literal('claim') }).strict(),
  z.object({ op: z.literal('renew'), ...leasedCommand }).strict(),
  z.object({ op: z.literal('start-deploy'), ...leasedCommand }).strict(),
  z.object({ op: z.literal('complete'), ...leasedCommand, result: resultSchema }).strict(),
]);
export const claimSchema = z.object({
  job: jobSchema,
  leaseToken: leasedCommand.leaseToken,
  admissionTicket: z.string().min(1).max(4096).optional(),
}).strict();
export const deviceResponseSchema = z.object({
  claim: claimSchema.nullable().optional(),
  leaseUntil: z.number().int().optional(),
  releaseTicket: z.string().min(1).max(4096).optional(),
  ok: z.literal(true),
}).strict();

export type Candidate = z.infer<typeof candidateSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
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
    jobs: state.jobs.slice(-50).reverse().map(({ lease, ...job }) => ({
      ...job,
      leaseUntil: lease?.until ?? null,
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
  jobs: z.array(jobSchema.omit({ lease: true }).extend({ leaseUntil: z.number().int().nullable() })).max(50),
}).strict();
