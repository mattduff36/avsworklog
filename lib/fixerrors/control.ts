import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import {
  checksSchema, FIXERRORS_DEPLOY_TIMEOUT_MS, sameCandidate, sameWorkspace,
  type AdminCommand, type CheckEvidence, type DeviceCommand,
  type Candidate, type FixerrorsDevice, type FixerrorsJob, type QueueState,
} from './protocol';

export class FixerrorsControlError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'FixerrorsControlError';
  }
}

export function deny(message: string, status = 409): never {
  throw new FixerrorsControlError(status, message);
}

export function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function checkEvidenceDigest(checks: CheckEvidence): string {
  return hash(JSON.stringify(checksSchema.parse(checks)));
}

export interface AuditEvent {
  at: number;
  actor: string;
  event: string;
  jobId: string | null;
  deviceId: string;
  candidate?: Candidate;
}

export interface QueueTransaction {
  state: QueueState;
  audit(event: AuditEvent): void;
}

export interface QueueStore {
  // Serializes the state AND audit append in one durably committed transaction.
  transact<T>(work: (tx: QueueTransaction) => T): Promise<T>;
}

const LEASE_MS = 60_000;
const DEPLOY_SETTLEMENT_MS = 30_000;

function jobDeadline(job: FixerrorsJob): number {
  return job.lease?.deployStartedAt === undefined
    ? job.expiresAt
    : job.lease.deployStartedAt + FIXERRORS_DEPLOY_TIMEOUT_MS + DEPLOY_SETTLEMENT_MS;
}

function endUnconfirmed(job: FixerrorsJob): void {
  job.state = 'unknown';
  job.reason = 'release-unconfirmed';
  job.lease = null;
}

export function expireJobs(state: QueueState, now: number): void {
  for (const job of state.jobs) {
    if ((job.state === 'queued' || job.state === 'leased') &&
        (jobDeadline(job) <= now || (job.lease !== null && job.lease.until <= now))) {
      if (job.lease?.deployStartedAt !== undefined) {
        endUnconfirmed(job);
        continue;
      }
      job.state = 'expired';
      job.reason = 'lease-lost';
      job.lease = null;
    }
  }
}

function deviceById(state: QueueState, id: string): FixerrorsDevice {
  const device = state.devices.find((entry) => entry.id === id);
  if (!device || device.revoked) deny('Device unavailable', 403);
  return device;
}

function isActive(job: FixerrorsJob): boolean {
  return job.state === 'queued' || job.state === 'leased';
}

function assertNoUnconfirmedRelease(state: QueueState, action: FixerrorsJob['action']): void {
  if (action !== 'review' && state.jobs.some((job) => job.state === 'unknown' || job.lease?.deployStartedAt !== undefined)) {
    deny('A deployment is running or its result needs reconciliation');
  }
}

function assertFreshDevice(device: FixerrorsDevice, now: number): void {
  if (device.lastSeenAt === null || device.lastSeenAt > now || now - device.lastSeenAt >= 45_000 ||
      !device.workspace) deny('Device offline or checkout unavailable');
}

function assertOptIn(device: FixerrorsDevice, action: FixerrorsJob['action']): void {
  if ((action === 'review' && !device.allowReadOnly) ||
      (action === 'repair' && !device.allowRepair) ||
      (action === 'deploy' && !device.allowDeploy)) deny('Device has not opted into this action');
}

