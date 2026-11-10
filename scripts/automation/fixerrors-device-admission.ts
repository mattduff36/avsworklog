import { execFileSync } from 'child_process';
import { createHash, createPublicKey, verify } from 'crypto';
import { lstatSync, realpathSync } from 'fs';
import path from 'path';
import { z } from 'zod';
import {
  fixerrorsDeviceJobSchema as jobSchema, encodeFixerrorsDeviceJob, fixerrorsDeviceSigningBytes,
  type FixerrorsDeviceJob,
} from '../../lib/fixerrors/admission';
export { encodeFixerrorsDeviceJob, fixerrorsDeviceSigningBytes, type FixerrorsDeviceJob } from '../../lib/fixerrors/admission';

export const FIXERRORS_WORKSPACE = 'D:\\Websites\\avsworklog';
const audience = 'squires-windows-fixerrors';
const maxTicketBytes = 4096;
const identifier = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u);
const envelopeSchema = z.object({
  version: z.literal(1),
  keyId: identifier,
  payload: z.string().min(1).max(2048),
  signature: z.string().length(86),
}).strict();
const enrollmentSchema = z.object({
  enabled: z.literal(true),
  deviceId: z.string().uuid(),
  environment: z.literal('squires-production'),
  keyId: identifier,
  publicKeyPem: z.string().min(1).max(1024),
  allowReadOnly: z.boolean(),
  allowBoundedRepair: z.boolean(),
  workerEligible: z.literal(true),
}).strict();

export type FixerrorsDeviceEnrollment = z.infer<typeof enrollmentSchema>;

export interface FixedWorkspaceEvidence {
  platform: string;
  workspace: string;
  topLevel: string;
  gitDirectory: string;
  branch: string;
  porcelain: string;
  head: string;
  tree: string;
}

export interface FixerrorsReplayClaim {
  namespace: typeof audience;
  jobId: string;
  ticketSha256: string;
  expiresAt: number;
}

export interface DurableFixerrorsReplayStore {
  /**
   * Atomically insert-if-absent by (namespace, jobId), across processes/restarts.
   * Return true ONLY after durable commit; false means already claimed, regardless
   * of ticket hash. Errors/uncertain commits must throw. Never release on failure.
   * Retain claims through expiry with a rollback-resistant clock (or forever).
   */
  claimOnce(claim: Readonly<FixerrorsReplayClaim>): Promise<boolean>;
}

export interface FixerrorsAdmissionDependencies {
  replayStore: DurableFixerrorsReplayStore;
  nowSeconds(): number;
  inspectWorkspace(): FixedWorkspaceEvidence;
  // Trusted local companion hashes its bounded sanitized packet, not a job path.
  packetSha256(): string;
}

export interface OfflineFixerrorsAdmission {
  launchAuthorized: false;
  jobId: string;
  authority: FixerrorsDeviceJob['authority'];
  workspace: typeof FIXERRORS_WORKSPACE;
  phase: 'review-sanitized-packet' | 'repair-validated-cluster';
  head: string;
  tree: string;
  packetSha256: string;
}

function fail(reason: string): never {
  throw new Error(`Fixerrors device admission denied: ${reason}`);
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) fail('invalid base64url');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) fail('noncanonical base64url');
  return decoded;
}

/** Read-only commands only. Does not load dotenv, private packets or runner credentials. */
export function inspectFixedFixerrorsWorkspace(): FixedWorkspaceEvidence {
  if (process.platform !== 'win32') fail('Windows required');
  if (realpathSync(FIXERRORS_WORKSPACE) !== FIXERRORS_WORKSPACE ||
      !lstatSync(path.win32.join(FIXERRORS_WORKSPACE, '.git')).isDirectory() ||
      lstatSync(path.win32.join(FIXERRORS_WORKSPACE, '.git')).isSymbolicLink()) {
    fail('linked checkout or worktree');
  }
  const git = (...args: string[]) => execFileSync(
    'C:\\Program Files\\Git\\cmd\\git.exe',
    ['--no-optional-locks', '--no-pager', '-c', 'core.fsmonitor=false', ...args],
    {
      cwd: FIXERRORS_WORKSPACE,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      shell: false,
      env: {
        NODE_ENV: 'production',
        SystemRoot: process.env.SystemRoot,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: 'NUL',
        GIT_TERMINAL_PROMPT: '0',
      },
    },
  ).trimEnd();
  return {
    platform: process.platform,
    workspace: realpathSync(FIXERRORS_WORKSPACE),
    topLevel: realpathSync(git('rev-parse', '--show-toplevel')),
    gitDirectory: realpathSync(path.win32.resolve(FIXERRORS_WORKSPACE, git('rev-parse', '--git-dir'))),
    branch: git('branch', '--show-current'),
    porcelain: git('status', '--porcelain=v1', '--untracked-files=all'),
    head: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
  };
}

