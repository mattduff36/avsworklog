#!/usr/bin/env tsx
/**
 * Terminal test launcher. Display-only dashboard plus bounded parallel jobs.
 * Does not change exit codes, test selection, or TEE evidence authority.
 */
import { randomBytes } from 'crypto';
import { unlinkSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import {
  resolveTeeVerifyJobs,
  runProcessJob,
  runVerifyBatch,
  type ProcessJobResult,
  type TeeVerifyJob,
} from '../automation/tee-parallel-verify';
import {
  attachLiveProgressTerminalGuards,
  createTeeProgressReporter,
  notifyDisplayProgress,
  resolveInteractiveProgress,
  shouldUseAlternateScreen,
} from '../automation/tee-progress';
import { readTeeVitestProgressFile } from '../automation/tee-vitest-progress-reporter';
import {
  clearAuthLifecycleIssueLog,
  enforceAuthLifecycleIssueGate,
} from '../../testsuite/runner/auth-lifecycle-audit';

export type TerminalTestSuite =
  | 'vitest'
  | 'testsuite'
  | 'testsuite-api'
  | 'testsuite-ui'
  | 'playwright';

export interface TerminalTestPlan {
  suite: TerminalTestSuite;
  title: string;
  passthrough: string[];
  tag?: string;
  grep?: string;
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

export function resolveTerminalTestPlan(argv: string[]): TerminalTestPlan {
  const suiteIndex = argv.indexOf('--suite');
  const suiteArg = suiteIndex >= 0 ? argv[suiteIndex + 1] : 'vitest';
  const known: TerminalTestSuite[] = ['vitest', 'testsuite', 'testsuite-api', 'testsuite-ui', 'playwright'];
  const suite = known.includes(suiteArg as TerminalTestSuite) ? (suiteArg as TerminalTestSuite) : 'vitest';
  const rest = argv.filter((_, index) => {
    if (index === suiteIndex || (suiteIndex >= 0 && index === suiteIndex + 1)) return false;
    return true;
  });
  const separator = rest.indexOf('--');
  const flags = separator === -1 ? rest : rest.slice(0, separator);
  const passthrough = separator === -1 ? rest : rest.slice(separator + 1);
  const titles: Record<TerminalTestSuite, string> = {
    vitest: 'TEE tests',
    testsuite: 'TEE testsuite',
    'testsuite-api': 'TEE testsuite API',
    'testsuite-ui': 'TEE testsuite UI',
    playwright: 'TEE playwright',
  };
  return {
    suite,
    title: titles[suite],
    passthrough: passthrough.length > 0 ? passthrough : suite === 'vitest' ? ['run'] : [],
    tag: readFlag(flags, '--tag'),
    grep: readFlag(flags, '--grep'),
  };
}

function createDashboard(title: string, stages: Array<{ id: string; label: string; weight: number }>) {
  const { machine } = resolveInteractiveProgress();
  const reporter = createTeeProgressReporter({
    title,
    stages,
    stream: process.env.TEE_VERIFY_PROGRESS === 'off' ? undefined : process.stderr,
    isTTY: !machine,
    ci: machine,
    useAlternateScreen: shouldUseAlternateScreen(),
  });
  const dispose = machine ? () => undefined : attachLiveProgressTerminalGuards(reporter);
  reporter.start();
  return { reporter, dispose };
}

async function runVitestJob(params: {
  cwd: string;
  label: string;
  args: string[];
  onProgress?: (snapshot: { completed: number; total: number | null; current?: string; failures?: string[] }) => void;
}): Promise<ProcessJobResult> {
  const progressFile = path.join(tmpdir(), `tee-vitest-progress-${randomBytes(8).toString('hex')}.json`);
  const timer = setInterval(() => {
    notifyDisplayProgress(() => {
      const snapshot = readTeeVitestProgressFile(progressFile);
      if (snapshot) {
        params.onProgress?.({
          completed: snapshot.completed,
          total: snapshot.total,
          current: snapshot.current ?? undefined,
          failures: snapshot.failures,
        });
      }
    });
  }, 250);
  timer.unref?.();
  try {
    return await runProcessJob({
      cwd: params.cwd,
      command: 'npx',
      args: ['vitest', ...params.args],
      env: {
        ...process.env,
        TEE_VITEST_PROGRESS_FILE: progressFile,
      },
    });
  } finally {
    clearInterval(timer);
    try {
      unlinkSync(progressFile);
    } catch {
      /* display-only temp file */
    }
  }
}

function printJobOutput(result: ProcessJobResult, label: string): void {
  const output = [result.stderr, result.stdout].filter((part) => part.trim().length > 0).join('\n');
  if (!output) return;
  process.stderr.write(`\n${label} output\n${output}\n`);
}

export async function runTerminalTests(argv: string[], cwd = process.cwd()): Promise<number> {
  const plan = resolveTerminalTestPlan(argv);
  if (plan.suite === 'vitest') {
    const { reporter, dispose } = createDashboard(plan.title, [
      { id: 'vitest', label: 'Vitest', weight: 100 },
    ]);
    reporter.stageStart('vitest');
    reporter.setWorkers([{ id: 'vitest', label: 'Vitest' }]);
    reporter.workerUpdate('vitest', 'running');
    const result = await runVitestJob({
      cwd,
      label: 'Vitest',
      args: plan.passthrough,
      onProgress: (snapshot) => {
        reporter.workerUpdate('vitest', 'running', snapshot);
      },
    });
    reporter.workerUpdate('vitest', result.status === 'passed' ? 'passed' : 'failed');
    reporter.stageFinish('vitest', result.status === 'passed' ? 'passed' : 'failed');
    reporter.complete(result.status === 'passed' ? 'passed' : 'failed');
    dispose();
    if (result.status !== 'passed') printJobOutput(result, 'Vitest');
    return result.exitCode ?? (result.status === 'passed' ? 0 : 1);
  }

  if (plan.suite === 'playwright') {
    const { reporter, dispose } = createDashboard(plan.title, [
      { id: 'playwright', label: 'Playwright', weight: 100 },
    ]);
    reporter.stageStart('playwright');
    const result = await runProcessJob({
      cwd,
      command: 'npx',
      args: ['playwright', 'test', ...plan.passthrough],
    });
    reporter.stageFinish('playwright', result.status === 'passed' ? 'passed' : 'failed');
    reporter.complete(result.status === 'passed' ? 'passed' : 'failed');
    dispose();
    if (result.status !== 'passed') printJobOutput(result, 'Playwright');
    return result.exitCode ?? (result.status === 'passed' ? 0 : 1);
  }

  const runApi = plan.suite === 'testsuite' || plan.suite === 'testsuite-api';
  const runUi =
    plan.suite === 'testsuite' ||
    plan.suite === 'testsuite-ui' ||
    Boolean(plan.tag) ||
    Boolean(plan.grep);
  clearAuthLifecycleIssueLog();

  const stages = [
    { id: 'verify-batch', label: 'Verification batch', weight: 80 },
    { id: 'report', label: 'Report generation', weight: 12 },
    { id: 'auth-gate', label: 'Auth lifecycle gate', weight: 8 },
  ];
  const { reporter, dispose } = createDashboard(plan.title, stages);
  reporter.stageStart('verify-batch');

  const jobs: Array<TeeVerifyJob<ProcessJobResult>> = [];
  if (runApi) {
    const args = ['run', '--config=testsuite/config/vitest.config.ts'];
    if (plan.grep) args.push('-t', plan.grep);
    if (plan.tag) args.push('-t', plan.tag);
    jobs.push({
      id: 'api',
      label: 'API tests',
      kind: 'read_only',
      isolationGroup: 'vitest',
      weight: 40,
      run: () =>
        runVitestJob({
          cwd,
          label: 'API tests',
          args,
          onProgress: (snapshot) => {
            reporter.workerUpdate('api', 'running', snapshot);
          },
        }),
    });
  }
  if (runUi) {
    const args = ['playwright', 'test', '--config=testsuite/config/playwright.config.ts'];
    if (plan.grep) args.push('--grep', plan.grep);
    if (plan.tag) args.push('--grep', plan.tag);
    jobs.push({
      id: 'ui',
      label: 'UI tests',
      kind: 'read_only',
      isolationGroup: 'playwright',
      weight: 40,
      run: () => runProcessJob({ cwd, command: 'npx', args }),
    });
  }

  reporter.setWorkers(jobs.map((job) => ({ id: job.id, label: job.label })));
  const batch = await runVerifyBatch({
    jobs,
    maxJobs: resolveTeeVerifyJobs(),
    progress: reporter,
  });
  reporter.stageFinish('verify-batch', batch.ok ? 'passed' : 'failed');

  reporter.stageStart('report');
  const report = await runProcessJob({
    cwd,
    command: 'npx',
    args: ['tsx', 'testsuite/runner/report.ts'],
  });
  reporter.stageFinish('report', report.status === 'passed' ? 'passed' : 'failed');

  reporter.stageStart('auth-gate');
  let authOk = true;
  try {
    authOk = await enforceAuthLifecycleIssueGate({
      interactive: process.stdin.isTTY === true && process.env.CI !== 'true',
    });
  } catch (error) {
    authOk = false;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
  reporter.stageFinish('auth-gate', authOk ? 'passed' : 'failed');
  const ok = batch.ok && report.status === 'passed' && authOk;
  reporter.complete(ok ? 'passed' : 'failed');
  dispose();
  for (const result of batch.results) {
    const value = result.value;
    if (value && result.status === 'failed') {
      printJobOutput(value, result.label);
    }
  }
  if (report.status !== 'passed') printJobOutput(report, 'Report generation');
  return ok ? 0 : 1;
}

async function main(): Promise<void> {
  const code = await runTerminalTests(process.argv.slice(2));
  process.exit(code);
}

const launchedDirectly = /run-terminal-tests\.(ts|js|mjs|cjs)$/u.test(
  (process.argv[1] ?? '').replace(/\\/g, '/')
);
if (launchedDirectly && process.env.VITEST !== 'true') {
  void main();
}