export function applyAdminCommand(tx: QueueTransaction, actor: string, command: AdminCommand, now: number) {
  const { state } = tx;
  expireJobs(state, now);
  if (command.op === 'revoke-device') {
    const device = deviceById(state, command.deviceId);
    device.revoked = true;
    for (const job of state.jobs.filter((entry) => entry.deviceId === device.id && isActive(entry))) {
      if (job.lease?.deployStartedAt !== undefined) {
        endUnconfirmed(job);
        continue;
      }
      job.state = 'blocked';
      job.reason = 'local-opt-out';
      job.lease = null;
    }
    tx.audit({ at: now, actor, event: 'device-revoked', jobId: null, deviceId: device.id });
    return { ok: true as const };
  }
  if (state.jobs.some((job) => job.id === command.requestId)) deny('Duplicate request');
  if (state.jobs.length >= 500) deny('Local queue retention limit reached; owner review required');

  let parent: FixerrorsJob | undefined;
  if (command.op === 'approve-deploy') {
    parent = state.jobs.find((job) => job.id === command.repairJobId);
    if (!parent || parent.action !== 'repair' || parent.state !== 'tested' || !parent.candidate || !parent.checks ||
        !sameCandidate(parent.candidate, command.candidate) ||
        checkEvidenceDigest(parent.checks) !== command.candidate.checksSha256) deny('Tested candidate mismatch');
    if (state.jobs.some((job) => job.parentRepairId === parent?.id)) deny('Candidate already approved');
  }
  const deviceId = command.op === 'enqueue' ? command.deviceId : parent?.deviceId;
  if (!deviceId) deny('Repair device unavailable');
  const device = deviceById(state, deviceId);
  assertFreshDevice(device, now);
  const action = command.op === 'enqueue' ? command.action : 'deploy';
  assertNoUnconfirmedRelease(state, action);
  assertOptIn(device, action);
  if (state.jobs.some((job) => job.deviceId === device.id && isActive(job))) deny('Device already has an active job');
  const workspace = device.workspace;
  if (!workspace) deny('Clean checkout unavailable');
  if (parent?.candidate && (workspace.head !== parent.candidate.head || workspace.tree !== parent.candidate.tree)) {
    deny('Stale tested candidate');
  }
  const job: FixerrorsJob = {
    id: command.requestId, deviceId: device.id, action, state: 'queued', requestedBy: actor,
    createdAt: now, expiresAt: now + 300_000, workspace: { ...workspace },
    parentRepairId: parent?.id ?? null,
    candidate: parent?.candidate ?? null, checks: parent?.checks ?? null,
    approval: command.op === 'approve-deploy'
      ? { actorId: actor, confirmedAt: now, candidate: { ...command.candidate } } : null,
    lease: null, reason: null,
  };
  state.jobs.push(job);
  tx.audit({
    at: now, actor, event: action === 'deploy' ? 'exact-candidate-deploy-confirmed' : `${action}-requested`,
    jobId: job.id, deviceId: device.id,
    ...(job.approval ? { candidate: job.approval.candidate } : {}),
  });
  return { ok: true as const, jobId: job.id };
}

function authenticate(state: QueueState, id: string, credential: string): FixerrorsDevice {
  const device = state.devices.find((entry) => entry.id === id);
  const expected = Buffer.from(device?.credentialSha256 ?? '0'.repeat(64), 'hex');
  const supplied = Buffer.from(hash(credential), 'hex');
  if (!timingSafeEqual(expected, supplied) || !device || device.revoked) deny('Unauthorized device', 401);
  return device;
}