/**
 * Offline admission only, NOT native parent identity or permission to spawn.
 * Dependencies/enrollment belong to the trusted local companion, never the ticket.
 */
export async function admitFixerrorsDeviceJob(
  ticket: string,
  localEnrollment: FixerrorsDeviceEnrollment,
  dependencies: FixerrorsAdmissionDependencies,
): Promise<OfflineFixerrorsAdmission> {
  if (typeof ticket !== 'string' || Buffer.byteLength(ticket, 'utf8') > maxTicketBytes) fail('ticket size');
  const enrollment = enrollmentSchema.parse(localEnrollment);
  const rawEnvelope: unknown = JSON.parse(ticket);
  const envelope = envelopeSchema.parse(rawEnvelope);
  if (JSON.stringify(envelope) !== ticket) fail('noncanonical envelope');
  if (envelope.keyId !== enrollment.keyId) fail('unknown signing key');
  const payload = decodeBase64Url(envelope.payload);
  const signature = decodeBase64Url(envelope.signature);
  const key = createPublicKey(enrollment.publicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519' || signature.length !== 64 ||
      !verify(null, fixerrorsDeviceSigningBytes(envelope.keyId, envelope.payload), key, signature)) {
    fail('invalid signature');
  }
  const rawJob: unknown = JSON.parse(payload.toString('utf8'));
  const job = jobSchema.parse(rawJob);
  if (encodeFixerrorsDeviceJob(job) !== envelope.payload) fail('noncanonical job');
  if (job.deviceId !== enrollment.deviceId || job.environment !== enrollment.environment) fail('foreign job');
  if ((job.authority === 'read-only' && !enrollment.allowReadOnly) ||
      (job.authority === 'bounded-repair' && !enrollment.allowBoundedRepair)) fail('local authority not enabled');

  const assertTime = () => {
    const now = dependencies.nowSeconds();
    if (!Number.isSafeInteger(now) || now < 0 || job.issuedAt > now || job.expiresAt <= now ||
        job.expiresAt <= job.issuedAt ||
        job.expiresAt - job.issuedAt > (job.authority === 'bounded-repair' ? 600 : 300)) fail('invalid validity window');
  };
  assertTime();
  const workspace = dependencies.inspectWorkspace();
  if (workspace.platform !== 'win32' || workspace.workspace !== FIXERRORS_WORKSPACE ||
      workspace.topLevel !== FIXERRORS_WORKSPACE ||
      workspace.gitDirectory !== path.win32.join(FIXERRORS_WORKSPACE, '.git') ||
      workspace.branch !== 'main' || workspace.porcelain !== '' ||
      workspace.head !== job.head || workspace.tree !== job.tree) fail('checkout gate');
  if (dependencies.packetSha256() !== job.packetSha256) fail('sanitized packet mismatch');
  assertTime();
  const claimed = await dependencies.replayStore.claimOnce(Object.freeze({
    namespace: audience,
    jobId: job.jobId,
    ticketSha256: createHash('sha256').update(ticket, 'utf8').digest('hex'),
    expiresAt: job.expiresAt,
  }));
  if (claimed !== true) fail('replayed job');
  // A slow/uncertain claim consumes the job; it must never become a retry token.
  assertTime();
  return {
    launchAuthorized: false,
    jobId: job.jobId,
    authority: job.authority,
    workspace: FIXERRORS_WORKSPACE,
    phase: job.authority === 'read-only' ? 'review-sanitized-packet' : 'repair-validated-cluster',
    head: job.head,
    tree: job.tree,
    packetSha256: job.packetSha256,
  };
}
