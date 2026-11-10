import { createHash } from 'crypto';
import { FIXERRORS_COMPANION_PACKET_MAX_BYTES } from '../../lib/fixerrors/admission';
import { execFileSync } from 'child_process';
import { openSync, closeSync, readSync, fstatSync, lstatSync, unlinkSync, writeSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { z } from 'zod';
import {
  FIXERRORS_DEPLOY_TIMEOUT_MS, FIXERRORS_DEVICE_PATH, FIXERRORS_LOCAL_ORIGIN, FIXERRORS_PRODUCTION_ORIGIN, deviceResponseSchema,
  sameCandidate, sameWorkspace, type Candidate, type ClaimedJob, type DeviceCommand,
  type ExecutionResult, type FixerrorsJob, type Workspace,
} from '../../lib/fixerrors/protocol';
import { checkEvidenceDigest } from '../../lib/fixerrors/control';
import { FIXERRORS_WORKSPACE, inspectFixedFixerrorsWorkspace } from './fixerrors-device-admission';
import { createProductionReleaseBridge, parseProductionBridgeEnrollment } from './fixerrors-production-bridge';
import { parseCompanionPacket } from './fixerrors-companion-packet';

export interface CompanionConsent {
  allowReadOnly: boolean;
  allowRepair: boolean;
  allowDeploy: boolean;
}

export interface TrustedFixerrorsExecutor {
  readonly available: boolean;
  // A future bridge must verify v1 admission, durable replay and scoped checks here.
  // No downloaded module, command, prompt or argv is accepted by this interface.
  execute(job: Readonly<FixerrorsJob>, signal: AbortSignal, releaseTicket?: string, admissionTicket?: string): Promise<ExecutionResult>;
  localTestedCandidate(): Candidate | null;
}

export const unavailableFixerrorsExecutor: TrustedFixerrorsExecutor = Object.freeze({
  available: false,
  async execute() { return { status: 'blocked' as const, reason: 'bridge-unavailable' as const }; },
  localTestedCandidate() { return null; },
});

export interface CompanionDependencies {
  executor: TrustedFixerrorsExecutor;
  consent(): CompanionConsent;
  inspect(): Workspace | null;
  startDeploy(): Promise<{ releaseTicket?: string } | void>;
  renew(): Promise<void>;
  complete(result: ExecutionResult): Promise<void>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function consentAllows(consent: CompanionConsent, action: FixerrorsJob['action']): boolean {
  return action === 'review' ? consent.allowReadOnly : action === 'repair' ? consent.allowRepair : consent.allowDeploy;
}

export async function executeCompanionClaim(claim: ClaimedJob, deps: CompanionDependencies): Promise<void> {
  const assertNotStopping = () => {
    if (deps.signal?.aborted) throw new UnsafeCompanionStop();
  };
  assertNotStopping();
  const { job } = claim;
  let releaseTicket: string | undefined;
  let early: ExecutionResult | null = null;
  const workspace = deps.inspect();
  if (!consentAllows(deps.consent(), job.action)) early = { status: 'blocked', reason: 'local-opt-out' };
  else if (!workspace || !sameWorkspace(workspace, job.workspace)) early = { status: 'blocked', reason: 'checkout-drift' };
  else if (!deps.executor.available) early = { status: 'blocked', reason: 'bridge-unavailable' };
  else if (job.action === 'deploy') {
    const local = deps.executor.localTestedCandidate();
    if (!job.approval || !job.candidate || !job.checks || !local ||
        !sameCandidate(job.approval.candidate, job.candidate) || !sameCandidate(local, job.candidate) ||
        job.candidate.head !== workspace.head || job.candidate.tree !== workspace.tree ||
        checkEvidenceDigest(job.checks) !== job.candidate.checksSha256) {
      early = { status: 'blocked', reason: 'checkout-drift' };
    }
  }
  // An uncertain renew never dispatches. The server owns expiry and lease ownership.
  await deps.renew();
  assertNotStopping();
  if (early) {
    await deps.complete(early);
    return;
  }
  const latestWorkspace = deps.inspect();
  if (!latestWorkspace || !sameWorkspace(latestWorkspace, job.workspace) ||
      !consentAllows(deps.consent(), job.action)) {
    await deps.complete({ status: 'blocked', reason: 'checkout-drift' });
    return;
  }
  if (job.action === 'deploy') {
    const latestCandidate = deps.executor.localTestedCandidate();
    if (!latestCandidate || !job.candidate || !sameCandidate(latestCandidate, job.candidate)) {
      await deps.complete({ status: 'blocked', reason: 'checkout-drift' });
      return;
    }
    // Claiming alone does not consume the start window or authorize execution.
    const started = await deps.startDeploy();
    assertNotStopping();
    releaseTicket = started?.releaseTicket;
    const startedWorkspace = deps.inspect();
    if (!startedWorkspace || !sameWorkspace(startedWorkspace, job.workspace) || !deps.consent().allowDeploy) {
      await deps.complete({ status: 'blocked', reason: 'checkout-drift' });
      return;
    }
  }
  const controller = new AbortController();
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let pendingRenewal: Promise<void> | undefined;
  let settling = false;
  let stopped: 'timeout' | 'lease-lost' | 'shutdown' | null = null;
  let stop!: (result: ExecutionResult) => void;
  const stopSignal = new Promise<ExecutionResult>((resolve) => { stop = resolve; });
  const abort = (reason: 'timeout' | 'lease-lost' | 'shutdown') => {
    if (!stopped || reason === 'shutdown') stopped = reason;
    controller.abort();
    stop({ status: 'blocked', reason: reason === 'shutdown' ? 'execution-failed' : reason });
  };
  const shutdown = () => abort('shutdown');
  deps.signal?.addEventListener('abort', shutdown, { once: true });
  if (deps.signal?.aborted) shutdown();
  const scheduleRenewal = () => {
    heartbeat = setTimeout(() => { pendingRenewal = renew(); }, 15_000);
  };
  const renew = async () => {
    try {
      await deps.renew();
      if (!settling && !controller.signal.aborted) scheduleRenewal();
    } catch {
      abort('lease-lost');
    }
  };
  scheduleRenewal();
  const maxRuntime = job.action === 'deploy' ? FIXERRORS_DEPLOY_TIMEOUT_MS
    : Math.min(job.action === 'repair' ? 480_000 : 120_000, Math.max(1, job.expiresAt - Date.now() - 10_000));
  const unconfirmed = { status: 'unknown', reason: 'release-unconfirmed' } as const;
  const timeout = setTimeout(() => abort('timeout'), Math.min(deps.timeoutMs ?? maxRuntime, maxRuntime));
  let executionSettled = false;
  const execution = Promise.resolve().then(() => {
    assertNotStopping();
    return deps.executor.execute(Object.freeze(structuredClone(job)), controller.signal, releaseTicket, claim.admissionTicket);
  })
    .catch((): ExecutionResult => job.action === 'deploy' ? unconfirmed : { status: 'failed', reason: 'execution-failed' })
    .finally(() => { executionSettled = true; });
  try {
    let result = await Promise.race([execution, stopSignal]);
    settling = true;
    clearTimeout(heartbeat);
    clearTimeout(timeout);
    await pendingRenewal;
    if (stopped) {
      // Never release the checkout lock while an executor might still be writing.
      if (!executionSettled) await Promise.race([
        execution,
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(() => reject(new UnsafeCompanionStop()), 5000);
          timer.unref();
        }),
      ]);
      if (stopped === 'lease-lost') throw new Error('Companion lease lost; result not acknowledged');
      if (stopped === 'shutdown') throw new UnsafeCompanionStop();
      if (job.action === 'deploy') result = unconfirmed;
    } else {
      await deps.renew();
      assertNotStopping();
      if (job.action === 'deploy' && result.status === 'deployed') {
        const after = deps.inspect();
        if (!after || !job.candidate || after.head !== job.candidate.head || after.tree !== job.candidate.tree) {
          result = unconfirmed;
        }
      }
    }
    assertNotStopping();
    await deps.complete(result);
  } finally {
    controller.abort();
    clearTimeout(heartbeat);
    clearTimeout(timeout);
    deps.signal?.removeEventListener('abort', shutdown);
  }
}