export function applyDeviceCommand(
  tx: QueueTransaction, id: string, credential: string, command: DeviceCommand, now: number,
  issueRelease?: (job: Readonly<FixerrorsJob>, now: number) => string | undefined,
  issueAdmission?: (job: Readonly<FixerrorsJob>, now: number) => string,
) {
  const { state } = tx;
  const device = authenticate(state, id, credential);
  expireJobs(state, now);
  const audit = (event: string, jobId: string | null) => tx.audit({ at: now, actor: id, event, jobId, deviceId: id });
  if (command.op === 'heartbeat') {
    Object.assign(device, {
      lastSeenAt: now, workspace: command.workspace,
      allowReadOnly: command.allowReadOnly, allowRepair: command.allowRepair,
      allowDeploy: command.allowDeploy, bridgeAvailable: command.bridgeAvailable,
    });
    audit('device-heartbeat', null);
    return { ok: true as const };
  }
  assertFreshDevice(device, now);
  device.lastSeenAt = now;
  if (command.op === 'claim') {
    if (state.jobs.some((job) => job.deviceId === id && job.state === 'leased')) deny('Job already leased');
    const job = state.jobs.find((entry) => entry.deviceId === id && entry.state === 'queued');
    if (!job) return { ok: true as const, claim: null };
    assertNoUnconfirmedRelease(state, job.action);
    assertOptIn(device, job.action);
    if (!device.workspace || !sameWorkspace(job.workspace, device.workspace)) deny('Checkout changed since request');
    if (job.action === 'deploy' && (!job.approval || !job.candidate ||
        !sameCandidate(job.approval.candidate, job.candidate) ||
        job.candidate.head !== device.workspace.head || job.candidate.tree !== device.workspace.tree)) {
      deny('Deploy approval mismatch');
    }
    const leaseToken = randomBytes(32).toString('base64url');
    job.state = 'leased';
    job.lease = { tokenSha256: hash(leaseToken), until: Math.min(now + LEASE_MS, job.expiresAt) };
    const admissionTicket = job.action === 'deploy' ? undefined : issueAdmission?.(structuredClone(job), now);
    if (issueAdmission && job.action !== 'deploy' && !admissionTicket) deny('Signed admission unavailable', 503);
    audit('job-claimed', job.id);
    return { ok: true as const, claim: { job: structuredClone(job), leaseToken, ...(admissionTicket ? { admissionTicket } : {}) } };
  }
  const job = state.jobs.find((entry) => entry.id === command.jobId && entry.deviceId === id);
  if (!job || job.state !== 'leased' || !job.lease ||
      !timingSafeEqual(Buffer.from(job.lease.tokenSha256, 'hex'), Buffer.from(hash(command.leaseToken), 'hex'))) {
    deny('Lease lost or not owned');
  }
  assertOptIn(device, job.action);
  if (command.op === 'start-deploy') {
    if (job.action !== 'deploy' || job.lease.deployStartedAt !== undefined) deny('Deployment cannot be started');
    assertNoUnconfirmedRelease(state, job.action);
    job.lease.deployStartedAt = now;
    job.lease.until = now + LEASE_MS;
    const releaseTicket = issueRelease?.(structuredClone(job), now);
    audit('deploy-started', job.id);
    return { ok: true as const, leaseUntil: job.lease.until, ...(releaseTicket ? { releaseTicket } : {}) };
  }
  if (command.op === 'renew') {
    job.lease.until = Math.min(now + LEASE_MS, jobDeadline(job));
    audit('lease-renewed', job.id);
    return { ok: true as const, leaseUntil: job.lease.until };
  }
  const result = command.result;
  if ((result.status === 'deployed' || result.status === 'unknown') && job.lease.deployStartedAt === undefined) {
    deny('Deployment has not started');
  }
  if (result.status === 'tested') {
    if (job.action !== 'repair' || result.candidate.head !== result.checks.head ||
        result.candidate.tree !== result.checks.tree ||
        result.candidate.checksSha256 !== checkEvidenceDigest(result.checks)) deny('Invalid test evidence');
    job.candidate = result.candidate;
    job.checks = result.checks;
    device.workspace = { ...job.workspace, head: result.candidate.head, tree: result.candidate.tree };
  } else if (result.status === 'reviewed' && job.action !== 'review') {
    deny('Wrong result for action');
  } else if (result.status === 'deployed') {
    if (job.action !== 'deploy' || !job.candidate || !job.approval ||
        !sameCandidate(job.candidate, result.candidate) ||
        !sameCandidate(job.approval.candidate, result.candidate)) deny('Wrong deployed candidate');
  }
  job.state = result.status;
  job.reason = result.status === 'blocked' || result.status === 'failed' || result.status === 'unknown' ? result.reason : null;
  job.lease = null;
  audit(`job-${job.state}`, job.id);
  return { ok: true as const };
}
