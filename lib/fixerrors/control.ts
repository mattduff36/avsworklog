import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { batchOutcomeHash, parseBatchBytes, readBatchChunk, validateBatchOutcome, type BatchCheckpoint, type CapturedBatch } from './batch';
import {
  checksSchema, FIXERRORS_DEPLOY_TIMEOUT_MS, FIXERRORS_PREAPPROVAL_MS, releaseModeSchema, sameCandidate, sameWorkspace,
  type AdminCommand, type CheckEvidence, type DeviceCommand,
  type Candidate, type Checkout, type FixerrorsDevice, type FixerrorsJob, type QueueState, type ReleaseMode,
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
  releaseMode?: ReleaseMode;
  preapproval?: FixerrorsJob['autoDeployPreapproval'];
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
  if (job.privateBatch?.started) return Number.POSITIVE_INFINITY;
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

function auditPreapproval(tx: QueueTransaction, job: FixerrorsJob, event: string, actor: string, now: number) {
  tx.audit({ at: now, actor, event, jobId: job.id, deviceId: job.deviceId,
    preapproval: structuredClone(job.autoDeployPreapproval) });
}

export function expirePreapprovals(tx: QueueTransaction, now: number): void {
  for (const job of tx.state.jobs) {
    const grant = job.autoDeployPreapproval;
    if (grant?.state === 'pending' && (now < grant.grantedAt || now >= grant.expiresAt)) {
      grant.state = 'expired';
      auditPreapproval(tx, job, 'deploy-preapproval-expired', grant.actorId, now);
    } else if (grant?.state === 'pending' && !['queued', 'leased', 'paused', 'tested'].includes(job.state)) {
      revokePreapproval(tx, job, grant.actorId, now);
    }
  }
}

function revokePreapproval(tx: QueueTransaction, job: FixerrorsJob, actor: string, now: number): void {
  const grant = job.autoDeployPreapproval;
  if (!grant || grant.state === 'revoked' || grant.state === 'expired') return;
  const release = tx.state.jobs.find(entry => entry.parentRepairId === job.id);
  if (release && (release.lease?.deployStartedAt !== undefined || !['queued', 'leased'].includes(release.state))) {
    deny('Deployment has already begun or ended; it cannot be undone by revoking pre-approval');
  }
  if (release) {
    release.state = 'blocked';
    release.reason = 'local-opt-out';
    release.lease = null;
  }
  grant.state = 'revoked';
  auditPreapproval(tx, job, 'deploy-preapproval-revoked', actor, now);
}

// Called only by the server after rereading the granting actor's current authority.
export function fulfillPreapprovedDeploy(tx: QueueTransaction, jobId: string, actorAuthorized: boolean, now: number): void {
  expireJobs(tx.state, now);
  expirePreapprovals(tx, now);
  const job = tx.state.jobs.find(entry => entry.id === jobId);
  const grant = job?.autoDeployPreapproval;
  if (!job || !grant || grant.state !== 'pending') return;
  const device = tx.state.devices.find(entry => entry.id === job.deviceId);
  if (!actorAuthorized || !device || device.revoked || !device.allowReadOnly || !device.allowRepair || !device.allowDeploy ||
      job.action !== 'repair' || grant.actorId !== job.requestedBy || grant.runId !== job.id || grant.deviceId !== job.deviceId ||
      grant.base.head !== job.workspace.head || grant.base.tree !== job.workspace.tree ||
      grant.manifestSha256 !== job.workspace.packetSha256 ||
      grant.manifestSha256 !== job.privateBatch?.delivery.manifestSha256 ||
      grant.grantedAt !== job.createdAt || grant.expiresAt !== grant.grantedAt + FIXERRORS_PREAPPROVAL_MS ||
      grant.releaseMode !== job.requestedReleaseMode ||
      !['queued', 'leased', 'paused', 'tested'].includes(job.state)) {
    revokePreapproval(tx, job, grant.actorId, now);
    return;
  }
  if (job.state !== 'tested') return;
  const candidate = job.candidate;
  if (!candidate || !job.checks?.release || !grant.testedCandidate || grant.testedAt === undefined ||
      !sameCandidate(candidate, grant.testedCandidate) || job.checks.head !== candidate.head ||
      job.checks.tree !== candidate.tree || checkEvidenceDigest(job.checks) !== candidate.checksSha256) {
    revokePreapproval(tx, job, grant.actorId, now);
    return;
  }
  const batch = job.batch;
  if (!job.privateBatch?.outcome || !batch || batch.remaining !== 0 || batch.counts.failed !== 0 ||
      batch.processed !== batch.captured || batch.counts['verified-local'] < 1 ||
      batch.lifecycle !== 'applied' || job.privateBatch.lifecycle?.state !== 'applied') return;
  const outcome = validateBatchOutcome(job.privateBatch, job.privateBatch.outcome, job.id, true);
  const manifest = parseBatchBytes(Buffer.from(job.privateBatch.manifest)).retrieval;
  if (outcome.candidate.baseHead !== manifest.baseHead || outcome.candidate.treeFingerprint !== manifest.treeFingerprint ||
      manifest.baseHead !== grant.base.head || outcome.clusters.some(entry => entry.status === 'failed') ||
      !outcome.clusters.some(entry => entry.status === 'verified-local')) {
    revokePreapproval(tx, job, grant.actorId, now);
    return;
  }
  // Completion reports are not a substitute for a subsequent prepared-checkout heartbeat.
  if (grant.preparedHeartbeatAt === undefined || grant.preparedHeartbeatAt <= grant.testedAt ||
      now - grant.preparedHeartbeatAt >= 45_000 || grant.preparedHeartbeatAt > now ||
      device.lastSeenAt === null || device.lastSeenAt <= grant.testedAt ||
      device.lastSeenAt > now || now - device.lastSeenAt >= 45_000 || !device.bridgeAvailable ||
      device.holdReason !== 'prepared-candidate') return;
  if (!device.checkout || !device.workspace || device.checkout.head !== candidate.head ||
      device.checkout.tree !== candidate.tree || device.workspace.head !== candidate.head ||
      device.workspace.tree !== candidate.tree || device.workspace.packetSha256 !== grant.manifestSha256) {
    revokePreapproval(tx, job, grant.actorId, now);
    return;
  }
  if (tx.state.jobs.some(entry => entry.parentRepairId === job.id)) {
    revokePreapproval(tx, job, grant.actorId, now);
    return;
  }
  if (tx.state.jobs.length >= 500 || tx.state.jobs.some(entry => entry.state === 'unknown' ||
      entry.lease?.deployStartedAt !== undefined || (entry.deviceId === device.id &&
      ['queued', 'leased', 'paused'].includes(entry.state)))) return;
  const requestId = randomUUID();
  applyAdminCommand(tx, grant.actorId, {
    op: 'approve-deploy', requestId, repairJobId: job.id, candidate,
    confirmation: true, releaseMode: grant.releaseMode,
  }, now, undefined, true);
  grant.state = 'consumed';
  grant.deployJobId = requestId;
  auditPreapproval(tx, job, 'deploy-preapproval-consumed', grant.actorId, now);
  tx.audit({ at: now, actor: grant.actorId, event: 'auto-exact-candidate-deploy-approved',
    jobId: requestId, deviceId: job.deviceId, candidate, releaseMode: grant.releaseMode });
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

function assertFreshDevice(device: FixerrorsDevice, now: number, requireCheckout = true): void {
  if (device.lastSeenAt === null || device.lastSeenAt > now || now - device.lastSeenAt >= 45_000 ||
      (requireCheckout && !device.workspace && !device.checkout)) deny('Device offline or checkout unavailable');
}

function assertOptIn(device: FixerrorsDevice, action: FixerrorsJob['action']): void {
  if ((action === 'review' && !device.allowReadOnly) ||
      (action === 'repair' && !device.allowRepair) ||
      (action === 'deploy' && !device.allowDeploy)) deny('Device has not opted into this action');
}

export type PreparedFixerrorsEvidence = { checkout: Checkout; packet: string | null; batch?: CapturedBatch };

function updateBatchProgress(job: FixerrorsJob): void {
  const batch = job.privateBatch;
  if (!batch) return;
  const outcomes = batch.outcome?.clusters ?? (batch.checkpoint?.outcome
    ? validateBatchOutcome(batch, batch.checkpoint.outcome, job.id, false).clusters : []);
  const latest = outcomes.at(-1);
  const latestEvidence = latest && parseBatchBytes(Buffer.from(batch.manifest)).retrieval.clusters
    .find(entry => entry.id === latest.id);
  job.batch = {
    captured: batch.delivery.clusters, rows: batch.delivery.rows, processed: outcomes.length,
    remaining: batch.delivery.clusters - outcomes.length,
    counts: {
      'verified-local': outcomes.filter(entry => entry.status === 'verified-local').length,
      held: outcomes.filter(entry => entry.status === 'held').length,
      'report-only': outcomes.filter(entry => entry.status === 'report-only').length,
      failed: outcomes.filter(entry => entry.status === 'failed').length,
    },
    lifecycle: batch.lifecycle?.state ?? 'pending',
    triage: {
      Routine: outcomes.filter(entry => entry.triage?.importance === 'Routine').length,
      Important: outcomes.filter(entry => !entry.triage || entry.triage.importance === 'Important').length,
      Urgent: outcomes.filter(entry => entry.triage?.importance === 'Urgent').length,
    },
    ...(latest?.triage && latest.timings ? { latest: {
      importance: latest.triage.importance, reason: latest.triage.reason, effort: latest.triage.effort,
      route: latestEvidence?.existingState === 'awaiting-deployment' ? 'deployment-verification' as const : latest.status,
      ...(latest.reason === 'worker-provider-limit' || latest.reason === 'worker-execution-failed'
        ? { diagnostic: latest.reason } : {}),
      ...latest.timings,
    } } : {}),
    ...(batch.lifecycle?.reason ? { lifecycleReason: batch.lifecycle.reason } : {}),
  };
}

export function applyAdminCommand(
  tx: QueueTransaction, actor: string, command: AdminCommand, now: number, evidence?: PreparedFixerrorsEvidence,
  automatic = false,
) {
  const { state } = tx;
  expireJobs(state, now);
  expirePreapprovals(tx, now);
  if (command.op === 'revoke-preapproval') {
    const job = state.jobs.find(entry => entry.id === command.jobId);
    if (!job?.autoDeployPreapproval) deny('Run has no automatic deployment pre-approval');
    revokePreapproval(tx, job, actor, now);
    return { ok: true as const };
  }
  if (command.op === 'cancel') {
    const job = state.jobs.find(entry => entry.id === command.jobId);
    if (!job || !['queued', 'leased', 'paused'].includes(job.state) || job.action === 'deploy') deny('Run cannot be cancelled');
    revokePreapproval(tx, job, actor, now);
    job.state = 'blocked';
    job.reason = 'local-opt-out';
    job.lease = null;
    tx.audit({ at: now, actor, event: 'run-cancelled', jobId: job.id, deviceId: job.deviceId });
    return { ok: true as const };
  }
  if (command.op === 'revoke-device') {
    const device = deviceById(state, command.deviceId);
    device.revoked = true;
    for (const job of state.jobs.filter(entry => entry.deviceId === device.id && entry.autoDeployPreapproval)) {
      const release = state.jobs.find(entry => entry.parentRepairId === job.id);
      if (!release || (['queued', 'leased'].includes(release.state) && release.lease?.deployStartedAt === undefined)) {
        revokePreapproval(tx, job, actor, now);
      }
    }
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
    if (command.confirmation !== true || !releaseModeSchema.safeParse(command.releaseMode).success) {
      deny('Explicit confirmation and a supported release mode are required', 400);
    }
    parent = state.jobs.find((job) => job.id === command.repairJobId);
    if (!parent || parent.action !== 'repair' || parent.state !== 'tested' || !parent.candidate || !parent.checks ||
        !sameCandidate(parent.candidate, command.candidate) ||
        checkEvidenceDigest(parent.checks) !== command.candidate.checksSha256) deny('Tested candidate mismatch');
    if (parent.privateBatch && parent.batch?.lifecycle !== 'applied') deny('Batch lifecycle requires reconciliation before Deploy');
    if (state.jobs.some((job) => job.parentRepairId === parent?.id)) deny('Candidate already approved');
  }
  const deviceId = command.op === 'enqueue' ? command.deviceId : parent?.deviceId;
  if (!deviceId) deny('Repair device unavailable');
  const device = deviceById(state, deviceId);
  assertFreshDevice(device, now);
  const action = command.op === 'enqueue' ? command.action : 'deploy';
  assertNoUnconfirmedRelease(state, action);
  assertOptIn(device, action);
  if (state.jobs.some((job) => job.deviceId === device.id && (isActive(job) || job.state === 'paused'))) deny('Device already has an active job');
  let packet: string | undefined;
  let workspace = device.workspace;
  if (command.op === 'enqueue') {
    if (command.autoDeployConfirmation && (command.action !== 'repair' || !command.requestedReleaseMode ||
        command.reviewJobId || !evidence?.batch)) deny('Pre-approval requires a fresh repair batch and explicit validation mode', 400);
    if (command.autoDeployConfirmation && (!device.allowReadOnly || !device.allowDeploy || !device.bridgeAvailable)) {
      deny('Automatic Deploy requires all device opt-ins and an available bridge');
    }
    if (device.holdReason) deny(`Runner held: ${device.holdReason}`);
    if (state.jobs.some(job => job.deviceId === device.id && job.privateBatch?.outcome &&
        job.batch?.lifecycle !== 'applied')) deny('Previous batch lifecycle requires reconciliation');
    if (state.jobs.some(job => job.deviceId === device.id && job.state === 'tested' &&
        !state.jobs.some(release => release.parentRepairId === job.id && release.state === 'deployed'))) {
      deny('A tested candidate awaits separate deployment or owner reconciliation');
    }
    if (command.reviewJobId) {
      const review = state.jobs.find(job => job.id === command.reviewJobId && job.deviceId === device.id);
      const current = device.checkout ?? device.workspace;
      if (command.action !== 'repair' || !review || review.action !== 'review' || review.state !== 'reviewed' ||
          !review.packet || now < review.createdAt || now - review.createdAt > 30 * 60_000 ||
          !current || current.head !== review.workspace.head || current.tree !== review.workspace.tree ||
          (evidence?.packet != null && evidence.packet !== review.packet)) {
        deny('Reviewed evidence is unavailable or the checkout changed; request a fresh review');
      }
      packet = evidence?.packet === null ? undefined : review.packet;
      workspace = { ...review.workspace };
    } else if (evidence) {
      const current = device.checkout ?? device.workspace;
      if (!current || current.head !== evidence.checkout.head || current.tree !== evidence.checkout.tree) {
        deny('Checkout changed during evidence capture');
      }
      packet = evidence.packet ?? undefined;
      workspace = { ...evidence.checkout, packetSha256: hash(evidence.packet ?? '') };
    }
  }
  if (!workspace) deny('Clean checkout unavailable');
  if (parent?.candidate && (workspace.head !== parent.candidate.head || workspace.tree !== parent.candidate.tree)) {
    deny('Stale tested candidate');
  }
  const job: FixerrorsJob = {
    id: command.requestId, deviceId: device.id, action,
    state: evidence?.packet === null && !evidence.batch?.delivery.rows ? 'no-work' : 'queued', requestedBy: actor,
    createdAt: now, expiresAt: now + (action === 'repair' ? 600_000 : 300_000), workspace: { ...workspace },
    parentRepairId: parent?.id ?? null,
    candidate: parent?.candidate ?? null, checks: parent?.checks ?? null,
    approval: command.op === 'approve-deploy'
      ? { actorId: actor, confirmedAt: now, candidate: { ...command.candidate }, releaseMode: command.releaseMode } : null,
    lease: null, reason: null,
    ...(command.op === 'enqueue' && command.requestedReleaseMode ? { requestedReleaseMode: command.requestedReleaseMode } : {}),
    ...(packet ? { packet } : {}),
    ...(evidence?.batch ? { privateBatch: evidence.batch } : {}),
  };
  if (automatic && parent?.autoDeployPreapproval) {
    job.expiresAt = Math.min(job.expiresAt, parent.autoDeployPreapproval.expiresAt);
  }
  if (evidence?.batch) {
    job.workspace.packetSha256 = evidence.batch.delivery.manifestSha256;
    if (job.state === 'no-work') evidence.batch.lifecycle = { state: 'applied', plan: null, receipts: {} };
    updateBatchProgress(job);
    if (command.op === 'enqueue' && command.autoDeployConfirmation && command.requestedReleaseMode) {
      job.autoDeployPreapproval = {
        version: 1, actorId: actor, runId: job.id, deviceId: device.id,
        base: { head: job.workspace.head, tree: job.workspace.tree, clean: true },
        manifestSha256: evidence.batch.delivery.manifestSha256, releaseMode: command.requestedReleaseMode,
        grantedAt: now, expiresAt: now + FIXERRORS_PREAPPROVAL_MS, state: 'pending',
      };
    }
  }
  if (parent?.autoDeployPreapproval && !automatic) revokePreapproval(tx, parent, actor, now);
  state.jobs.push(job);
  if (job.autoDeployPreapproval) auditPreapproval(tx, job, 'deploy-preapproval-granted', actor, now);
  if (job.state === 'no-work') revokePreapproval(tx, job, actor, now);
  tx.audit({
    at: now, actor, event: action === 'deploy' ? (automatic ? 'automatic-deploy-queued' : 'exact-candidate-deploy-confirmed')
      : `${action}-${job.state === 'no-work' ? 'no-work' : 'requested'}`,
    jobId: job.id, deviceId: device.id,
    ...(job.approval ? { candidate: job.approval.candidate, releaseMode: job.approval.releaseMode } : {}),
  });
  return { ok: true as const, jobId: job.id, noWork: job.state === 'no-work' };
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
  issueBatchLease?: (job: Readonly<FixerrorsJob>, checkpoint: BatchCheckpoint, now: number) => string,
) {
  const { state } = tx;
  const device = authenticate(state, id, credential);
  expireJobs(state, now);
  expirePreapprovals(tx, now);
  const audit = (event: string, jobId: string | null) => tx.audit({ at: now, actor: id, event, jobId, deviceId: id });
  if (command.op === 'heartbeat') {
    Object.assign(device, {
      lastSeenAt: now, workspace: command.workspace,
      allowReadOnly: command.allowReadOnly, allowRepair: command.allowRepair,
      allowDeploy: command.allowDeploy, bridgeAvailable: command.bridgeAvailable,
      checkout: command.checkout ?? null, holdReason: command.holdReason ?? null,
    });
    for (const job of state.jobs.filter(entry => entry.deviceId === id && entry.autoDeployPreapproval)) {
      const grant = job.autoDeployPreapproval!;
      if (!['pending', 'consumed'].includes(grant.state)) continue;
      const release = state.jobs.find(entry => entry.parentRepairId === job.id);
      if (release && (release.lease?.deployStartedAt !== undefined || !['queued', 'leased'].includes(release.state))) continue;
      const candidate = grant.testedCandidate;
      const changedCheckout = job.state === 'tested' && candidate && (!device.checkout ||
        device.checkout.head !== candidate.head || device.checkout.tree !== candidate.tree ||
        !device.workspace || device.workspace.head !== candidate.head || device.workspace.tree !== candidate.tree ||
        device.workspace.packetSha256 !== grant.manifestSha256);
      if (!device.allowReadOnly || !device.allowRepair || !device.allowDeploy || changedCheckout) {
        revokePreapproval(tx, job, id, now);
      } else if (grant.state === 'pending' && job.state === 'tested' && grant.testedAt !== undefined &&
          now > grant.testedAt && device.holdReason === 'prepared-candidate' && device.bridgeAvailable) {
        grant.preparedHeartbeatAt = now;
      }
    }
    audit('device-heartbeat', null);
    return { ok: true as const };
  }
  assertFreshDevice(device, now, false);
  device.lastSeenAt = now;
  if (command.op === 'claim') {
    if (state.jobs.some((job) => job.deviceId === id && job.state === 'leased')) deny('Job already leased');
    const job = state.jobs.find((entry) => entry.deviceId === id && ['queued', 'paused'].includes(entry.state));
    if (!job) return { ok: true as const, claim: null };
    assertNoUnconfirmedRelease(state, job.action);
    assertOptIn(device, job.action);
    if (job.action === 'deploy' && device.holdReason && device.holdReason !== 'prepared-candidate') deny('Runner execution outcome requires reconciliation');
    const current = device.checkout ?? device.workspace;
    const resuming = job.state === 'paused';
    if (resuming && (!job.privateBatch?.stopped || !job.privateBatch.checkpoint)) deny('Batch stop is not confirmed');
    if (!resuming) assertFreshDevice(device, now);
    if (!resuming && (job.packet || job.privateBatch
      ? !current || device.holdReason || current.head !== job.workspace.head || current.tree !== job.workspace.tree
      : !device.workspace || !sameWorkspace(job.workspace, device.workspace))) deny('Checkout changed since request');
    if (job.action === 'deploy' && (!job.approval || !job.candidate ||
        !sameCandidate(job.approval.candidate, job.candidate) ||
        !device.workspace || job.candidate.head !== device.workspace.head || job.candidate.tree !== device.workspace.tree)) {
      deny('Deploy approval mismatch');
    }

    const leaseToken = randomBytes(32).toString('base64url');
    job.state = 'leased';
    job.lease = { tokenSha256: hash(leaseToken), until: job.privateBatch ? now + LEASE_MS : Math.min(now + LEASE_MS, job.expiresAt) };
    // Fresh short admission on a confirmed resume; old signed tickets are never extended.
    const admittedJob = structuredClone(job);
    if (resuming) admittedJob.expiresAt = now + (job.action === 'repair' ? 600_000 : 300_000);
    const admissionTicket = job.action === 'deploy' ? undefined : issueAdmission?.(admittedJob, now);
    if (issueAdmission && job.action !== 'deploy' && !admissionTicket) deny('Signed admission unavailable', 503);
    audit('job-claimed', job.id);
    const { packet: privatePacket, privateBatch, autoDeployPreapproval: _grant, ...claimed } = structuredClone(job);
    if (resuming) claimed.expiresAt = admittedJob.expiresAt;
    return { ok: true as const, claim: { job: claimed, leaseToken,
      ...(privateBatch ? { batch: privateBatch.delivery, resume: resuming } : {}),
      ...(privatePacket ? { packet: privatePacket } : {}), ...(admissionTicket ? { admissionTicket } : {}) } };
  }
  if (command.op === 'batch-reconcile') {
    const job = state.jobs.find(entry => entry.id === command.jobId && entry.deviceId === id);
    if (!job?.privateBatch?.outcome || ['queued', 'leased', 'paused'].includes(job.state)) deny('Batch completion unavailable');
    const deployed = state.jobs.find(entry => entry.parentRepairId === job.id && entry.state === 'deployed');
    const { packet: _packet, privateBatch: _batch, autoDeployPreapproval: _grant, ...completion } = deployed ?? job;
    return { ok: true as const, completion: {
      job: structuredClone(completion), outcomeSha256: batchOutcomeHash(job.privateBatch.outcome),
    } };
  }
  const job = state.jobs.find((entry) => entry.id === command.jobId && entry.deviceId === id);
  if (!job || job.state !== 'leased' || !job.lease ||
      !timingSafeEqual(Buffer.from(job.lease.tokenSha256, 'hex'), Buffer.from(hash(command.leaseToken), 'hex'))) {
    deny('Lease lost or not owned');
  }
  assertOptIn(device, job.action);
  if (command.op === 'batch-chunk') {
    if (!job.privateBatch) deny('Batch unavailable');
    return { ok: true as const, chunk: readBatchChunk(job.privateBatch, command.index) };
  }
  if (command.op === 'batch-lease') {
    const batch = job.privateBatch;
    if (!batch || !issueBatchLease || command.cursor > batch.delivery.clusters) deny('Batch authority unavailable');
    const previous = batch.checkpoint;
    if (command.resume !== Boolean(batch.stopped) ||
        (previous && (command.cursor < previous.cursor || command.cursor > previous.cursor + 1 ||
          (command.cursor === previous.cursor && command.checkpointSha256 !== previous.checkpointSha256)))) {
      deny('Batch checkpoint or resume authority mismatch');
    }
    if (command.cursor > 0) {
      // The wire carries only the newest result, not an ever-growing prefix.
      const delta = command.outcome as { runId?: unknown; candidate?: unknown; clusters?: unknown[]; decisions?: unknown[] } | undefined;
      if (!delta || !Array.isArray(delta.clusters) || !Array.isArray(delta.decisions) ||
          delta.clusters.length !== 1 || delta.decisions.length > 1) deny('Invalid checkpoint delta');
      const prior = previous?.outcome ? validateBatchOutcome(batch, previous.outcome, job.id, false) : undefined;
      const sameCursor = previous?.cursor === command.cursor;
      const outcome = validateBatchOutcome(batch, {
        ...delta, clusters: [...(prior?.clusters.slice(0, sameCursor ? -1 : undefined) ?? []), ...delta.clusters],
        decisions: [...(prior?.decisions.filter(entry => entry.id !==
          (delta.clusters![0] as { id?: unknown }).id) ?? []), ...delta.decisions],
      }, job.id, false);
      if (outcome.clusters.length !== command.cursor) deny('Batch cursor coverage mismatch');
      if (previous?.outcome) {
        const priorOutcome = validateBatchOutcome(batch, previous.outcome, job.id, false);
        // JSONB may reorder object keys. Bind the completed content, including
        // array order, rather than the incidental serialization key order.
        if (batchOutcomeHash(outcome.clusters.slice(0, priorOutcome.clusters.length)) !== batchOutcomeHash(priorOutcome.clusters) ||
            batchOutcomeHash(outcome.decisions.slice(0, priorOutcome.decisions.length)) !== batchOutcomeHash(priorOutcome.decisions)) {
          deny('Completed batch prefix changed');
        }
      }
      command.outcome = outcome;
    } else if (command.outcome !== undefined && command.outcome !== null) {
      const empty = validateBatchOutcome(batch, command.outcome, job.id, false);
      if (empty.clusters.length || empty.decisions.length) deny('Unexpected empty checkpoint outcome');
      command.outcome = empty;
    }
    const checkpoint = { checkpointSha256: command.checkpointSha256, cursor: command.cursor,
      ...(command.outcome ? { outcome: command.outcome } : {}), resume: command.resume };
    const batchLease = issueBatchLease(structuredClone(job), checkpoint, now);
    batch.checkpoint = checkpoint;
    batch.sequence++;
    batch.started = true;
    batch.stopped = false;
    job.lease.until = now + LEASE_MS;
    updateBatchProgress(job);
    audit('batch-authority-renewed', job.id);
    return { ok: true as const, batchLease, leaseUntil: job.lease.until };
  }
  if (command.op === 'pause-batch') {
    if (!job.privateBatch?.checkpoint || command.checkpointSha256 !== job.privateBatch.checkpoint.checkpointSha256) {
      deny('Stopped checkpoint mismatch');
    }
    job.privateBatch.stopped = true;
    job.state = 'paused';
    job.lease = null;
    audit('batch-stopped-at-checkpoint', job.id);
    return { ok: true as const };
  }
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
  if (job.privateBatch) {
    if (!['reviewed', 'no-change', 'tested', 'blocked', 'failed'].includes(result.status)) deny('Invalid batch result');
    if (['reviewed', 'no-change', 'tested'].includes(result.status)) {
      const outcome = validateBatchOutcome(job.privateBatch, job.privateBatch.checkpoint?.outcome, job.id, true);
      if (batchOutcomeHash(outcome) !== command.outcomeSha256) deny('Completed outcome hash mismatch');
      if ((outcome.clusters.some(entry => entry.status === 'verified-local') && result.status !== 'tested') ||
          (result.status === 'tested' && !outcome.clusters.some(entry => entry.status === 'verified-local'))) {
        deny('Aggregate preparation does not match repaired outcomes');
      }
      job.privateBatch.outcome = outcome;
      updateBatchProgress(job);
    }
  } else if (command.outcomeSha256 !== undefined) deny('Unexpected batch outcome');
  if (result.status === 'no-change' && job.action !== 'repair') deny('Wrong result for action');
  if ((result.status === 'deployed' || result.status === 'unknown') && job.lease.deployStartedAt === undefined) {
    deny('Deployment has not started');
  }
  if (result.status === 'tested') {
    if (job.action !== 'repair' || result.candidate.head !== result.checks.head ||
        result.candidate.tree !== result.checks.tree ||
        result.candidate.checksSha256 !== checkEvidenceDigest(result.checks)) deny('Invalid test evidence');
    job.candidate = result.candidate;
    job.checks = result.checks;
    if (job.autoDeployPreapproval?.state === 'pending') {
      job.autoDeployPreapproval.testedAt = now;
      job.autoDeployPreapproval.testedCandidate = { ...result.candidate };
    }
    device.workspace = { ...job.workspace, head: result.candidate.head, tree: result.candidate.tree };
    if (device.checkout) device.checkout = { head: result.candidate.head, tree: result.candidate.tree, clean: true };
  } else if (result.status === 'reviewed' && job.action !== 'review') {
    deny('Wrong result for action');
  } else if (result.status === 'deployed') {
    if (job.action !== 'deploy' || !job.candidate || !job.approval ||
        !sameCandidate(job.candidate, result.candidate) ||
        !sameCandidate(job.approval.candidate, result.candidate)) deny('Wrong deployed candidate');
  }
  job.state = result.status;
  if (!['tested', 'deployed'].includes(result.status)) revokePreapproval(tx, job, id, now);
  if (result.status === 'failed' && result.diagnostic) job.diagnostic = result.diagnostic;
  job.reason = result.status === 'blocked' || result.status === 'failed' || result.status === 'unknown' ? result.reason : null;
  job.lease = null;
  audit(`job-${job.state}`, job.id);
  return { ok: true as const };
}