class UnsafeCompanionStop extends Error {
  constructor() { super('Claimed execution stopped without a confirmed result; checkout lock retained for owner investigation'); }
}

const localCredentialSchema = z.object({
  deviceId: z.string().uuid(),
  credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
}).strict();

function readProtectedEnrollment(file: 'device.dpapi' | 'production-device.dpapi'): unknown {
  if (process.platform !== 'win32') throw new Error('Windows required');
  const powershell = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  const text = execFileSync(powershell, [
    '-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop'; $p=Join-Path $env:LOCALAPPDATA 'Squires\\Fixerrors\\${file}'; ` +
    '$s=Get-Content -LiteralPath $p -Raw | ConvertTo-SecureString; ' +
    '$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); ' +
    'try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))} ' +
    'finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}',
  ], { encoding: 'utf8', timeout: 10_000, maxBuffer: 4096, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(text);
}

export function readProtectedFixerrorsCredential() {
  return localCredentialSchema.parse(readProtectedEnrollment('device.dpapi'));
}

export function inspectCompanionWorkspace(): Workspace | null {
  const evidence = inspectFixedFixerrorsWorkspace();
  if (evidence.branch !== 'main' || evidence.porcelain || evidence.workspace !== FIXERRORS_WORKSPACE ||
      evidence.topLevel !== FIXERRORS_WORKSPACE ||
      evidence.gitDirectory !== path.win32.join(FIXERRORS_WORKSPACE, '.git')) return null;
  const packet = path.win32.join(FIXERRORS_WORKSPACE, '.git\\squires-fixerrors\\sanitized-packet.json');
  const file = openSync(packet, 'r');
  try {
    const stat = fstatSync(file);
    if (!stat.isFile() || stat.size > FIXERRORS_COMPANION_PACKET_MAX_BYTES) throw new Error('Sanitized packet must be a bounded local file');
    const bytes = Buffer.alloc(FIXERRORS_COMPANION_PACKET_MAX_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(file, bytes, size, bytes.length - size, size);
      if (count === 0) break;
      size += count;
    }
    if (size > FIXERRORS_COMPANION_PACKET_MAX_BYTES || fstatSync(file).size !== size) throw new Error('Sanitized packet changed or too large');
    // A successful repair retains its original packet while preparing two new
    // commits. Per-action signed/native guards validate review/repair binding;
    // deployment validates the exact prepared candidate and check evidence.
    parseCompanionPacket(bytes.subarray(0, size));
    return { head: evidence.head, tree: evidence.tree, clean: true, packetSha256: createHash('sha256').update(bytes.subarray(0, size)).digest('hex') };
  } finally {
    closeSync(file);
  }
}

export async function companionDeviceRequest(
  enrollment: z.infer<typeof localCredentialSchema>, command: DeviceCommand,
  origin: typeof FIXERRORS_LOCAL_ORIGIN | typeof FIXERRORS_PRODUCTION_ORIGIN = FIXERRORS_LOCAL_ORIGIN,
): Promise<z.infer<typeof deviceResponseSchema>> {
  if (origin !== FIXERRORS_LOCAL_ORIGIN && origin !== FIXERRORS_PRODUCTION_ORIGIN) throw new Error('Unexpected Fixerrors origin');
  const response = await fetch(`${origin}${FIXERRORS_DEVICE_PATH}`, {
    method: 'POST', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10_000),
    headers: {
      'Content-Type': 'application/json', 'X-Squires-Device-Id': enrollment.deviceId,
      Authorization: `Bearer ${enrollment.credential}`,
    },
    body: JSON.stringify(command),
  });
  if (!response.body) throw new Error('Empty companion response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > 16_384) {
        await reader.cancel();
        throw new Error('Companion response exceeds limit');
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!response.ok) throw new Error(`Companion request rejected (${response.status}); stopped`);
  return deviceResponseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

export function releaseOwnedCompanionLock(lock: number, lockPath: string): void {
  const held = fstatSync(lock, { bigint: true });
  const current = lstatSync(lockPath, { bigint: true });
  if (!current.isFile() || current.isSymbolicLink() || held.dev !== current.dev || held.ino !== current.ino) {
    throw new Error('Companion lock identity changed; not removed');
  }
  unlinkSync(lockPath);
}

export async function runFixerrorsCompanion(signal?: AbortSignal): Promise<void> {
  if (process.platform !== 'win32' || process.env.SQUIRES_FIXERRORS_COMPANION_ENABLED !== '1') {
    throw new Error('Companion requires explicit local Windows opt-in');
  }
  if (signal?.aborted) return;
  // Inspect the fixed checkout before creating its lock; no site-supplied paths.
  inspectFixedFixerrorsWorkspace();
  const lockPath = path.win32.join(FIXERRORS_WORKSPACE, '.git\\squires-fixerrors-companion.lock');
  const lock = openSync(lockPath, 'wx');
  let unsafe = false;
  let activeClaim = false;
  const state = (value: 'ready' | 'packet-blocked' | 'bridge-blocked' | 'polling' | 'active' | 'stopping') => {
    if (process.env.SQUIRES_FIXERRORS_MANAGED_STDIN === '1') console.info(`SQUIRES_RUNNER_STATE:${value}`);
  };
  try {
    writeSync(lock, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    const production = process.env.SQUIRES_FIXERRORS_COMPANION_PRODUCTION === '1';
    const enrollment = production
      ? parseProductionBridgeEnrollment(readProtectedEnrollment('production-device.dpapi'))
      : null;
    const credential = enrollment ?? readProtectedFixerrorsCredential();
    const executor = enrollment ? createProductionReleaseBridge(enrollment) : unavailableFixerrorsExecutor;
    const request = (command: DeviceCommand) => companionDeviceRequest(
      credential, command, production ? FIXERRORS_PRODUCTION_ORIGIN : FIXERRORS_LOCAL_ORIGIN,
    );
    const consent = (): CompanionConsent => ({
      allowReadOnly: process.env.SQUIRES_FIXERRORS_ALLOW_READ_ONLY === '1',
      allowRepair: process.env.SQUIRES_FIXERRORS_ALLOW_REPAIR === '1',
      allowDeploy: process.env.SQUIRES_FIXERRORS_ALLOW_DEPLOY === '1',
    });
    console.info(production ? 'MPDEE Worker companion: production signed review/repair/release polling enabled.'
      : 'MPDEE Worker companion: local polling enabled; execution blocked.');
    while (!signal?.aborted) {
      state('polling');
      let workspace: Workspace | null = null;
      try {
        workspace = inspectCompanionWorkspace();
      } catch {
        console.error('MPDEE Worker companion: clean checkout or bounded sanitized packet unavailable; no execution.');
      }
      const optIns = consent();
      await request({
        op: 'heartbeat', workspace, ...optIns, bridgeAvailable: executor.available,
      });
      if (signal?.aborted) break;
      if (!workspace) state('packet-blocked');
      else state(executor.available ? 'ready' : 'bridge-blocked');
      if (workspace) {
        const response = await request({ op: 'claim' });
        if (response.claim) {
          activeClaim = true;
          // An interrupted claim is uncertain, never retried or acknowledged as success.
          if (signal?.aborted) throw new UnsafeCompanionStop();
          state('active');
          const claim = response.claim;
          const lease = { jobId: claim.job.id, leaseToken: claim.leaseToken };
          await executeCompanionClaim(claim, {
            executor, consent, inspect: inspectCompanionWorkspace, signal,
            startDeploy: () => request({ op: 'start-deploy', ...lease }),
            renew: async () => { await request({ op: 'renew', ...lease }); },
            complete: async (result) => { await request({ op: 'complete', ...lease, result }); },
          });
          activeClaim = false;
          console.info(`MPDEE Worker companion: reported result for ${claim.job.id}.`);
        }
      }
      await new Promise<void>((resolve) => {
        const wake = () => { clearTimeout(timer); signal?.removeEventListener('abort', wake); resolve(); };
        const timer = setTimeout(wake, 10_000);
        signal?.addEventListener('abort', wake, { once: true });
        if (signal?.aborted) wake();
      });
    }
  } catch (error) {
    unsafe = activeClaim || error instanceof UnsafeCompanionStop;
    throw error;
  } finally {
    state('stopping');
    try {
      if (!unsafe) releaseOwnedCompanionLock(lock, lockPath);
    } finally {
      closeSync(lock);
    }
  }
}

export function createManagedCompanionStopHandler(stop: () => void): (chunk: Buffer) => void {
  const command = Buffer.from('SQUIRES_RUNNER_STOP\n', 'ascii');
  let matched = 0;
  return (chunk) => {
    if (matched === command.length) return;
    for (const byte of chunk) {
      if (byte !== command[matched]) {
        console.error('Managed companion input invalid; stopping without dispatch.');
        matched = command.length;
        stop();
        return;
      }
      if (++matched === command.length) {
        stop();
        return;
      }
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const managedInput = createManagedCompanionStopHandler(stop);
  if (process.env.SQUIRES_FIXERRORS_MANAGED_STDIN === '1') {
    process.stdin.on('data', managedInput);
    process.stdin.once('end', stop);
  }
  runFixerrorsCompanion(shutdown.signal).catch(() => {
    console.error('MPDEE Worker companion stopped. Check local enrollment, TLS, checkout and lease. No automatic retry or execution.');
    process.exitCode = 1;
  }).finally(() => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    process.stdin.removeListener('data', managedInput);
    process.stdin.removeListener('end', stop);
    process.stdin.pause();
  });
}
