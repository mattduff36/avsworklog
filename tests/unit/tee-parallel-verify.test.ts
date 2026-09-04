import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import {
  assertFrozenCandidate,
  candidatesMatch,
  captureFrozenVerifyCandidate,
  formatVerifyBatchFailures,
  jobIsExclusive,
  requireProcessSuccess,
  resolveTeeVerifyJobs,
  createHumanTeeProgress,
  runProcessJob,
  runVerifyBatch,
  sanitizeSpawnEnv,
  type FrozenVerifyCandidate,
  type TeeVerifyJob,
} from '@/scripts/automation/tee-parallel-verify';
import {
  attachLiveProgressTerminalGuards,
  clampSuiteProgress,
  createTeeProgressReporter,
  isCursorInteractiveProgressHost,
  notifyDisplayProgress,
  renderTeeProgressLines,
  resolveProgressIsTty,
  shouldUseAlternateScreen,
  shouldUseMachineProgress,
  ttyLiveRefreshPrefix,
  ttyLiveRestoreSequence,
  ttyLiveStartSequence,
} from '@/scripts/automation/tee-progress';
import { resolveTerminalTestPlan } from '@/scripts/testing/run-terminal-tests';
import TeeVitestProgressReporter, {
  parseTeeVitestProgressSnapshot,
} from '@/scripts/automation/tee-vitest-progress-reporter';
import {
  planFinaliseMutatingStages,
  planFinaliseReadOnlyPrechecks,
  FINALISE_READONLY_PRECHECK_IDS,
  FINALISE_SERIAL_MUTATING_IDS,
} from '@/scripts/automation/tee-finalise-prechecks';
import {
  buildEvidenceManifest,
  planCanonicalStaticChecks,
} from '@/scripts/automation/workflow-evidence-manifest';
import { collectPremiumPacketEvidence } from '@/scripts/automation/tee-premium-packet';
import {
  cleanupWorkflowV24Fixtures,
  initGitRepo,
  initWorkstream,
  makeTempRoot,
  persistFixtureLedger,
  writePassingManifest,
} from './workflow-v24-test-harness';

