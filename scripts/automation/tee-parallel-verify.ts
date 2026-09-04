/**
 * Bounded parallel READ-ONLY verification runner.
 *
 * Scheduling and terminal UX only. Does not change required checks, PASS/FAIL
 * meaning, ledger/protocol/finalise authority, or candidate identity rules.
 *
 * Inventory (Squires):
 * - review/preflight + fix-delta: candidate/protocol SERIAL; typecheck/lint/suite
 *   READ-ONLY parallel; ledger proof + manifest + protocol record SERIAL.
 * - workflow suite vs changed-file vitest: same isolation group (shared Vite cache).
 * - finalise: read-only inventory may overlap; migration apply / protocol / commit /
 *   version / push stay SERIAL.
 * - DB/protocol jobs are exclusive.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import { captureVerificationIdentity } from './workflow-verification-ledger';
import {
  createTeeProgressReporter,
  notifyDisplayProgress,
  TEE_PROGRESS_DEFAULT_HEARTBEAT_MS,
  type TeeProgressReporter,
  type TeeProgressStatus,
} from './tee-progress';

export const TEE_VERIFY_JOBS_ENV = 'TEE_VERIFY_JOBS';
export const DEFAULT_TEE_VERIFY_JOBS = 3;
export const MAX_TEE_VERIFY_JOBS = 4;

export type TeeVerifyJobKind = 'read_only' | 'mutating' | 'db' | 'protocol';

export interface FrozenVerifyCandidate {
  headCommit: string;
  fingerprint: string;
  workstreamId: string | null;
}

export interface TeeVerifyJob<T = unknown> {
  id: string;
  label: string;
  weight?: number;
  dependsOn?: string[];
  kind?: TeeVerifyJobKind;
  isolationGroup?: string;
  exclusive?: boolean;
  required?: boolean;
  run: () => Promise<T> | T;
}

export interface TeeVerifyJobResult<T = unknown> {
  id: string;
  label: string;
  status: 'passed' | 'failed' | 'skipped';
  required: boolean;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  value?: T;
  error?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
  command?: string;
}

export interface TeeVerifyBatchResult<T = unknown> {
  ok: boolean;
  foundational: boolean;
  foundationalMessage?: string;
  maxJobs: number;
  candidate: FrozenVerifyCandidate | null;
  results: Array<TeeVerifyJobResult<T>>;
  failures: Array<TeeVerifyJobResult<T>>;
  overlapPairs: Array<[string, string]>;
  exclusiveOverlap: Array<[string, string]>;
  peakConcurrency: number;
  heartbeatCount: number;
}

export interface ProcessJobResult {
  status: 'passed' | 'failed';
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  command: string;
  summary: string;
}

type JobRuntime<T> = TeeVerifyJob<T> & {
  kind: TeeVerifyJobKind;
  required: boolean;
  exclusive: boolean;
  weight: number;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
};

export function resolveTeeVerifyJobs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[TEE_VERIFY_JOBS_ENV];
  if (raw === undefined || raw === '') return DEFAULT_TEE_VERIFY_JOBS;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${TEE_VERIFY_JOBS_ENV} must be a positive integer`);
  }
  return Math.min(parsed, MAX_TEE_VERIFY_JOBS);
}

export function jobIsExclusive(job: Pick<TeeVerifyJob, 'kind' | 'exclusive'>): boolean {
  if (job.exclusive) return true;
  return job.kind === 'mutating' || job.kind === 'db' || job.kind === 'protocol';
}

export function captureFrozenVerifyCandidate(params: {
  repoRoot: string;
  workstreamId?: string | null;
}): { ok: true; candidate: FrozenVerifyCandidate } | { ok: false; message: string } {
  const identity = captureVerificationIdentity(params.repoRoot);
  if (!identity.ok) return { ok: false, message: identity.message };
  return {
    ok: true,
    candidate: {
      headCommit: identity.headCommit,
      fingerprint: identity.productTreeFingerprint,
      workstreamId: params.workstreamId ?? null,
    },
  };
}

export function readCurrentVerifyCandidate(repoRoot: string): FrozenVerifyCandidate | { error: string } {
  const captured = captureFrozenVerifyCandidate({ repoRoot });
  if (!captured.ok) return { error: captured.message };
  return captured.candidate;
}

export function candidatesMatch(
  expected: FrozenVerifyCandidate,
  actual: FrozenVerifyCandidate
): boolean {
  return (
    expected.headCommit === actual.headCommit &&
    expected.fingerprint === actual.fingerprint &&
    (expected.workstreamId ?? null) === (actual.workstreamId ?? null)
  );
}

export function assertFrozenCandidate(params: {
  expected: FrozenVerifyCandidate;
  actual: FrozenVerifyCandidate;
}): { ok: true } | { ok: false; message: string } {
  if (params.expected.headCommit !== params.actual.headCommit) {
    return {
      ok: false,
      message: `candidate HEAD drifted: expected ${params.expected.headCommit}, found ${params.actual.headCommit}`,
    };
  }
  if (params.expected.fingerprint !== params.actual.fingerprint) {
    return {
      ok: false,
      message: 'candidate fingerprint drifted; do not combine verification from different trees',
    };
  }
  if ((params.expected.workstreamId ?? null) !== (params.actual.workstreamId ?? null)) {
    return {
      ok: false,
      message: `candidate workstream drifted: expected ${params.expected.workstreamId ?? 'none'}, found ${params.actual.workstreamId ?? 'none'}`,
    };
  }
  return { ok: true };
}

function validateJobGraph<T>(jobs: TeeVerifyJob<T>[]): { ok: true } | { ok: false; message: string } {
  const ids = new Set<string>();
  for (const job of jobs) {
    if (!job.id) return { ok: false, message: 'verification job is missing an id' };
    if (ids.has(job.id)) return { ok: false, message: `duplicate verification job id: ${job.id}` };
    ids.add(job.id);
  }
  for (const job of jobs) {
    for (const dep of job.dependsOn ?? []) {
      if (!ids.has(dep)) {
        return { ok: false, message: `verification job ${job.id} depends on unknown job ${dep}` };
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const visit = (id: string): boolean => {
    if (visited.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (visit(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const job of jobs) {
    if (visit(job.id)) return { ok: false, message: `verification job graph has a cycle at ${job.id}` };
  }
  return { ok: true };
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(' ');
}

function quoteWindowsArg(value: string): string {
  if (!/[\s|&<>^()"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function sanitizeSpawnEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') clean[key] = value;
  }
  return clean as NodeJS.ProcessEnv;
}

export function defaultWindowsHide(): boolean {
  return process.platform !== 'win32';
}

function isSpawnEinval(error: unknown): boolean {
  return error instanceof Error && /EINVAL/i.test(error.message);
}

export type ProcessSpawnImpl = (
  command: string,
  argsOrOptions?: readonly string[] | SpawnOptions,
  options?: SpawnOptions
) => ChildProcess;

export function runProcessJob(params: {
  cwd: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  windowsHide?: boolean;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  spawnImpl?: ProcessSpawnImpl;
}): Promise<ProcessJobResult> {
  const started = Date.now();
  const rendered = formatCommand(params.command, params.args);
  const env = sanitizeSpawnEnv(params.env ?? process.env);
  const spawnFn = params.spawnImpl ?? spawn;
  return new Promise((resolve) => {
    let settled = false;
    let retriedHide = false;
    let retriedShell = false;
    const finish = (result: ProcessJobResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const failClosed = (error: unknown, stdout = '', stderr = ''): void => {
      const message = error instanceof Error ? error.message : String(error);
      finish({
        status: 'failed',
        exitCode: null,
        signal: null,
        stdout,
        stderr: `${stderr}${message}`,
        durationMs: Date.now() - started,
        command: rendered,
        summary: message,
      });
    };
    const start = (options: { windowsHide: boolean; shell: boolean }): void => {
      let child: ReturnType<typeof spawn>;
      try {
        child = options.shell
          ? spawnFn([params.command, ...params.args.map(quoteWindowsArg)].join(' '), {
              cwd: params.cwd,
              env,
              shell: true,
              windowsHide: options.windowsHide,
            })
          : spawnFn(params.command, params.args, {
              cwd: params.cwd,
              env,
              shell: false,
              windowsHide: options.windowsHide,
            });
      } catch (error) {
        if (process.platform === 'win32' && isSpawnEinval(error)) {
          if (!retriedHide) {
            retriedHide = true;
            start({ windowsHide: false, shell: options.shell });
            return;
          }
          if (!retriedShell) {
            retriedShell = true;
            start({ windowsHide: false, shell: true });
            return;
          }
        }
        failClosed(error);
        return;
      }
      let stdout = '';
      let stderr = '';
      let retrying = false;
      child.stdout?.on('data', (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        stdout += text;
        params.onStdout?.(text);
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        stderr += text;
        params.onStderr?.(text);
      });
      child.on('error', (error) => {
        if (process.platform === 'win32' && isSpawnEinval(error)) {
          if (!retriedHide) {
            retriedHide = true;
            retrying = true;
            start({ windowsHide: false, shell: options.shell });
            return;
          }
          if (!retriedShell) {
            retriedShell = true;
            retrying = true;
            start({ windowsHide: false, shell: true });
            return;
          }
        }
        failClosed(error, stdout, stderr);
      });
      child.on('close', (code, signal) => {
        if (retrying) return;
        const exitCode = typeof code === 'number' ? code : null;
        finish({
          status: exitCode === 0 ? 'passed' : 'failed',
          exitCode,
          signal,
          stdout,
          stderr,
          durationMs: Date.now() - started,
          command: rendered,
          summary:
            exitCode === 0
              ? 'ok'
              : (stderr || stdout || (signal ? `signal ${signal}` : 'failed')).trim(),
        });
      });
    };
    start({ windowsHide: params.windowsHide ?? defaultWindowsHide(), shell: false });
  });
}

export async function runVerifyBatch<T = unknown>(params: {
  jobs: Array<TeeVerifyJob<T>>;
  maxJobs?: number;
  candidate?: FrozenVerifyCandidate | null;
  readCandidate?: () => FrozenVerifyCandidate | { error: string };
  progress?: TeeProgressReporter;
  now?: () => number;
  heartbeatMs?: number;
}): Promise<TeeVerifyBatchResult<T>> {
  const graph = validateJobGraph(params.jobs);
  const now = params.now ?? (() => Date.now());
  const maxJobs = Math.max(1, params.maxJobs ?? resolveTeeVerifyJobs());
  const runtime: Array<JobRuntime<T>> = params.jobs.map((job) => ({
    ...job,
    kind: job.kind ?? 'read_only',
    required: job.required !== false,
    exclusive: jobIsExclusive(job),
    weight: job.weight ?? 1,
    status: 'pending',
  }));
  const results = new Map<string, TeeVerifyJobResult<T>>();
  const running = new Map<string, JobRuntime<T>>();
  const overlapPairs: Array<[string, string]> = [];
  const exclusiveOverlap: Array<[string, string]> = [];
  let peakConcurrency = 0;
  let heartbeatCount = 0;
  let foundationalMessage: string | undefined;
  const startedAtById = new Map<string, number>();

  const failFoundational = (message: string): void => {
    if (!foundationalMessage) foundationalMessage = message;
  };

  if (!graph.ok) {
    failFoundational(graph.message);
  }

  if (params.candidate && params.readCandidate) {
    const current = params.readCandidate();
    if ('error' in current) {
      failFoundational(current.error);
    } else {
      const match = assertFrozenCandidate({ expected: params.candidate, actual: current });
      if (!match.ok) failFoundational(match.message);
    }
  }

  const recordOverlap = (jobId: string): void => {
    for (const other of running.keys()) {
      if (other === jobId) continue;
      const pair: [string, string] = jobId < other ? [jobId, other] : [other, jobId];
      if (!overlapPairs.some((row) => row[0] === pair[0] && row[1] === pair[1])) {
        overlapPairs.push(pair);
      }
      const left = runtime.find((job) => job.id === pair[0]);
      const right = runtime.find((job) => job.id === pair[1]);
      if (left?.exclusive || right?.exclusive) {
        exclusiveOverlap.push(pair);
      }
    }
  };

  const depsOf = (job: JobRuntime<T>): JobRuntime<T>[] =>
    (job.dependsOn ?? [])
      .map((id) => runtime.find((row) => row.id === id))
      .filter((row): row is JobRuntime<T> => Boolean(row));

  const pickNext = (): JobRuntime<T> | null => {
    if (foundationalMessage) return null;
    if (running.size >= maxJobs) return null;
    if ([...running.values()].some((job) => job.exclusive)) return null;
    for (const job of runtime) {
      if (job.status !== 'pending') continue;
      const deps = depsOf(job);
      if (deps.some((dep) => dep.status === 'pending' || dep.status === 'running')) continue;
      if (deps.some((dep) => dep.status === 'failed' || dep.status === 'skipped')) {
        job.status = 'skipped';
        results.set(job.id, {
          id: job.id,
          label: job.label,
          status: 'skipped',
          required: job.required,
          startedAtMs: now(),
          endedAtMs: now(),
          durationMs: 0,
          error: `dependency failed: ${deps
            .filter((dep) => dep.status !== 'passed')
            .map((dep) => dep.id)
            .join(', ')}`,
        });
        continue;
      }
      if (job.exclusive && running.size > 0) continue;
      if (
        job.isolationGroup &&
        [...running.values()].some((row) => row.isolationGroup === job.isolationGroup)
      ) {
        continue;
      }
      return job;
    }
    return null;
  };

  const checkCandidate = (): void => {
    if (!params.candidate || !params.readCandidate || foundationalMessage) return;
    const current = params.readCandidate();
    if ('error' in current) {
      failFoundational(current.error);
      return;
    }
    const match = assertFrozenCandidate({ expected: params.candidate, actual: current });
    if (!match.ok) failFoundational(match.message);
  };

  const inflight = new Set<Promise<void>>();
  const runJob = async (job: JobRuntime<T>): Promise<void> => {
    const startedAtMs = now();
    startedAtById.set(job.id, startedAtMs);
    job.status = 'running';
    running.set(job.id, job);
    recordOverlap(job.id);
    peakConcurrency = Math.max(peakConcurrency, running.size);
    notifyDisplayProgress(() => {
      params.progress?.workerUpdate(job.id, 'running', { startedAtMs });
    });
    try {
      const value = await job.run();
      if (foundationalMessage) {
        job.status = 'failed';
        results.set(job.id, {
          id: job.id,
          label: job.label,
          status: 'failed',
          required: job.required,
          startedAtMs,
          endedAtMs: now(),
          durationMs: now() - startedAtMs,
          error: foundationalMessage,
          value,
        });
        notifyDisplayProgress(() => {
          params.progress?.workerUpdate(job.id, 'failed');
        });
        return;
      }
      const processValue = value as Partial<ProcessJobResult> | undefined;
      const failedProcess =
        processValue &&
        typeof processValue === 'object' &&
        'status' in processValue &&
        processValue.status === 'failed';
      job.status = failedProcess ? 'failed' : 'passed';
      results.set(job.id, {
        id: job.id,
        label: job.label,
        status: job.status,
        required: job.required,
        startedAtMs,
        endedAtMs: now(),
        durationMs: now() - startedAtMs,
        value,
        error: failedProcess
          ? String(processValue.summary ?? processValue.stderr ?? 'failed')
          : undefined,
        exitCode: processValue?.exitCode,
        signal: processValue?.signal,
        stdout: processValue?.stdout,
        stderr: processValue?.stderr,
        command: processValue?.command,
      });
      notifyDisplayProgress(() => {
        params.progress?.workerUpdate(job.id, job.status === 'failed' ? 'failed' : 'passed');
      });
    } catch (error) {
      job.status = 'failed';
      const processValue = error as Partial<ProcessJobResult> & { message?: string };
      results.set(job.id, {
        id: job.id,
        label: job.label,
        status: 'failed',
        required: job.required,
        startedAtMs,
        endedAtMs: now(),
        durationMs: now() - startedAtMs,
        error: error instanceof Error ? error.message : String(error),
        exitCode: processValue.exitCode,
        signal: processValue.signal,
        stdout: processValue.stdout,
        stderr: processValue.stderr,
        command: processValue.command,
      });
      notifyDisplayProgress(() => {
        params.progress?.workerUpdate(job.id, 'failed');
      });
    } finally {
      running.delete(job.id);
    }
  };

  notifyDisplayProgress(() => {
    params.progress?.setWorkers(runtime.map((job) => ({ id: job.id, label: job.label })));
  });

  if (foundationalMessage) {
    for (const job of runtime) {
      if (results.has(job.id)) continue;
      job.status = 'skipped';
      results.set(job.id, {
        id: job.id,
        label: job.label,
        status: 'skipped',
        required: job.required,
        startedAtMs: now(),
        endedAtMs: now(),
        durationMs: 0,
        error: foundationalMessage,
      });
    }
  }

  const heartbeatMs = params.heartbeatMs ?? TEE_PROGRESS_DEFAULT_HEARTBEAT_MS;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  if (heartbeatMs > 0) {
    heartbeatTimer = setInterval(() => {
      heartbeatCount += 1;
      notifyDisplayProgress(() => {
        params.progress?.heartbeat();
      });
      checkCandidate();
    }, heartbeatMs);
    heartbeatTimer.unref?.();
  }

  try {
    while (!foundationalMessage) {
      checkCandidate();
      let started = false;
      let next = pickNext();
      while (next) {
        started = true;
        const pending = runJob(next).finally(() => {
          inflight.delete(pending);
        });
        inflight.add(pending);
        next = pickNext();
      }
      if (inflight.size === 0 && !started) break;
      if (inflight.size > 0) {
        await Promise.race(inflight);
      }
    }
    if (inflight.size > 0) {
      await Promise.all(inflight);
    }
    checkCandidate();
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }

  if (foundationalMessage) {
    for (const job of runtime) {
      if (job.status === 'pending') {
        job.status = 'skipped';
        results.set(job.id, {
          id: job.id,
          label: job.label,
          status: 'skipped',
          required: job.required,
          startedAtMs: now(),
          endedAtMs: now(),
          durationMs: 0,
          error: foundationalMessage,
        });
      }
    }
  }

  const ordered = runtime.map((job) => {
    const result = results.get(job.id);
    if (result) return result;
    return {
      id: job.id,
      label: job.label,
      status: 'failed' as const,
      required: job.required,
      startedAtMs: startedAtById.get(job.id) ?? now(),
      endedAtMs: now(),
      durationMs: 0,
      error: 'verification job did not produce a result',
    };
  });
  const failures = ordered.filter(
    (result) => result.status === 'failed' || (result.required && result.status === 'skipped')
  );
  const requiredFailed = ordered.some(
    (result) => result.required && result.status !== 'passed'
  );

  return {
    ok: !foundationalMessage && !requiredFailed && exclusiveOverlap.length === 0,
    foundational: Boolean(foundationalMessage),
    foundationalMessage,
    maxJobs,
    candidate: params.candidate ?? null,
    results: ordered,
    failures,
    overlapPairs,
    exclusiveOverlap,
    peakConcurrency,
    heartbeatCount,
  };
}

export function requireProcessSuccess(result: ProcessJobResult, label: string): string {
  if (result.status !== 'passed') {
    throw new Error(
      `${label} failed${result.exitCode !== null ? ` (exit ${result.exitCode})` : ''}: ${result.summary}`
    );
  }
  return result.stdout;
}

export function formatVerifyBatchFailures(batch: TeeVerifyBatchResult): string {
  if (batch.foundational && batch.foundationalMessage) {
    return `Foundational verification failure: ${batch.foundationalMessage}`;
  }
  if (batch.failures.length === 0) return 'verification batch failed';
  return batch.failures
    .map((failure) => {
      const exit =
        failure.exitCode !== undefined && failure.exitCode !== null
          ? ` exit=${failure.exitCode}`
          : '';
      const signal = failure.signal ? ` signal=${failure.signal}` : '';
      const command = failure.command ? ` command=${failure.command}` : '';
      const output = [failure.stderr, failure.stdout, failure.error].filter(Boolean).join('\n');
      return `${failure.label} FAIL${exit}${signal}${command}${output ? `\n${output}` : ''}`;
    })
    .join('\n\n');
}

export function createVerifyProgressReporter(params: {
  title: string;
  workstreamId?: string | null;
  candidate?: FrozenVerifyCandidate | null;
  stream?: NodeJS.WritableStream;
  isTTY?: boolean;
}): TeeProgressReporter {
  const reporter = createTeeProgressReporter({
    title: params.title,
    stream: params.stream,
    isTTY: params.isTTY,
    stages: [
      { id: 'candidate', label: 'Candidate capture', weight: 6 },
      { id: 'foundation', label: 'Protocol validation', weight: 6 },
      { id: 'verify-batch', label: 'Verification batch', weight: 60 },
      { id: 'required-ids', label: 'Required-ID proof', weight: 10 },
      { id: 'manifest', label: 'Manifest generation', weight: 8 },
      { id: 'convergence', label: 'Evidence convergence', weight: 10 },
    ],
  });
  reporter.start(params.workstreamId ?? undefined);
  if (params.candidate) {
    reporter.setSubtitle(
      `${params.workstreamId ?? ''} ${params.candidate.headCommit.slice(0, 12)}`.trim()
    );
  }
  return reporter;
}

export function createFinaliseProgressReporter(params: {
  title?: string;
  stream?: NodeJS.WritableStream;
  isTTY?: boolean;
}): TeeProgressReporter {
  const reporter = createTeeProgressReporter({
    title: params.title ?? 'TEE finalise',
    stream: params.stream,
    isTTY: params.isTTY,
    stages: [
      { id: 'git-unmerged', label: 'Git merge conflicts', weight: 6 },
      { id: 'git-changed-files', label: 'Git change scope', weight: 4 },
      { id: 'git-branch-head', label: 'Branch/HEAD binding', weight: 4 },
      { id: 'protocol-readiness', label: 'Protocol readiness', weight: 8 },
      { id: 'migration-inventory', label: 'Migration inventory', weight: 6 },
      { id: 'dev-server-inventory', label: 'Dev server inventory', weight: 4 },
      { id: 'finalise-start', label: 'Finalise-start', weight: 8 },
      { id: 'production-build', label: 'Production build', weight: 32 },
      { id: 'application-tests', label: 'Application tests', weight: 12 },
      { id: 'release-finish', label: 'Release finish', weight: 16 },
    ],
  });
  reporter.start();
  return reporter;
}

export { type TeeProgressReporter, type TeeProgressStatus };