afterEach(() => {
  cleanupWorkflowV24Fixtures();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeCandidate(overrides: Partial<FrozenVerifyCandidate> = {}): FrozenVerifyCandidate {
  return {
    headCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    fingerprint: 'b'.repeat(64),
    workstreamId: 'ws_parallel',
    ...overrides,
  };
}

describe('TEE parallel verification runner', () => {
  it('T-PV-BOUNDED-CONCURRENCY / T-PV-SAFE-OVERLAP: caps workers and overlaps independent read-only jobs', async () => {
    const current = new Set<string>();
    let peak = 0;
    const jobs: Array<TeeVerifyJob<string>> = ['a', 'b', 'c', 'd'].map((id) => ({
      id,
      label: id,
      kind: 'read_only',
      run: async () => {
        current.add(id);
        peak = Math.max(peak, current.size);
        await sleep(60);
        current.delete(id);
        return id;
      },
    }));
    const batch = await runVerifyBatch({
      jobs,
      maxJobs: 3,
      heartbeatMs: 0,
    });
    expect(batch.ok).toBe(true);
    expect(batch.maxJobs).toBe(3);
    expect(batch.peakConcurrency).toBeLessThanOrEqual(3);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(batch.overlapPairs.length).toBeGreaterThan(0);
  });

  it('T-PV-JOBS-1-SERIAL / TEE_VERIFY_JOBS=1: serial fallback never overlaps', async () => {
    expect(resolveTeeVerifyJobs({ TEE_VERIFY_JOBS: '1' })).toBe(1);
    const current = new Set<string>();
    let peak = 0;
    const batch = await runVerifyBatch({
      jobs: ['a', 'b', 'c'].map((id) => ({
        id,
        label: id,
        run: async () => {
          current.add(id);
          peak = Math.max(peak, current.size);
          await sleep(25);
          current.delete(id);
          return id;
        },
      })),
      maxJobs: 1,
      heartbeatMs: 0,
    });
    expect(batch.ok).toBe(true);
    expect(batch.peakConcurrency).toBe(1);
    expect(peak).toBe(1);
    expect(batch.overlapPairs).toEqual([]);
  });

  it('T-PV-DEPENDENCIES: dependents wait for declared prerequisites', async () => {
    const order: string[] = [];
    const batch = await runVerifyBatch({
      jobs: [
        {
          id: 'a',
          label: 'A',
          run: async () => {
            await sleep(20);
            order.push('a');
            return 'a';
          },
        },
        {
          id: 'b',
          label: 'B',
          dependsOn: ['a'],
          run: async () => {
            order.push('b');
            return 'b';
          },
        },
        {
          id: 'c',
          label: 'C',
          dependsOn: ['a', 'b'],
          run: async () => {
            order.push('c');
            return 'c';
          },
        },
      ],
      maxJobs: 3,
      heartbeatMs: 0,
    });
    expect(batch.ok).toBe(true);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('T-PV-MUTATING-NO-OVERLAP / T-PV-DB-SERIAL / T-PV-PROTOCOL-SERIAL: exclusive stages never share the worker pool', async () => {
    const current = new Set<string>();
    let peakExclusive = 0;
    const batch = await runVerifyBatch({
      jobs: [
        {
          id: 'read',
          label: 'read',
          kind: 'read_only',
          run: async () => {
            current.add('read');
            await sleep(40);
            current.delete('read');
            return 'read';
          },
        },
        {
          id: 'db',
          label: 'db',
          kind: 'db',
          run: async () => {
            current.add('db');
            peakExclusive = Math.max(peakExclusive, current.size);
            await sleep(40);
            current.delete('db');
            return 'db';
          },
        },
        {
          id: 'protocol',
          label: 'protocol',
          kind: 'protocol',
          run: async () => {
            current.add('protocol');
            peakExclusive = Math.max(peakExclusive, current.size);
            await sleep(40);
            current.delete('protocol');
            return 'protocol';
          },
        },
      ],
      maxJobs: 3,
      heartbeatMs: 0,
    });
    expect(batch.ok).toBe(true);
    expect(jobIsExclusive({ kind: 'db' })).toBe(true);
    expect(jobIsExclusive({ kind: 'protocol' })).toBe(true);
    expect(jobIsExclusive({ kind: 'mutating' })).toBe(true);
    expect(batch.exclusiveOverlap).toEqual([]);
    expect(peakExclusive).toBe(1);
    expect(
      batch.overlapPairs.some(
        ([left, right]) =>
          (left === 'db' || right === 'db') && (left === 'protocol' || right === 'protocol')
      )
    ).toBe(false);
  });

  it('T-PV-SAME-CANDIDATE / T-PV-DRIFT-REJECTED: evidence workers share one frozen candidate and reject in-flight and terminal drift', async () => {
    const frozen = fakeCandidate();
    const same = await runVerifyBatch({
      jobs: [
        { id: 'one', label: 'one', run: async () => 'one' },
        { id: 'two', label: 'two', run: async () => 'two' },
      ],
      candidate: frozen,
      readCandidate: () => frozen,
      heartbeatMs: 0,
    });
    expect(same.ok).toBe(true);
    expect(same.candidate).toEqual(frozen);
    expect(candidatesMatch(frozen, frozen)).toBe(true);

    let inflight = false;
    const midFlight = await runVerifyBatch({
      jobs: [
        {
          id: 'slow',
          label: 'slow',
          run: async () => {
            inflight = true;
            await sleep(80);
            return 'slow';
          },
        },
        {
          id: 'peer',
          label: 'peer',
          run: async () => {
            await sleep(40);
            return 'peer';
          },
        },
      ],
      candidate: frozen,
      readCandidate: () =>
        inflight
          ? fakeCandidate({ headCommit: 'cccccccccccccccccccccccccccccccccccccccc' })
          : frozen,
      heartbeatMs: 15,
    });
    expect(midFlight.ok).toBe(false);
    expect(midFlight.foundational).toBe(true);
    expect(midFlight.foundationalMessage).toMatch(/HEAD drifted|fingerprint drifted/i);

    let finished = false;
    const terminal = await runVerifyBatch({
      jobs: [
        {
          id: 'done',
          label: 'done',
          run: async () => {
            finished = true;
            return 'done';
          },
        },
      ],
      candidate: frozen,
      readCandidate: () =>
        finished ? fakeCandidate({ fingerprint: 'c'.repeat(64) }) : frozen,
      heartbeatMs: 0,
    });
    expect(terminal.ok).toBe(false);
    expect(terminal.foundational).toBe(true);
    expect(terminal.foundationalMessage).toMatch(/fingerprint drifted/i);

    const rejected = assertFrozenCandidate({
      expected: frozen,
      actual: fakeCandidate({ fingerprint: 'c'.repeat(64) }),
    });
    expect(rejected.ok).toBe(false);
  });

  it('T-PV-FAILURE-OUTPUT git subprocess: failed Git/process jobs cannot be treated as empty success', async () => {
    const failed = await runProcessJob({
      cwd: process.cwd(),
      command: process.execPath,
      args: ['-e', 'process.exit(3)'],
    });
    expect(failed.status).toBe('failed');
    expect(() => requireProcessSuccess(failed, 'git changed-file listing')).toThrow(
      /git changed-file listing failed \(exit 3\)/
    );
    const batch = await runVerifyBatch({
      jobs: [
        {
          id: 'git-changed-files',
          label: 'Git change scope',
          run: async () => requireProcessSuccess(failed, 'git changed-file listing'),
        },
      ],
      heartbeatMs: 0,
    });
    expect(batch.ok).toBe(false);
    expect(batch.failures[0]?.error).toMatch(/git changed-file listing failed/);
  });

  it('T-PV-REQUIRED-FAIL-FAILS-BATCH / T-PV-INDEPENDENT-FAILURES / T-PV-FAILURE-OUTPUT: required failures fail the batch and independent failures are collected', async () => {
    const batch = await runVerifyBatch({
      jobs: [
        {
          id: 'pass',
          label: 'Typecheck',
          run: async () => ({ status: 'passed', exitCode: 0, stdout: 'ok', stderr: '', summary: 'ok' }),
        },
        {
          id: 'unit',
          label: 'Unit tests',
          run: async () => {
            throw Object.assign(new Error('unit exploded'), {
              exitCode: 2,
              stdout: 'expected 3',
              stderr: 'FAIL tests/unit/demo.test.ts',
              command: 'npx vitest run tests/unit/demo.test.ts',
            });
          },
        },
        {
          id: 'lint',
          label: 'ESLint',
          run: async () => ({
            status: 'failed',
            exitCode: 1,
            stdout: '',
            stderr: 'Unexpected any',
            summary: 'Unexpected any',
            command: 'npx eslint -- src/a.ts',
          }),
        },
      ],
      maxJobs: 3,
      heartbeatMs: 0,
    });
    expect(batch.ok).toBe(false);
    expect(batch.foundational).toBe(false);
    expect(batch.failures.map((row) => row.id).sort()).toEqual(['lint', 'unit']);
    const rendered = formatVerifyBatchFailures(batch);
    expect(rendered).toMatch(/Unit tests FAIL/);
    expect(rendered).toMatch(/exit=2/);
    expect(rendered).toMatch(/ESLint FAIL/);
    expect(rendered).toMatch(/Unexpected any/);
    expect(rendered).toMatch(/npx eslint/);
  });

  it('T-PV-FOUNDATIONAL-FAIL-FAST: invalid graph or candidate fails before starting work', async () => {
    let started = 0;
    const batch = await runVerifyBatch({
      jobs: [
        {
          id: 'cycle-a',
          label: 'A',
          dependsOn: ['cycle-b'],
          run: () => {
            started += 1;
            return 'a';
          },
        },
        {
          id: 'cycle-b',
          label: 'B',
          dependsOn: ['cycle-a'],
          run: () => {
            started += 1;
            return 'b';
          },
        },
      ],
      heartbeatMs: 0,
    });
    expect(batch.foundational).toBe(true);
    expect(batch.foundationalMessage).toMatch(/cycle/i);
    expect(started).toBe(0);
    expect(batch.results.every((row) => row.status === 'skipped')).toBe(true);
  });

  it('T-PV-EXIT-SIGNAL: preserves exit codes and useful process output', async () => {
    const failed = await runProcessJob({
      cwd: process.cwd(),
      command: process.execPath,
      args: ['-e', 'process.stderr.write("boom-stderr"); process.exit(7)'],
    });
    expect(failed.status).toBe('failed');
    expect(failed.exitCode).toBe(7);
    expect(failed.stderr).toMatch(/boom-stderr/);
    const passed = await runProcessJob({
      cwd: process.cwd(),
      command: process.execPath,
      args: ['-e', 'process.stdout.write("ok-stdout")'],
    });
    expect(passed.status).toBe('passed');
    expect(passed.exitCode).toBe(0);
    expect(passed.stdout).toMatch(/ok-stdout/);
  });

  it('T-PV-WIN-SPAWN-SAFE / T-PV-SPAWN-FAIL-CLOSED: evidence-manifest child processes spawn on Windows and genuine spawn failures stay failed', async () => {
    expect(sanitizeSpawnEnv({ FOO: 'bar', BAZ: undefined })).toEqual({ FOO: 'bar' });
    const ok = await runProcessJob({
      cwd: process.cwd(),
      command: process.execPath,
      args: ['-e', 'process.stdout.write("spawn-ok")'],
      env: { ...process.env, TEE_EMPTY_SPAWN_ENV: undefined },
      windowsHide: true,
    });
    expect(ok.status).toBe('passed');
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toMatch(/spawn-ok/);

    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const npmVersion = await runProcessJob({
      cwd: process.cwd(),
      command: npmCommand,
      args: ['-v'],
      windowsHide: true,
    });
    expect(npmVersion.status).toBe('passed');
    expect(npmVersion.exitCode).toBe(0);
    expect(npmVersion.stdout.trim()).toMatch(/^\d+\.\d+/);

    const missing = await runProcessJob({
      cwd: process.cwd(),
      command: path.join(process.cwd(), 'definitely-missing-avs-tee-spawn.exe'),
      args: ['--version'],
      windowsHide: true,
    });
    expect(missing.status).toBe('failed');
    expect(missing.exitCode === null || missing.exitCode !== 0).toBe(true);
    expect(`${missing.summary} ${missing.stderr}`).toMatch(/ENOENT|not found|spawn/i);

    const failed = await runProcessJob({
      cwd: process.cwd(),
      command: process.execPath,
      args: ['-e', 'process.stderr.write("closed-fail"); process.exit(2)'],
    });
    expect(failed.status).toBe('failed');
    expect(failed.exitCode).toBe(2);

    const gitCommand = process.platform === 'win32' ? 'git.exe' : 'git';
    const gitVersion = await runProcessJob({
      cwd: process.cwd(),
      command: gitCommand,
      args: ['--version'],
      windowsHide: true,
    });
    expect(gitVersion.status).toBe('passed');
    expect(gitVersion.exitCode).toBe(0);
    expect(gitVersion.stdout).toMatch(/git version/i);

    if (process.platform === 'win32') {
      let recoverAttempts = 0;
      const recoverFromEinval = await runProcessJob({
        cwd: process.cwd(),
        command: process.execPath,
        args: ['-e', 'process.stdout.write("einval-recovered")'],
        windowsHide: true,
        spawnImpl: ((command, argsOrOptions, options) => {
          recoverAttempts += 1;
          if (recoverAttempts === 1) {
            throw Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' });
          }
          return typeof argsOrOptions === 'object' &&
            argsOrOptions !== null &&
            !Array.isArray(argsOrOptions)
            ? spawn(command, argsOrOptions)
            : spawn(command, argsOrOptions ?? [], options ?? {});
        }) as typeof spawn,
      });
      expect(recoverFromEinval.status).toBe('passed');
      expect(recoverFromEinval.exitCode).toBe(0);
      expect(recoverFromEinval.stdout).toMatch(/einval-recovered/);
      expect(recoverAttempts).toBeGreaterThan(1);

      let failAttempts = 0;
      const fallbackStillFails = await runProcessJob({
        cwd: process.cwd(),
        command: process.execPath,
        args: ['-e', 'process.stderr.write("einval-still-fail"); process.exit(4)'],
        windowsHide: true,
        spawnImpl: ((command, argsOrOptions, options) => {
          failAttempts += 1;
          if (failAttempts === 1) {
            throw Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' });
          }
          return typeof argsOrOptions === 'object' &&
            argsOrOptions !== null &&
            !Array.isArray(argsOrOptions)
            ? spawn(command, argsOrOptions)
            : spawn(command, argsOrOptions ?? [], options ?? {});
        }) as typeof spawn,
      });
      expect(fallbackStillFails.status).toBe('failed');
      expect(fallbackStillFails.exitCode).toBe(4);
      expect(fallbackStillFails.stderr).toMatch(/einval-still-fail/);
      expect(failAttempts).toBeGreaterThan(1);
    }
  });
});

describe('TEE progress reporter', () => {
  it('T-PV-MONOTONIC-PCT / T-PV-TERMINAL-100 / T-PV-SAFE-ETA / T-PV-NON-TTY / T-PV-HEARTBEAT-NO-MUTATE', () => {
    let now = 1_000;
    const chunks: string[] = [];
    const reporter = createTeeProgressReporter({
      title: 'TEE preflight',
      isTTY: false,
      now: () => now,
      stages: [
        { id: 'candidate', label: 'Candidate captured', weight: 10 },
        { id: 'verify-batch', label: 'Verification batch', weight: 80 },
        { id: 'done', label: 'Preflight', weight: 10 },
      ],
      stream: { write: (chunk: string) => chunks.push(String(chunk)) } as NodeJS.WritableStream,
    });
    reporter.start('ws_demo');
    reporter.stageStart('candidate');
    now += 4_000;
    reporter.stageFinish('candidate', 'passed');
    const afterFirst = reporter.snapshot();
    expect(afterFirst.percent).toBeGreaterThan(0);
    expect(afterFirst.percent).toBeLessThan(100);
    expect(afterFirst.completed).toBe(false);

    reporter.stageStart('verify-batch');
    reporter.setWorkers([
      { id: 'typecheck', label: 'Typecheck' },
      { id: 'eslint', label: 'ESLint' },
    ]);
    reporter.workerUpdate('typecheck', 'running');
    const beforeHeartbeat = reporter.snapshot();
    const beforeLines = beforeHeartbeat.lines.join('\n');
    reporter.heartbeat();
    reporter.heartbeat();
    const afterHeartbeat = reporter.snapshot();
    expect(afterHeartbeat.heartbeatCount).toBe(2);
    expect(afterHeartbeat.percent).toBeGreaterThanOrEqual(beforeHeartbeat.percent);
    expect(afterHeartbeat.percent).toBeLessThan(100);
    expect(afterHeartbeat.workers.map((worker) => worker.status)).toEqual(
      beforeHeartbeat.workers.map((worker) => worker.status)
    );
    expect(afterHeartbeat.lines.join('\n').startsWith(beforeLines)).toBe(true);

    now += 20_000;
    reporter.workerUpdate('typecheck', 'passed');
    reporter.workerUpdate('eslint', 'passed');
    reporter.stageFinish('verify-batch', 'passed');
    const withEta = reporter.snapshot();
    expect(withEta.etaMs === null || withEta.etaMs >= 0).toBe(true);
    expect(withEta.percent).toBeLessThan(100);

    reporter.stageStart('done');
    reporter.stageFinish('done', 'passed');
    reporter.complete('passed');
    const done = reporter.snapshot();
    expect(done.percent).toBe(100);
    expect(done.completed).toBe(true);
    expect(done.etaMs).toBeNull();
    expect(chunks.join('')).not.toContain(`\u001b[`);
    expect(chunks.join('')).toMatch(/\[ *\d+%\]/);
  });

  it('T-PV-HIERARCHY / T-PV-WAITING / T-PV-SUITE-CLAMP / T-PV-FAIL-IMMEDIATE / T-PV-OPAQUE-NO-FABRICATE / T-PV-NOT-100-UNTIL-COMPLETE', () => {
    let now = 10_000;
    const reporter = createTeeProgressReporter({
      title: 'TEE preflight',
      isTTY: true,
      now: () => now,
      stages: [
        { id: 'candidate', label: 'Candidate capture', weight: 10 },
        { id: 'verify-batch', label: 'Verification batch', weight: 70 },
        { id: 'required-ids', label: 'Required-ID proof', weight: 10 },
        { id: 'convergence', label: 'Evidence convergence', weight: 10 },
      ],
    });
    reporter.start('ws_demo');
    reporter.stageStart('candidate');
    now += 2_000;
    reporter.stageFinish('candidate', 'passed');
    reporter.stageStart('verify-batch');
    reporter.setWorkers([
      { id: 'canonical-workflow-suite', label: 'Workflow tests' },
      { id: 'typecheck', label: 'Typecheck' },
      { id: 'oxlint-changed', label: 'Oxlint' },
      { id: 'eslint-changed', label: 'ESLint' },
    ]);
    reporter.workerUpdate('canonical-workflow-suite', 'running', {
      completed: 247,
      total: 350,
      current: 'TEE-V24-C9-FINISH-MISMATCH-003',
    });
    reporter.workerUpdate('typecheck', 'passed');
    reporter.workerUpdate('oxlint-changed', 'running');
    now += 20_000;
    reporter.workerUpdate('canonical-workflow-suite', 'running', {
      completed: 400,
      total: 350,
      current: 'TEE-V24-C9-FINISH-MISMATCH-003',
      failures: ['TEE-V24-C9-FINISH-MISMATCH-003'],
    });
    const mid = reporter.snapshot();
    expect(mid.percent).toBeLessThan(100);
    expect(mid.completed).toBe(false);
    expect(mid.workers.find((worker) => worker.id === 'canonical-workflow-suite')?.completed).toBe(
      350
    );
    expect(mid.stages.find((stage) => stage.id === 'convergence')?.status).toBe('pending');
    const rendered = renderTeeProgressLines(mid).join('\n');
    expect(rendered).toMatch(/Overall/);
    expect(rendered).toMatch(/Verification batch/);
    expect(rendered).toMatch(/Workflow tests/);
    expect(rendered).toMatch(/350\/350|247\/350|350\/350/);
    expect(rendered).toContain('350/350');
    expect(rendered).toContain('Current: TEE-V24-C9-FINISH-MISMATCH-003');
    expect(rendered).toContain('FAIL: TEE-V24-C9-FINISH-MISMATCH-003');
    expect(rendered).toContain('WAITING');
    expect(rendered).toContain('Evidence convergence');
    expect(rendered).not.toMatch(/Evidence convergence[^\n]*PASS/);

    const beforeOpaque = mid.percent;
    reporter.workerUpdate('oxlint-changed', 'running');
    reporter.heartbeat();
    expect(reporter.snapshot().percent).toBe(beforeOpaque);

    reporter.workerUpdate('canonical-workflow-suite', 'failed');
    reporter.workerUpdate('oxlint-changed', 'passed');
    reporter.workerUpdate('eslint-changed', 'passed');
    reporter.stageFinish('verify-batch', 'failed');
    reporter.stageStart('required-ids');
    reporter.stageFinish('required-ids', 'failed');
    reporter.stageStart('convergence');
    reporter.stageFinish('convergence', 'failed');
    expect(reporter.snapshot().percent).toBeLessThan(100);
    reporter.complete('failed');
    expect(reporter.snapshot().percent).toBe(100);
    expect(clampSuiteProgress(400, 350)).toEqual({ completed: 350, total: 350 });
  });

  it('T-PV-NON-TTY-NO-FLOOD / T-PV-JOBS-1-AND-PARALLEL-RENDER', () => {
    const chunks: string[] = [];
    const reporter = createTeeProgressReporter({
      title: 'TEE preflight',
      isTTY: false,
      now: () => 20_000,
      stages: [
        { id: 'verify-batch', label: 'Verification batch', weight: 100 },
      ],
      stream: { write: (chunk: string) => chunks.push(String(chunk)) } as NodeJS.WritableStream,
    });
    reporter.start();
    reporter.stageStart('verify-batch');
    reporter.setWorkers([
      { id: 'a', label: 'Workflow tests' },
      { id: 'b', label: 'Typecheck' },
    ]);
    reporter.workerUpdate('a', 'running', { completed: 1, total: 10, current: 'one' });
    reporter.workerUpdate('a', 'running', { completed: 2, total: 10, current: 'two' });
    reporter.workerUpdate('a', 'running', { completed: 3, total: 10, current: 'three' });
    const joined = chunks.join('');
    expect(joined).not.toContain('\u001b[');
    expect(joined.split('\n').filter(Boolean).length).toBeLessThan(8);
    expect(joined).not.toMatch(/Current: two/);

    const serial = createTeeProgressReporter({
      title: 'TEE preflight',
      isTTY: true,
      now: () => 20_000,
      stages: [{ id: 'verify-batch', label: 'Verification batch', weight: 100 }],
    });
    serial.stageStart('verify-batch');
    serial.setWorkers([{ id: 'only', label: 'Workflow tests' }]);
    serial.workerUpdate('only', 'running', { completed: 4, total: 12, current: 'jobs=1' });
    const serialView = renderTeeProgressLines(serial.snapshot()).join('\n');
    expect(serialView).toContain('Workflow tests');
    expect(serialView).toContain('4/12');
    expect(serialView).toContain('Current: jobs=1');

    const parallel = createTeeProgressReporter({
      title: 'TEE preflight',
      isTTY: true,
      now: () => 20_000,
      stages: [{ id: 'verify-batch', label: 'Verification batch', weight: 100 }],
    });
    parallel.stageStart('verify-batch');
    parallel.setWorkers([
      { id: 'workflow', label: 'Workflow tests' },
      { id: 'typecheck', label: 'Typecheck' },
    ]);
    parallel.workerUpdate('workflow', 'running', { completed: 10, total: 20 });
    parallel.workerUpdate('typecheck', 'running');
    const parallelView = renderTeeProgressLines(parallel.snapshot()).join('\n');
    expect(parallelView).not.toContain('├─');
    expect(parallelView).not.toContain('└─');
    expect(parallelView).toMatch(/Verification batch\s+RUNNING/);
    expect(parallelView).toMatch(/Workflow tests\s+\[[█░]+\] 10\/20 RUNNING/);
    expect(parallelView).toMatch(/Typecheck\s+\[[░]+\] RUNNING/);
    expect(parallelView).toContain('Workflow tests');
    expect(parallelView).toContain('Typecheck');
  });

  it('T-PV-PROGRESS-CANNOT-ALTER-RESULT: reporter throws do not fail jobs or mutate batch status', async () => {
    let threw = false;
    notifyDisplayProgress(() => {
      threw = true;
      throw new Error('ui boom');
    });
    expect(threw).toBe(true);

    const batch = await runVerifyBatch({
      jobs: [
        {
          id: 'ok',
          label: 'Typecheck',
          run: async () => ({ status: 'passed', exitCode: 0, stdout: 'ok', stderr: '', summary: 'ok' }),
        },
      ],
      heartbeatMs: 0,
      progress: {
        start() {
          throw new Error('start');
        },
        setSubtitle() {
          throw new Error('subtitle');
        },
        stageStart() {
          throw new Error('stageStart');
        },
        stageUpdate() {
          throw new Error('stageUpdate');
        },
        stageFinish() {
          throw new Error('stageFinish');
        },
        setWorkers() {
          throw new Error('setWorkers');
        },
        workerUpdate() {
          throw new Error('workerUpdate');
        },
        heartbeat() {
          throw new Error('heartbeat');
        },
        complete() {
          throw new Error('complete');
        },
        restoreTerminal() {
          throw new Error('restoreTerminal');
        },
        snapshot() {
          throw new Error('snapshot');
        },
      },
    });
    expect(batch.ok).toBe(true);
    expect(batch.results[0]?.status).toBe('passed');
  });

  it('T-PV-LIVE-TTY-025: TTY enters live mode and later frames replace instead of appending', () => {
    const chunks: string[] = [];
    const reporter = createTeeProgressReporter({
      title: 'TEE preflight',
      isTTY: true,
      ci: false,
      stages: [{ id: 'verify-batch', label: 'Verification batch', weight: 100 }],
      stream: { write: (chunk: string) => chunks.push(String(chunk)) } as NodeJS.WritableStream,
    });
    const result = { exitCode: 0, ok: true };
    reporter.start();
    reporter.stageStart('verify-batch');
    const text = chunks.join('');
    expect(text.startsWith(ttyLiveStartSequence(true))).toBe(true);
    expect(text).toContain(ttyLiveRefreshPrefix());
    expect(text).not.toContain('cls');
    expect((text.match(/TEE preflight/g) || []).length).toBeGreaterThan(1);
    expect(text.indexOf(ttyLiveRefreshPrefix())).toBeGreaterThan(text.indexOf(ttyLiveStartSequence(true)));
    expect(result).toEqual({ exitCode: 0, ok: true });
    reporter.restoreTerminal();
  });

  it('T-PV-LIVE-PASS-026 / T-PV-LIVE-FAIL-027: complete restores the terminal and prints one permanent frame', () => {
    const passChunks: string[] = [];
    const pass = createTeeProgressReporter({
      title: 'TEE preflight',
      isTTY: true,
      ci: false,
      stages: [{ id: 'verify-batch', label: 'Verification batch', weight: 100 }],
      stream: { write: (chunk: string) => passChunks.push(String(chunk)) } as NodeJS.WritableStream,
    });
    pass.start();
    pass.complete('passed');
    const passText = passChunks.join('');
    expect(passText).toContain(ttyLiveRestoreSequence(true));
    expect(passText).toContain('\u001b[?25h');
    expect(passText).toMatch(/100% PASS/);
    expect(passText.lastIndexOf(ttyLiveRestoreSequence(true))).toBeLessThan(passText.lastIndexOf('100% PASS'));
    pass.restoreTerminal();
    expect(passChunks.join('')).toBe(passText);

    const failChunks: string[] = [];
    const fail = createTeeProgressReporter({
      title: 'TEE preflight',
      isTTY: true,
      ci: false,
      stages: [{ id: 'verify-batch', label: 'Verification batch', weight: 100 }],
      stream: { write: (chunk: string) => failChunks.push(String(chunk)) } as NodeJS.WritableStream,
    });
    fail.start();
    fail.complete('failed');
    expect(failChunks.join('')).toContain(ttyLiveRestoreSequence(true));
    expect(failChunks.join('')).toMatch(/100% FAIL/);
    fail.restoreTerminal();
  });

  it('T-PV-LIVE-DISABLED-029: progress off remains supported and display cannot change a result', () => {
    const result = { exitCode: 7, ok: false };
    expect(
      createHumanTeeProgress({
        title: 'Preflight',
        env: { TEE_VERIFY_PROGRESS: 'off' },
        stderrIsTty: true,
        stages: [{ id: 'verify-batch', label: 'Verification batch', weight: 100 }],
      })
    ).toBeUndefined();
    expect(shouldUseMachineProgress({ TEE_VERIFY_PROGRESS: 'plain' }, true)).toBe(true);
    expect(shouldUseMachineProgress({ TEE_VERIFY_PROGRESS: 'live' }, false)).toBe(false);
    expect(shouldUseMachineProgress({ CI: 'true', TEE_VERIFY_PROGRESS: 'live' }, true)).toBe(true);
    expect(shouldUseMachineProgress({ CURSOR_AGENT: '1', VSCODE_PID: '1' }, false)).toBe(false);
    expect(shouldUseMachineProgress({ CI: '1', CURSOR_AGENT: '1', VSCODE_PID: '1' }, true)).toBe(true);
    expect(isCursorInteractiveProgressHost({ TERM_PROGRAM: 'vscode' })).toBe(true);
    expect(isCursorInteractiveProgressHost({ TERM_PROGRAM: 'vscode', CI: 'true' })).toBe(false);
    expect(resolveProgressIsTty({ stdoutIsTty: true, stderrIsTty: false })).toBe(true);
    expect(resolveProgressIsTty({ stdoutIsTty: false, stderrIsTty: false, env: {} })).toBe(false);
    expect(shouldUseAlternateScreen({ TERM: 'dumb' })).toBe(false);
    expect(shouldUseAlternateScreen({ TERM: 'dumb', CURSOR_AGENT: '1', VSCODE_PID: '1' })).toBe(true);
    expect(shouldUseAlternateScreen({ TEE_VERIFY_PROGRESS_ALT: '0' })).toBe(false);
    expect(ttyLiveStartSequence(false)).not.toContain('\u001b[?1049h');
    const liveChunks: string[] = [];
    const live = createHumanTeeProgress({
      title: 'TEE live host',
      env: { TEE_VERIFY_PROGRESS: 'live' },
      stdoutIsTty: false,
      stderrIsTty: false,
      stages: [{ id: 'verify-batch', label: 'Verification batch', weight: 100 }],
      stream: { write: (chunk: string) => liveChunks.push(String(chunk)) } as NodeJS.WritableStream,
    });
    expect(live).toBeDefined();
    expect(liveChunks.join('')).toContain(ttyLiveStartSequence(true));
    live?.restoreTerminal();
    const chunks: string[] = [];
    const reporter = createTeeProgressReporter({
      title: 'TEE preflight',
      isTTY: true,
      ci: true,
      stages: [{ id: 'verify-batch', label: 'Verification batch', weight: 100 }],
      stream: { write: (chunk: string) => chunks.push(String(chunk)) } as NodeJS.WritableStream,
    });
    reporter.start();
    reporter.complete('failed');
    expect(chunks.join('')).not.toMatch(/\u001b|\r/);
    expect(result).toEqual({ exitCode: 7, ok: false });
  });

  it('T-PV-LIVE-SIGINT-030: SIGINT restores the terminal then re-raises without changing the result', () => {
    const chunks: string[] = [];
    const reporter = createTeeProgressReporter({
      title: 'TEE preflight',
      isTTY: true,
      ci: false,
      stages: [{ id: 'verify-batch', label: 'Verification batch', weight: 100 }],
      stream: { write: (chunk: string) => chunks.push(String(chunk)) } as NodeJS.WritableStream,
    });
    const result = { exitCode: 0, ok: true };
    reporter.start();
    const raised: NodeJS.Signals[] = [];
    const originalKill = process.kill.bind(process);
    const dispose = attachLiveProgressTerminalGuards(reporter);
    const handler = process.listeners('SIGINT').at(-1);
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === process.pid && signal === 'SIGINT') {
        raised.push('SIGINT');
        return process as never;
      }
      return originalKill(pid, signal);
    }) as typeof process.kill;
    try {
      if (typeof handler === 'function') handler('SIGINT');
    } finally {
      process.kill = originalKill;
      dispose();
    }
    expect(chunks.join('')).toContain(ttyLiveRestoreSequence(true));
    expect(raised).toEqual(['SIGINT']);
    expect(result).toEqual({ exitCode: 0, ok: true });
  });

  it('T-PV-TERMINAL-PLAN: npm test scripts map onto dashboard suites without changing command identity', () => {
    expect(resolveTerminalTestPlan(['--suite', 'vitest', '--', 'run'])).toMatchObject({
      suite: 'vitest',
      passthrough: ['run'],
    });
    expect(resolveTerminalTestPlan(['--suite', 'testsuite', '--tag', '@fleet'])).toMatchObject({
      suite: 'testsuite',
      tag: '@fleet',
    });
    expect(resolveTerminalTestPlan(['--suite', 'playwright', '--', 'contrast.spec.ts'])).toMatchObject({
      suite: 'playwright',
      passthrough: ['contrast.spec.ts'],
    });
  });

  it('T-PV-VITEST-PROGRESS-EVENTS: reporter counts only finished tests and surfaces failures immediately', () => {
    const previous = process.env.TEE_VITEST_PROGRESS_FILE;
    const file = path.join(makeTempRoot('vitest-progress'), 'progress.json');
    process.env.TEE_VITEST_PROGRESS_FILE = file;
    try {
      const vitestReporter = new TeeVitestProgressReporter();
      vitestReporter.onCollected([
        {
          type: 'suite',
          tasks: [
            { id: 't1', type: 'test', name: 'TEE-ONE' },
            { id: 't2', type: 'test', name: 'TEE-TWO' },
          ],
        },
      ]);
      vitestReporter.onTaskUpdate([['t1', { id: 't1', type: 'test', name: 'TEE-ONE', result: { state: 'run' } }]]);
      let parsed = parseTeeVitestProgressSnapshot(readFileSync(file, 'utf8'));
      expect(parsed?.total).toBe(2);
      expect(parsed?.completed).toBe(0);
      vitestReporter.onTestCaseResult({
        id: 't1',
        name: 'TEE-ONE',
        result: { state: 'fail' },
      });
      parsed = parseTeeVitestProgressSnapshot(readFileSync(file, 'utf8'));
      expect(parsed?.completed).toBe(1);
      expect(parsed?.failures).toEqual(['TEE-ONE']);
      expect(parsed?.current).toBe('TEE-ONE');
      vitestReporter.onTestCaseResult({
        id: 't2',
        name: 'TEE-TWO',
        result: { state: 'pass' },
      });
      parsed = parseTeeVitestProgressSnapshot(readFileSync(file, 'utf8'));
      expect(parsed?.completed).toBe(2);
      expect(parsed?.total).toBe(2);
      expect(parsed?.completed).toBeLessThanOrEqual(parsed?.total ?? 0);
    } finally {
      if (previous === undefined) delete process.env.TEE_VITEST_PROGRESS_FILE;
      else process.env.TEE_VITEST_PROGRESS_FILE = previous;
    }
  });
});

describe('canonical Squires contracts stay exact', () => {
  it('T-PV-REQUIRED-IDS-EXACT / T-PV-PREFLIGHT-CONTRACT: planned static checks keep exact typecheck/lint argv', () => {
    const repoRoot = makeTempRoot('static-plan');
    mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
    writeFileSync(path.join(repoRoot, 'src', 'a.ts'), 'export const value = 1;\n', 'utf8');
    const planned = planCanonicalStaticChecks({
      repoRoot,
      changedFiles: ['src/a.ts', 'notes.md'],
    });
    expect(planned.map((row) => row.name)).toEqual([
      'typecheck',
      'oxlint-changed',
      'eslint-changed',
    ]);
    expect(planned[0]?.args).toEqual(['run', 'typecheck']);
    expect(planned[1]?.args).toEqual(['oxlint', '--', 'src/a.ts']);
    expect(planned[2]?.args).toEqual(['eslint', '--', 'src/a.ts']);

    const head = initGitRepo(repoRoot);
    const built = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_exact_ids',
      kind: 'preflight',
      baseCommit: head,
      requiredTestIds: ['T-TYPECHECK', 'T-LINT'],
      runChecks: false,
      commandResults: [
        {
          name: 'typecheck',
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          summary: 'ok',
          command: 'npm run typecheck',
        },
        {
          name: 'oxlint-changed',
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          summary: 'ok',
          command: 'npx oxlint -- src/a.ts',
          files: ['src/a.ts'],
        },
        {
          name: 'eslint-changed',
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          summary: 'ok',
          command: 'npx eslint -- src/a.ts',
          files: ['src/a.ts'],
        },
      ],
    });
    expect(built.manifest.requiredTests.find((test) => test.id === 'T-TYPECHECK')?.executed).toBe(
      true
    );
    expect(built.manifest.requiredTests.find((test) => test.id === 'T-LINT')?.executed).toBe(true);
  });

  it('T-PV-FIXDELTA-CONTRACT: fix-delta still requires ledger-proven blocker IDs', () => {
    const repoRoot = makeTempRoot('fix-delta-contract');
    const head = initGitRepo(repoRoot);
    initWorkstream(repoRoot, 'ws_fix_delta', head);
    const unproven = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_fix_delta',
      kind: 'fix-delta',
      baseCommit: head,
      runChecks: false,
      closedBlockerIds: ['FD-VERIFY'],
      commandResults: [
        { name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
      ],
    });
    expect(unproven.manifest.status).toBe('failed');
    const ledger = persistFixtureLedger(repoRoot, 'ws_fix_delta', ['T-SUCCESSOR-VERIFY-001']);
    const proven = buildEvidenceManifest({
      repoRoot,
      workstreamId: 'ws_fix_delta',
      kind: 'fix-delta',
      baseCommit: head,
      runChecks: false,
      closedBlockerIds: ['FD-VERIFY'],
      verificationLedgerRefs: [ledger],
      commandResults: [
        { name: 'fixture', status: 'passed', exitCode: 0, durationMs: 1, summary: 'ok' },
      ],
    });
    expect(proven.manifest.status).toBe('passed');
    expect(proven.manifest.closedBlockerIds).toEqual(['FD-VERIFY']);
  });

  it('T-PV-FINALISE-AUTHORITY / T-PV-MIGRATION-SEMANTICS: mutating finalise/DB stages stay serial and out of the read-only batch', () => {
    const readOnly = planFinaliseReadOnlyPrechecks({
      unmergedFiles: () => [],
      changedFiles: () => [],
      branchAndHead: () => ({ branch: 'main', headSha: 'abc' }),
      protocolReadiness: () => ({ allowed: true }),
      migrationInventory: () => ['supabase/migrations/example.sql'],
      devServerInventory: () => [],
    });
    expect(readOnly.map((job) => job.id)).toEqual([...FINALISE_READONLY_PRECHECK_IDS]);
    expect(readOnly.every((job) => job.kind === 'read_only')).toBe(true);
    expect(readOnly.some((job) => FINALISE_SERIAL_MUTATING_IDS.includes(job.id as never))).toBe(
      false
    );
    const mutating = planFinaliseMutatingStages();
    expect(mutating.map((job) => job.id)).toEqual([...FINALISE_SERIAL_MUTATING_IDS]);
    expect(mutating.every((job) => job.exclusive)).toBe(true);
    expect(mutating.find((job) => job.id === 'migration-apply')?.kind).toBe('db');
    expect(mutating.find((job) => job.id === 'finalise-start')?.kind).toBe('protocol');
    expect(mutating.find((job) => job.id === 'push')?.kind).toBe('protocol');
  });

  it('T-PV-SAME-CANDIDATE packet assembly binds one HEAD/fingerprint and does not write protocol', async () => {
    const repoRoot = makeTempRoot('packet');
    const head = initGitRepo(repoRoot);
    initWorkstream(repoRoot, 'ws_packet', head);
    writePassingManifest(repoRoot, 'ws_packet', 'preflight');
    spawnSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', '.'],
      { cwd: repoRoot, shell: false }
    );
    const captured = captureFrozenVerifyCandidate({
      repoRoot,
      workstreamId: 'ws_packet',
    });
    expect(captured.ok).toBe(true);
    if (!captured.ok) throw new Error(captured.message);
    const packet = await collectPremiumPacketEvidence({
      repoRoot,
      workstreamId: 'ws_packet',
      candidate: captured.candidate,
      persist: false,
    });
    expect(packet.ok).toBe(true);
    if (!packet.ok) throw new Error(packet.message);
    expect(packet.packet.headCommit).toBe(captured.candidate.headCommit);
    expect(packet.packet.fingerprint).toBe(captured.candidate.fingerprint);
    expect(packet.packet.workstreamId).toBe('ws_packet');
    expect(packet.relativePath).toBeNull();
  });
});
