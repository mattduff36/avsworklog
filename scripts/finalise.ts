import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { config } from 'dotenv';
import { existsSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import pg from 'pg';
import { parseCommitsFromMessages, selectPrimaryCommitMessage } from '../lib/config/release-version-logic';
import { AutomationRun } from './automation/logger';
import {
  type FinaliseModeKey,
  markOrdinaryFinaliseStep,
  markFinaliseCheckpointStep,
  resolveActiveProtocolFinaliseContext,
} from './automation/finalise-checkpoint';
import {
  assertFinaliseAllowedForProtocol,
  formatFinaliseProtocolReadinessReport,
  getFinaliseProtocolReadiness,
} from './automation/workflow-finalise-correlation';
import {
  assertFinaliseProductCommitAllowed,
  recordFinaliseOwnedCommit,
} from './automation/workflow-review-protocol';
import {
  clearFinaliseFailureArtifact,
  writeFinaliseFailureArtifact,
} from './automation/finalise-failure';
import { appendWorkflowAnomalySignal } from './automation/workflow-events';
import { checkFinaliseBlockingActivity, formatBlockingActivity } from './finalise-activity-guard';
import {
  getSkippableFinaliseTasks,
  type FinaliseTaskKey,
  type RecentFinaliseTaskRun,
} from './finalise-recent-tasks';
import {
  type FinaliseChangedFile,
  buildFinaliseCommitOutcomeMetadata,
  buildFinalisePushOutcomeMetadata,
  buildFinaliseTimingSummaryMetadata,
  formatReleaseVersionCommitMessage,
  getFinaliseSlowStepNotice,
  getFinaliseTimingSummaryLines,
  summarizeFinaliseChanges,
  type FinaliseTimingEntry,
} from './finalise-summary';
import {
  decideFinaliseMigrationLedgerAction,
  type FinaliseMigrationFile,
  getFinaliseMigrationDiscoveryPaths,
  getFinaliseMigrationFilesFromPaths,
  getSafeDatabaseTargetIdentity,
  getValidatedMigrationEvidencePaths,
  loadFinaliseMigrationFiles,
  requireSafeMigrationConnectionString,
} from './finalise-migrations';
import {
  applyMigrationWithLedger,
  readMigrationLedgerRows,
} from './migration-executor';
import { planFinaliseReadOnlyPrechecks } from './automation/tee-finalise-prechecks';
import {
  captureFrozenVerifyCandidate,
  createFinaliseProgressReporter,
  requireProcessSuccess,
  runProcessJob,
  runVerifyBatch,
  type TeeProgressReporter,
} from './automation/tee-parallel-verify';
import { formatDurationMs, notifyDisplayProgress, resolveInteractiveProgress } from './automation/tee-progress';

config({ path: path.resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const REPO_ROOT = process.cwd();
const NEXT_BUILD_DIR = path.join(REPO_ROOT, '.next');
const NEXT_BUILD_ARTIFACT_PATH = path.join(NEXT_BUILD_DIR, 'BUILD_ID');
const RELEASE_VERSION_JSON_PATH = path.join(REPO_ROOT, 'lib/config/release-version.json');
const FINALISE_HIGH_DURATION_MS = 15 * 60 * 1000;
let activeFinaliseProgress: TeeProgressReporter | null = null;
let activeFinaliseProgressTTY = false;

function recordFinaliseCheckpointStep(params: {
  mode: FinaliseModeKey;
  task: FinaliseTaskKey;
  status: 'passed' | 'failed' | 'started' | 'incomplete';
  command: string;
  exitCode?: number | null;
  artifactPaths?: string[];
}): void {
  const active = resolveActiveProtocolFinaliseContext(REPO_ROOT);
  if (active) {
    markFinaliseCheckpointStep({
      repoRoot: REPO_ROOT,
      workstreamId: active.workstreamId,
      checkpointId: active.checkpointId,
      task: params.task,
      status: params.status,
      command: params.command,
      exitCode: params.exitCode,
      artifactPaths: params.artifactPaths,
    });
    return;
  }
  markOrdinaryFinaliseStep({
    repoRoot: REPO_ROOT,
    mode: params.mode,
    task: params.task,
    status: params.status,
    command: params.command,
    exitCode: params.exitCode,
    artifactPaths: params.artifactPaths,
  });
}
const RELEASE_VERSION_FILES = [
  'lib/config/release-version.json',
  'lib/config/release-history.json',
  'docs_private/release-log.md',
] as const;
const DEV_SERVER_PORT = 4000;
let automationRun: AutomationRun | null = null;

interface FinaliseOptions {
  full: boolean;
  push: boolean;
  dryRun: boolean;
  help: boolean;
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface ProcessInfo {
  pid: number;
  parentPid: number;
  commandLine: string;
}

interface RunCommandOptions {
  allowFailure?: boolean;
  captureOutput?: boolean;
  env?: NodeJS.ProcessEnv;
}

interface ManagedProcess {
  child: ChildProcess;
  label: string;
  output: string[];
}

interface ReleaseVersionState {
  mmyy: string;
  major: number;
  minor: number;
  lastProcessedSha: string;
}

interface MigrationRunSummary {
  applied: string[];
  reused: string[];
  deferred: string[];
}

function parseArgs(argv: string[]): FinaliseOptions {
  const args = new Set(argv);

  return {
    full: args.has('--full'),
    push: args.has('--push'),
    dryRun: args.has('--dry-run'),
    help: args.has('--help') || args.has('-h'),
  };
}

function normalizeForMatch(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

function quoteArg(value: string): string {
  if (!/[ \t"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function getExecutable(command: string): string {
  if (process.platform !== 'win32') {
    return command;
  }

  if (command === 'git') {
    return command;
  }

  if (command === 'npm') {
    return 'npm.cmd';
  }

  if (command === 'npx') {
    return 'npx.cmd';
  }

  return command;
}

function shouldUseShell(command: string): boolean {
  if (process.platform !== 'win32') return false;
  return !['git', 'powershell.exe', 'pwsh.exe'].includes(command.toLowerCase());
}

function appendManagedOutput(managedProcess: ManagedProcess, chunk: string | Buffer | null | undefined): void {
  if (!chunk) {
    return;
  }

  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  if (!text) {
    return;
  }

  managedProcess.output.push(text);
  if (managedProcess.output.length > 20) {
    managedProcess.output.splice(0, managedProcess.output.length - 20);
  }
}

function runCommand(command: string, args: string[], options: RunCommandOptions = {}): CommandResult {
  if (automationRun) {
    return automationRun.runCommand(command, args, options);
  }

  const result = spawnSync(getExecutable(command), args, {
    cwd: REPO_ROOT,
    env: options.env ?? process.env,
    shell: shouldUseShell(command),
    encoding: 'utf8',
    stdio: options.captureOutput ? 'pipe' : 'inherit',
  });

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';

  if (!options.allowFailure && result.status !== 0) {
    const renderedCommand = [command, ...args.map(quoteArg)].join(' ');
    const executionError = result.error instanceof Error ? `: ${result.error.message}` : '';
    throw new Error(`Command failed (${renderedCommand})${executionError}`);
  }

  return {
    status: result.status,
    stdout,
    stderr,
  };
}

function getTrimmedLines(output: string): string[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getGitStatusPorcelain(): string {
  return runCommand('git', ['status', '--porcelain'], {
    captureOutput: true,
  }).stdout.trim();
}

function hasUncommittedChanges(): boolean {
  return getGitStatusPorcelain().length > 0;
}

function getCurrentBranch(): string {
  return runCommand('git', ['branch', '--show-current'], {
    captureOutput: true,
  }).stdout.trim();
}

function getHeadSha(): string {
  return runCommand('git', ['rev-parse', 'HEAD'], {
    captureOutput: true,
  }).stdout.trim();
}

function parseChangedFileStats(trackedStdout: string, untrackedStdout: string): FinaliseChangedFile[] {
  const statsByPath = new Map<string, FinaliseChangedFile>();

  getTrimmedLines(trackedStdout).forEach((line) => {
    const [rawAdditions, rawDeletions, rawPath] = line.split(/\t/u);
    const filePath = rawPath || '';
    if (!filePath) return;

    const additions = Number.parseInt(rawAdditions || '0', 10);
    const deletions = Number.parseInt(rawDeletions || '0', 10);
    statsByPath.set(filePath, {
      path: filePath,
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    });
  });

  getTrimmedLines(untrackedStdout).forEach((filePath) => {
    if (!statsByPath.has(filePath)) {
      statsByPath.set(filePath, { path: filePath, additions: 0, deletions: 0 });
    }
  });

  return Array.from(statsByPath.values());
}

async function collectFinaliseReadOnlyPrechecks(
  progress?: TeeProgressReporter
): Promise<{
  unmergedFiles: string[];
  changedFileStats: FinaliseChangedFile[];
  branch: string;
  headSha: string;
  protocolReadiness: ReturnType<typeof getFinaliseProtocolReadiness>;
  migrationDiscoveryPaths: string[];
  devServerProcesses: ProcessInfo[];
}> {
  const captured = captureFrozenVerifyCandidate({ repoRoot: REPO_ROOT });
  if (!captured.ok) {
    throw new Error(captured.message);
  }
  const batch = await runVerifyBatch<unknown>({
    candidate: captured.candidate,
    readCandidate: () => {
      const current = captureFrozenVerifyCandidate({ repoRoot: REPO_ROOT });
      return current.ok ? current.candidate : { error: current.message };
    },
    jobs: planFinaliseReadOnlyPrechecks({
      unmergedFiles: async () => {
        const result = await runProcessJob({
          cwd: REPO_ROOT,
          command: 'git',
          args: ['diff', '--name-only', '--diff-filter=U'],
        });
        return getTrimmedLines(requireProcessSuccess(result, 'git merge-conflict listing'));
      },
      changedFiles: async () => {
        const tracked = await runProcessJob({
          cwd: REPO_ROOT,
          command: 'git',
          args: ['diff', '--numstat', 'HEAD', '--'],
        });
        const untracked = await runProcessJob({
          cwd: REPO_ROOT,
          command: 'git',
          args: ['ls-files', '--others', '--exclude-standard'],
        });
        return parseChangedFileStats(
          requireProcessSuccess(tracked, 'git changed-file listing'),
          requireProcessSuccess(untracked, 'git untracked-file listing')
        );
      },
      branchAndHead: async () => {
        const branch = await runProcessJob({
          cwd: REPO_ROOT,
          command: 'git',
          args: ['branch', '--show-current'],
        });
        const head = await runProcessJob({
          cwd: REPO_ROOT,
          command: 'git',
          args: ['rev-parse', 'HEAD'],
        });
        return {
          branch: requireProcessSuccess(branch, 'git branch').trim(),
          headSha: requireProcessSuccess(head, 'git HEAD').trim(),
        };
      },
      protocolReadiness: () => getFinaliseProtocolReadiness(REPO_ROOT),
      migrationInventory: () =>
        getFinaliseMigrationDiscoveryPaths(REPO_ROOT, (args) =>
          runCommand('git', args, { captureOutput: true, allowFailure: true })
        ),
      devServerInventory: () => getRepoDevServerProcesses(),
    }).map((job) => ({
      ...job,
      run: async () => {
        notifyDisplayProgress(() => progress?.stageStart(job.id));
        try {
          const value = await job.run();
          notifyDisplayProgress(() => progress?.stageFinish(job.id, 'passed'));
          return value;
        } catch (error) {
          notifyDisplayProgress(() => progress?.stageFinish(job.id, 'failed'));
          throw error;
        }
      },
    })),
    progress,
  });
  if (batch.foundational) {
    throw new Error(batch.foundationalMessage ?? 'finalise read-only prechecks failed');
  }
  const byId = new Map(batch.results.map((result) => [result.id, result]));
  const requireValue = <T>(id: string): T => {
    const row = byId.get(id);
    if (!row || row.status !== 'passed' || row.value === undefined) {
      throw new Error(row?.error ?? `finalise precheck failed: ${id}`);
    }
    return row.value as T;
  };
  const branchAndHead = requireValue<{ branch: string; headSha: string }>('git-branch-head');
  return {
    unmergedFiles: requireValue<string[]>('git-unmerged'),
    changedFileStats: requireValue<FinaliseChangedFile[]>('git-changed-files'),
    branch: branchAndHead.branch,
    headSha: branchAndHead.headSha,
    protocolReadiness: requireValue<ReturnType<typeof getFinaliseProtocolReadiness>>(
      'protocol-readiness'
    ),
    migrationDiscoveryPaths: requireValue<string[]>('migration-inventory'),
    devServerProcesses: requireValue<ProcessInfo[]>('dev-server-inventory'),
  };
}

async function runCommandAsyncWithHeartbeat(
  command: string,
  args: string[],
  options: RunCommandOptions & { label: string; percent: number }
): Promise<CommandResult> {
  const started = Date.now();
  const timer = setInterval(() => {
    printProgress(
      `${options.label} still running (${formatDurationMs(Date.now() - started)} elapsed)`,
      options.percent
    );
  }, 15_000);
  timer.unref?.();
  try {
    const result = await runProcessJob({
      cwd: REPO_ROOT,
      command: getExecutable(command),
      args,
      env: options.env ?? process.env,
      onStdout: options.captureOutput ? undefined : (text) => process.stdout.write(text),
      onStderr: options.captureOutput ? undefined : (text) => process.stderr.write(text),
    });
    if (automationRun) {
      automationRun.recordStep({
        name: [command, ...args.map(quoteArg)].join(' '),
        status: result.status === 'passed' || options.allowFailure ? 'passed' : 'failed',
        startedAt: new Date(started).toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: result.durationMs,
        command: result.command,
        exitCode: result.exitCode,
        output: `${result.stdout}${result.stderr}`.slice(0, 500_000),
      });
    }
    if (!options.allowFailure && result.status !== 'passed') {
      throw new Error(
        `Command failed (${[command, ...args.map(quoteArg)].join(' ')})${
          result.exitCode !== null ? ` with exit code ${result.exitCode}` : ''
        }`
      );
    }
    return {
      status: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    clearInterval(timer);
  }
}

function readReleaseVersionState(): ReleaseVersionState {
  const raw = readFileSync(RELEASE_VERSION_JSON_PATH, 'utf8');
  return JSON.parse(raw) as ReleaseVersionState;
}

function formatReleaseVersionLabel(state: Pick<ReleaseVersionState, 'mmyy' | 'major' | 'minor'>): string {
  return `${state.mmyy}.${state.major}.${state.minor}`;
}

function hasReleaseVersionChanges(): boolean {
  const status = runCommand('git', ['status', '--porcelain', '--', ...RELEASE_VERSION_FILES], {
    captureOutput: true,
  });

  return status.stdout.trim().length > 0;
}

function getReleaseCommitPrimaryMessage(beforeSha: string, afterSha: string): string | null {
  if (!beforeSha || beforeSha === '0000000000000000000000000000000000000000') {
    return null;
  }

  const log = runCommand('git', ['log', '--format=%s', `${beforeSha}..${afterSha}`], {
    captureOutput: true,
  });
  const commits = parseCommitsFromMessages(getTrimmedLines(log.stdout));

  return selectPrimaryCommitMessage(commits);
}

function commitReleaseVersionChanges(primaryCommitMessage: string | null): string | null {
  if (!hasReleaseVersionChanges()) {
    return null;
  }

  const version = formatReleaseVersionLabel(readReleaseVersionState());
  runCommand('git', ['add', ...RELEASE_VERSION_FILES]);
  runCommand('git', ['commit', '-m', formatReleaseVersionCommitMessage(primaryCommitMessage, version)]);

  return version;
}

function getPushModeDescription(options: FinaliseOptions): string {
  if (options.dryRun) {
    return 'dry-run';
  }

  if (options.full && options.push) {
    return 'full + push';
  }

  if (options.full) {
    return 'full';
  }

  if (options.push) {
    return 'push';
  }

  return 'standard';
}

function getFinaliseModeKey(options: FinaliseOptions): FinaliseModeKey {
  if (options.full && options.push) return 'ffap';
  if (options.full) return 'finalise-full';
  if (options.push) return 'fap';
  return 'finalise';
}

async function runDeterministicFinaliseStep<T>(params: {
  mode: FinaliseModeKey;
  task: FinaliseTaskKey;
  command: string;
  artifactPaths?: string[];
  action: () => Promise<T> | T;
}): Promise<T> {
  recordFinaliseCheckpointStep({
    ...params,
    status: 'started',
  });
  try {
    const result = await params.action();
    recordFinaliseCheckpointStep({
      ...params,
      status: 'passed',
      exitCode: 0,
    });
    return result;
  } catch (error) {
    recordFinaliseCheckpointStep({
      ...params,
      status: 'failed',
      exitCode: 1,
    });
    const active = resolveActiveProtocolFinaliseContext(REPO_ROOT);
    writeFinaliseFailureArtifact({
      repoRoot: REPO_ROOT,
      originalMode: params.mode,
      failedStep: params.task,
      command: params.command,
      workstreamId: active?.workstreamId ?? null,
    });
    throw error;
  }
}

function printProgress(message: string, percent: number): void {
  notifyDisplayProgress(() => {
    activeFinaliseProgress?.setSubtitle(message);
  });
  if (activeFinaliseProgressTTY) return;
  console.log(`- ${message} [${percent}% complete]`);
}

function recordFinaliseTimingEntry(timings: FinaliseTimingEntry[], entry: FinaliseTimingEntry): void {
  timings.push(entry);
  const slowNotice = getFinaliseSlowStepNotice(entry);
  if (slowNotice) {
    console.log(`- ${slowNotice}`);
  }
}

async function timeFinaliseStep<T>(
  timings: FinaliseTimingEntry[],
  label: string,
  action: () => Promise<T> | T
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await action();
    recordFinaliseTimingEntry(timings, {
      label,
      durationMs: Date.now() - startedAt,
      status: 'completed',
    });
    return result;
  } catch (error) {
    recordFinaliseTimingEntry(timings, {
      label,
      durationMs: Date.now() - startedAt,
      status: 'failed',
    });
    throw error;
  }
}

async function recordFinaliseTimingSummary(
  run: AutomationRun,
  timings: FinaliseTimingEntry[]
): Promise<void> {
  const metadata = buildFinaliseTimingSummaryMetadata(timings);
  await run.step('Record timing summary', () => undefined, metadata);
}

function recordFinaliseDurationAnomaly(
  mode: FinaliseModeKey,
  timings: FinaliseTimingEntry[]
): void {
  const durationMs = timings.reduce((total, entry) => total + entry.durationMs, 0);
  if (durationMs <= FINALISE_HIGH_DURATION_MS) return;
  appendWorkflowAnomalySignal({
    repoRoot: REPO_ROOT,
    eventId: `finalise-duration:${mode}:${Date.now()}`,
    flags: ['finalise-high-duration'],
  });
}

function formatRecentTask(run: RecentFinaliseTaskRun): string {
  return `${run.command} (${run.source}, completed ${run.completedAt})`;
}

function getRecentTaskMetadata(run: RecentFinaliseTaskRun): Record<string, unknown> {
  return {
    reason: run.source === 'exact-cache' ? 'exact-fingerprint-match' : 'recent-successful-run',
    command: run.command,
    completedAt: run.completedAt,
    source: run.source,
  };
}

interface BuildProgressMilestone {
  message: string;
  percent: number;
  patterns: RegExp[];
}

const BUILD_PROGRESS_MILESTONES: BuildProgressMilestone[] = [
  {
    message: 'Compiling application bundles...',
    percent: 34,
    patterns: [/Creating an optimized production build/u],
  },
  {
    message: 'Application bundles compiled.',
    percent: 38,
    patterns: [/Compiled successfully/u],
  },
  {
    message: 'Running lint and TypeScript validation...',
    percent: 41,
    patterns: [/Linting and checking validity of types/u],
  },
  {
    message: 'Collecting route and page data...',
    percent: 44,
    patterns: [/Collecting page data/u],
  },
  {
    message: 'Generating static route output...',
    percent: 47,
    patterns: [/Generating static pages/u],
  },
  {
    message: 'Finalising route manifests and build traces...',
    percent: 49,
    patterns: [/Finalizing page optimization/u, /Collecting build traces/u],
  },
];

function handleBuildProgressLine(line: string, printedMilestones: Set<number>): void {
  BUILD_PROGRESS_MILESTONES.forEach((milestone, index) => {
    if (printedMilestones.has(index)) return;
    if (!milestone.patterns.some((pattern) => pattern.test(line))) return;

    printedMilestones.add(index);
    notifyDisplayProgress(() => {
      activeFinaliseProgress?.stageUpdate('production-build', {
        ratio: printedMilestones.size / BUILD_PROGRESS_MILESTONES.length,
        detail: milestone.message,
      });
    });
    printProgress(milestone.message, milestone.percent);
  });
}

function runCleanProductionBuildWithProgress(): Promise<void> {
  return new Promise((resolve, reject) => {
    printProgress('Starting clean Next.js production build...', 32);
    const printedMilestones = new Set<number>();
    let bufferedOutput = '';

    const child = spawn(getExecutable('npm'), ['run', 'build'], {
      cwd: REPO_ROOT,
      env: process.env,
      shell: shouldUseShell('npm'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    function processOutput(chunk: string | Buffer, writer: NodeJS.WriteStream): void {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      writer.write(text);
      bufferedOutput += text;

      const lines = bufferedOutput.split(/\r?\n/u);
      bufferedOutput = lines.pop() || '';
      lines.forEach((line) => handleBuildProgressLine(line, printedMilestones));
    }

    child.stdout?.on('data', (chunk: string | Buffer) => processOutput(chunk, process.stdout));
    child.stderr?.on('data', (chunk: string | Buffer) => processOutput(chunk, process.stderr));
    child.on('error', reject);
    child.on('close', (code) => {
      if (bufferedOutput) {
        handleBuildProgressLine(bufferedOutput, printedMilestones);
      }

      if (code === 0) {
        printProgress('Build passed.', 50);
        resolve();
        return;
      }

      reject(new Error(`Command failed (npm run build)${typeof code === 'number' ? ` with exit code ${code}` : ''}`));
    });
  });
}

function getLocalProductionBaseUrl(): string {
  return `http://127.0.0.1:${DEV_SERVER_PORT}`;
}

function getLocalTestEnv(): NodeJS.ProcessEnv {
  const baseUrl = getLocalProductionBaseUrl();

  return {
    ...process.env,
    PORT: String(DEV_SERVER_PORT),
    NEXT_PUBLIC_SITE_URL: baseUrl,
    TESTSUITE_BASE_URL: baseUrl,
  };
}

function runUnloggedCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(getExecutable(command), args, {
    cwd: REPO_ROOT,
    env: process.env,
    shell: shouldUseShell(command),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50,
  });

  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

function migrationNeedsDbValidate(relativePath: string): boolean {
  const content = readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

  return (
    /\bcreate\s+(?:table|type|function|index|schema|trigger|policy)\b/iu.test(content) ||
    /\balter\s+table\b/iu.test(content) ||
    /\balter\s+table\b[\s\S]{0,200}\brename\b/iu.test(content) ||
    /\bdrop\s+column\b/iu.test(content) ||
    /\bdrop\s+table\b/iu.test(content)
  );
}

function getDbConnectionString(): string {
  return requireSafeMigrationConnectionString(process.env.POSTGRES_URL_NON_POOLING);
}

async function createDbClient(): Promise<pg.Client> {
  const connectionString = getDbConnectionString();
  const url = new URL(connectionString);

  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  return client;
}

export async function inspectPendingMigrations(
  migrationFiles: FinaliseMigrationFile[],
  deferred: string[]
): Promise<MigrationRunSummary> {
  if (migrationFiles.length === 0) {
    return { applied: [], reused: [], deferred };
  }
  const client = await createDbClient();
  try {
    const ledgerRows = await readMigrationLedgerRows(client, migrationFiles);
    const summary: MigrationRunSummary = { applied: [], reused: [], deferred };
    for (const migration of migrationFiles) {
      const decision = decideFinaliseMigrationLedgerAction(
        migration,
        ledgerRows.get(migration.relativePath) ?? null
      );
      summary[decision === 'apply' ? 'applied' : 'reused'].push(migration.relativePath);
    }
    return summary;
  } finally {
    await client.end();
  }
}

async function runPendingMigrations(
  migrationFiles: FinaliseMigrationFile[],
  deferred: string[]
): Promise<MigrationRunSummary> {
  const client = await createDbClient();
  const summary: MigrationRunSummary = { applied: [], reused: [], deferred };

  try {
    for (const migration of migrationFiles) {
      const result = await applyMigrationWithLedger(client, migration, {
        onDecision: (decision) => {
          if (decision === 'apply') {
            console.log(`\n==> Apply migration ${migration.relativePath}`);
          }
        },
      });
      if (result.action === 'reuse') {
        summary.reused.push(migration.relativePath);
        console.log(`\n==> Reuse applied migration ${migration.relativePath}`);
        continue;
      }
      summary.applied.push(migration.relativePath);
    }
    return summary;
  } finally {
    await client.end();
  }
}

function formatMigrationFiles(files: string[]): string {
  return files.length > 0 ? `${files.length} (${files.join(', ')})` : '0 (none)';
}

function listProcesses(): ProcessInfo[] {
  if (process.platform === 'win32') {
    const command = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      '$items = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine',
      '$items | ConvertTo-Json -Compress',
    ].join('; ');

    const result = runUnloggedCommand('powershell.exe', ['-NoProfile', '-Command', command]);

    if (result.status !== 0 || result.stdout.trim().length === 0) {
      return [];
    }

    const parsed = JSON.parse(result.stdout) as
      | { ProcessId?: number; ParentProcessId?: number; CommandLine?: string }
      | Array<{ ProcessId?: number; ParentProcessId?: number; CommandLine?: string }>;
    const items = Array.isArray(parsed) ? parsed : [parsed];

    return items
      .map((item) => ({
        pid: Number(item.ProcessId ?? 0),
        parentPid: Number(item.ParentProcessId ?? 0),
        commandLine: item.CommandLine ?? '',
      }))
      .filter((item) => item.pid > 0 && item.commandLine.trim().length > 0);
  }

  const result = runUnloggedCommand('ps', ['-Ao', 'pid=,ppid=,command=']);

  if (result.status !== 0) {
    return [];
  }

  return getTrimmedLines(result.stdout)
    .map((line) => line.match(/^(\d+)\s+(\d+)\s+(.*)$/u))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      commandLine: match[3],
    }));
}

function isRepoDevServerProcess(processInfo: ProcessInfo): boolean {
  const commandLine = normalizeForMatch(processInfo.commandLine);
  const repoRoot = normalizeForMatch(REPO_ROOT);
  const matchesDevCommand =
    commandLine.includes('npm run dev') ||
    commandLine.includes('next dev') ||
    commandLine.includes('next/dist/bin/next') ||
    commandLine.includes('next\\dist\\bin\\next');
  const matchesRepo =
    commandLine.includes(repoRoot) ||
    commandLine.includes(`${repoRoot}/node_modules/next`) ||
    commandLine.includes(`${repoRoot}/node_modules/npm`);
  const matchesPort =
    commandLine.includes(`-p ${DEV_SERVER_PORT}`) || commandLine.includes(`--port ${DEV_SERVER_PORT}`);

  return matchesDevCommand && matchesRepo && (matchesPort || commandLine.includes('npm run dev'));
}

function getRepoDevServerProcesses(): ProcessInfo[] {
  const seen = new Set<number>();

  return listProcesses().filter((processInfo) => {
    if (!isRepoDevServerProcess(processInfo) || seen.has(processInfo.pid)) {
      return false;
    }

    seen.add(processInfo.pid);
    return true;
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopRepoDevServer(): Promise<number[]> {
  const processes = getRepoDevServerProcesses();
  const pids = processes.map((processInfo) => processInfo.pid);

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process already exited.
    }
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await sleep(1000);
    const remaining = pids.filter((pid) => isProcessAlive(pid));
    if (remaining.length === 0) {
      return pids;
    }
  }

  const remaining = pids.filter((pid) => isProcessAlive(pid));
  for (const pid of remaining) {
    if (process.platform === 'win32') {
      runCommand('taskkill', ['/PID', String(pid), '/T', '/F'], {
        allowFailure: true,
      });
      continue;
    }

    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process already exited.
    }
  }

  return pids;
}

function getManagedProcessOutput(managedProcess: ManagedProcess): string {
  return managedProcess.output.join('').trim();
}

function startManagedProcess(
  command: string,
  args: string[],
  label: string,
  env: NodeJS.ProcessEnv = process.env
): ManagedProcess {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const managedProcess: ManagedProcess = {
    child,
    label,
    output: [],
  };

  child.stdout?.on('data', (chunk) => appendManagedOutput(managedProcess, chunk));
  child.stderr?.on('data', (chunk) => appendManagedOutput(managedProcess, chunk));

  return managedProcess;
}

async function waitForServerReady(managedProcess: ManagedProcess, url: string, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (/\bready in\b/iu.test(getManagedProcessOutput(managedProcess))) {
      return;
    }

    if (managedProcess.child.exitCode !== null) {
      const details = getManagedProcessOutput(managedProcess);
      throw new Error(
        `${managedProcess.label} exited before becoming ready${details ? `\n${details}` : ''}`
      );
    }

    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(1_000),
      });
      if (response.status > 0) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await sleep(500);
  }

  const details = getManagedProcessOutput(managedProcess);
  throw new Error(
    `${managedProcess.label} did not become ready within ${timeoutMs}ms${details ? `\n${details}` : ''}`
  );
}

async function stopManagedProcess(managedProcess: ManagedProcess): Promise<void> {
  const pid = managedProcess.child.pid;
  if (!pid) {
    return;
  }

  if (managedProcess.child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    runCommand('taskkill', ['/PID', String(pid), '/T', '/F'], {
      allowFailure: true,
    });
    return;
  }

  try {
    managedProcess.child.kill('SIGTERM');
  } catch {
    return;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (managedProcess.child.exitCode !== null) {
      return;
    }
    await sleep(500);
  }

  try {
    managedProcess.child.kill('SIGKILL');
  } catch {
    // Process already exited.
  }
}

function removeNextBuildOutput(): boolean {
  if (!existsSync(NEXT_BUILD_DIR)) {
    return false;
  }

  rmSync(NEXT_BUILD_DIR, { recursive: true, force: true });
  return true;
}

function commitAllChanges(commitMessage: string): boolean {
  if (!hasUncommittedChanges()) {
    return false;
  }

  assertFinaliseProductCommitAllowed(REPO_ROOT);
  runCommand('git', ['add', '-A']);
  runCommand('git', ['commit', '-m', commitMessage]);
  return true;
}

function pushCurrentBranch(): string {
  const branch = getCurrentBranch();
  if (!branch) {
    throw new Error('Cannot push from a detached HEAD state');
  }

  const upstream = runCommand('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    captureOutput: true,
    allowFailure: true,
  });

  if (upstream.status === 0 && upstream.stdout.trim().length > 0) {
    runCommand('git', ['push']);
    return branch;
  }

  runCommand('git', ['push', '-u', 'origin', 'HEAD']);
  return branch;
}

function printHelp(): void {
  console.log(`Usage: npx tsx scripts/finalise.ts [--full] [--push] [--dry-run]

Variants:
  --full     Run the full automated test suite after the clean build
  --push     Push the current branch after commit
  --dry-run  Print the planned actions without changing anything
`);
}

function assertNoBlockingCursorActivity(): void {
  const activityCheck = checkFinaliseBlockingActivity(REPO_ROOT, [process.pid, process.ppid]);
  const nowMs = Date.now();
  const blockingActivities = activityCheck.blockingActivities.filter((activity) => {
    if (!activity.isFinalise || activity.isAgentReview || !activity.startedAt) return true;
    const startedAtMs = Date.parse(activity.startedAt);
    if (Number.isNaN(startedAtMs)) return true;
    // Cursor writes the current terminal metadata before this script can run.
    // Ignore only a finalise terminal that has just started, which is this invocation.
    return Math.abs(nowMs - startedAtMs) > 60_000;
  });
  if (blockingActivities.length === 0) return;

  throw new Error([
    'Blocking Cursor activity detected before finalise:',
    ...blockingActivities.map((activity) => `- ${formatBlockingActivity(activity)}`),
    `Terminal directory checked: ${activityCheck.terminalDirectory}`,
    'Wait for the active Agent Review/finalise run to finish, then rerun finalise.',
  ].join('\n'));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const finaliseMode = getFinaliseModeKey(options);
  const run = new AutomationRun({
    scriptName: 'finalise',
    mode: getPushModeDescription(options),
    args: process.argv.slice(2),
    persist: !options.dryRun,
  });
  automationRun = run;
  let timingEntries: FinaliseTimingEntry[] = [];

  try {
    if (options.help) {
      printHelp();
      await run.finish('passed');
      return;
    }

    if (!options.dryRun) {
      await run.step('Check for blocking Cursor activity', () => assertNoBlockingCursorActivity());
    }

    const progress = createFinaliseProgressReporter({
      stream: process.stderr,
    });
    activeFinaliseProgress = progress;
    activeFinaliseProgressTTY = resolveInteractiveProgress().interactive;

    printProgress('Running read-only finalise prechecks...', 1);
    const prechecks = await run.step('Read-only finalise prechecks', () =>
      collectFinaliseReadOnlyPrechecks(progress)
    );
    const unmergedFiles = prechecks.unmergedFiles;
    if (unmergedFiles.length > 0) {
      throw new Error(`Resolve merge conflicts before finalising: ${unmergedFiles.join(', ')}`);
    }

    const protocolReadiness = prechecks.protocolReadiness;
    if (!options.dryRun) {
      notifyDisplayProgress(() => progress.stageStart('finalise-start'));
      await run.step('Validate protocol finalise gate', () => {
        assertFinaliseAllowedForProtocol(REPO_ROOT);
      });
      notifyDisplayProgress(() => progress.stageFinish('finalise-start', 'passed'));
    } else {
      await run.step('Inspect protocol finalise readiness', () => {
        console.log('\n==> Protocol readiness');
        console.log(formatFinaliseProtocolReadinessReport(protocolReadiness));
      });
    }

    const changedFileStats = prechecks.changedFileStats;
    const changedFiles = changedFileStats.map((entry) => entry.path);
    const migrationDiscoveryPaths = prechecks.migrationDiscoveryPaths;
    const pendingMigrationPaths = getFinaliseMigrationFilesFromPaths(
      REPO_ROOT,
      migrationDiscoveryPaths
    );
    const pendingMigrations = loadFinaliseMigrationFiles(REPO_ROOT, pendingMigrationPaths);
    const predeployMigrations = pendingMigrations.filter(
      (migration) => migration.phase === 'predeploy'
    );
    const deferredMigrationPaths = pendingMigrations
      .filter((migration) => migration.phase === 'postdeploy')
      .map((migration) => migration.relativePath);
    const predeployMigrationPaths = predeployMigrations.map(
      (migration) => migration.relativePath
    );
    const configuredConnectionString = process.env.POSTGRES_URL_NON_POOLING;
    const databaseTargetIdentity = getSafeDatabaseTargetIdentity(configuredConnectionString);
    const devServerProcesses = prechecks.devServerProcesses;
    const branch = prechecks.branch;
    const initialChangeSummary = summarizeFinaliseChanges(changedFileStats);
    const skippableTasks = getSkippableFinaliseTasks({
      repoRoot: REPO_ROOT,
      mode: finaliseMode,
      changedFiles,
      pendingMigrationFiles: predeployMigrationPaths,
      buildArtifactPath: NEXT_BUILD_ARTIFACT_PATH,
    });
    const recentDbValidateRun = predeployMigrationPaths.some((relativePath) =>
      migrationNeedsDbValidate(relativePath)
    )
      ? skippableTasks['db-validate']
      : undefined;
    const recentBuildRun = skippableTasks.build;
    const recentTestRun = options.full ? skippableTasks['test-run'] : undefined;
    const recentTestsuiteRun = options.full ? skippableTasks.testsuite : undefined;
    let migrationSummary: MigrationRunSummary = {
      applied: [],
      reused: [],
      deferred: deferredMigrationPaths,
    };

    if (options.dryRun) {
      console.log(`Mode: ${getPushModeDescription(options)}`);
      console.log(`Branch: ${branch || '(detached HEAD)'}`);
      console.log(
        `Database target: ${
          databaseTargetIdentity ?? 'not derivable without exposing connection details'
        }`
      );
      console.log(`Dev server: ${devServerProcesses.length > 0 ? `would stop ${devServerProcesses.length} process(es)` : 'none running'}`);
      console.log(
        `Migrations: ${
          predeployMigrationPaths.length > 0
            ? `would inspect ${predeployMigrationPaths.join(', ')}`
            : 'none pending'
        }`
      );
      console.log(`Migrations deferred (postdeploy): ${formatMigrationFiles(deferredMigrationPaths)}`);
      console.log(
        `Build: ${
          recentBuildRun
            ? `would reuse recent passed build: ${formatRecentTask(recentBuildRun)}`
            : 'would remove .next and run npm run build'
        }`
      );
      console.log(
        `Tests: ${
          options.full
            ? [
                `would start a local production server on ${DEV_SERVER_PORT} if needed`,
                recentTestRun ? `skip npm run test:run (${formatRecentTask(recentTestRun)})` : 'run npm run test:run',
                recentTestsuiteRun ? `skip npm run testsuite (${formatRecentTask(recentTestsuiteRun)})` : 'run npm run testsuite',
              ].join(', ')
            : 'skipped'
        }`
      );
      const wouldCommit = hasUncommittedChanges();
      console.log(
        `Commit: ${
          wouldCommit
            ? `would commit ${initialChangeSummary.fileCount} file(s) with "${initialChangeSummary.commitMessage}"`
            : 'no changes to commit'
        }`
      );
      console.log('Release version: would update locally before push if a bump is due');
      console.log(`Push: ${options.push ? 'would push current branch' : 'skipped'}`);
      await run.step(
        'Record commit outcome',
        () => undefined,
        buildFinaliseCommitOutcomeMetadata(false, null)
      );
      await run.step(
        'Record push outcome',
        () => undefined,
        buildFinalisePushOutcomeMetadata({
          pushRequested: options.push,
          pushedBranch: null,
        })
      );
      notifyDisplayProgress(() => progress.complete('passed'));
      await run.finish('passed');
      return;
    }

    console.log(`Starting finalise workflow (${getPushModeDescription(options)})`);
    printProgress('Workflow started.', 0);
    timingEntries = [];

    if (devServerProcesses.length > 0) {
      console.log(`\n==> Stop dev server (${devServerProcesses.length} process${devServerProcesses.length === 1 ? '' : 'es'})`);
      printProgress('Stopping repo dev server...', 5);
      await timeFinaliseStep(timingEntries, 'Stop repo dev server', () =>
        run.step('Stop repo dev server', () => stopRepoDevServer(), {
          processCount: devServerProcesses.length,
        })
      );
      printProgress('Repo dev server stopped.', 10);
    } else {
      console.log('\n==> Stop dev server');
      printProgress('No repo dev server detected.', 10);
    }

    if (deferredMigrationPaths.length > 0) {
      console.log(
        `\n==> Defer postdeploy migrations: ${deferredMigrationPaths.join(', ')}`
      );
    }

    if (predeployMigrations.length > 0) {
      console.log(`\n==> Run pending predeploy migrations (${predeployMigrations.length})`);
      printProgress(`Checking ${predeployMigrations.length} predeploy migration${predeployMigrations.length === 1 ? '' : 's'} against the protected ledger...`, 12);
      migrationSummary = await runDeterministicFinaliseStep({
        mode: finaliseMode,
        task: 'migrations',
        command: 'run-pending-migrations',
        action: () =>
          timeFinaliseStep(timingEntries, 'Run pending local migrations', () =>
            run.step(
              'Run pending local migrations',
              () => runPendingMigrations(predeployMigrations, deferredMigrationPaths),
              {
                migrationFiles: predeployMigrationPaths,
                deferredMigrationFiles: deferredMigrationPaths,
              }
            )
          ),
      });
      printProgress(
        `Migration ledger complete: ${migrationSummary.applied.length} applied, ${migrationSummary.reused.length} reused, ${migrationSummary.deferred.length} deferred.`,
        20
      );
    } else {
      console.log('\n==> Run pending local migrations');
      printProgress(
        deferredMigrationPaths.length > 0
          ? 'No predeploy migrations; postdeploy migrations remain deferred.'
          : 'No pending local migration files detected.',
        20
      );
    }

    const shouldRunDbValidate = getValidatedMigrationEvidencePaths(
      migrationSummary
    ).some((relativePath) => migrationNeedsDbValidate(relativePath));
    if (shouldRunDbValidate) {
      console.log('\n==> Validate database after schema-risk migration');
      if (recentDbValidateRun) {
        await run.step('Skip database validation after schema-risk migration', () => undefined, getRecentTaskMetadata(recentDbValidateRun));
        printProgress(`Reused recent database validation: ${formatRecentTask(recentDbValidateRun)}.`, 25);
      } else {
        printProgress('Running database validation...', 22);
        await runDeterministicFinaliseStep({
          mode: finaliseMode,
          task: 'db-validate',
          command: 'npm run db:validate',
          action: () =>
            timeFinaliseStep(timingEntries, 'Run database validation', () =>
              runCommand('npm', ['run', 'db:validate'])
            ),
        });
        printProgress('Database validation passed.', 25);
      }
    } else {
      console.log('\n==> Validate database after schema-risk migration');
      printProgress('No rename/drop migration detected.', 25);
    }

    console.log('\n==> Run clean production build');
    notifyDisplayProgress(() => progress.stageStart('production-build'));
    if (recentBuildRun) {
      await run.step('Reuse recent production build', () => undefined, getRecentTaskMetadata(recentBuildRun));
      printProgress(`Reused recent production build: ${formatRecentTask(recentBuildRun)}.`, 50);
      notifyDisplayProgress(() => progress.stageFinish('production-build', 'passed'));
    } else {
      console.log('\n==> Remove clean build output');
      printProgress('Removing previous clean build output...', 28);
      const removedBuildOutput = await run.step('Remove clean build output', () => removeNextBuildOutput());
      printProgress(removedBuildOutput ? 'Removed .next build output.' : 'No .next build output to remove.', 30);

      await runDeterministicFinaliseStep({
        mode: finaliseMode,
        task: 'build',
        command: 'npm run build',
        artifactPaths: [NEXT_BUILD_ARTIFACT_PATH],
        action: () =>
          timeFinaliseStep(timingEntries, 'Run clean production build', () =>
            run.step('Run clean production build', () => runCleanProductionBuildWithProgress())
          ),
      });
      notifyDisplayProgress(() => progress.stageFinish('production-build', 'passed'));
    }

    if (options.full) {
      console.log('\n==> Run full automated test suite');
      const localProductionBaseUrl = getLocalProductionBaseUrl();
      const localTestEnv = getLocalTestEnv();
      const shouldRunTestRun = !recentTestRun;
      const shouldRunTestsuite = !recentTestsuiteRun;

      if (!shouldRunTestRun && !shouldRunTestsuite) {
        await run.step('Reuse recent full automated test suite', () => undefined, {
          testRun: recentTestRun ? getRecentTaskMetadata(recentTestRun) : null,
          testsuite: recentTestsuiteRun ? getRecentTaskMetadata(recentTestsuiteRun) : null,
        });
        printProgress('Reused recent full automated test suite.', 84);
        notifyDisplayProgress(() => progress.stageFinish('application-tests', 'passed'));
      } else {
        notifyDisplayProgress(() => progress.stageStart('application-tests'));
        printProgress(`Starting local production server on ${localProductionBaseUrl}...`, 52);
        const testServer = startManagedProcess(
          'npm',
          ['run', 'start', '--', '--port', String(DEV_SERVER_PORT)],
          'Local production server',
          localTestEnv
        );

        try {
          printProgress('Waiting for local production server readiness...', 55);
          await run.step('Wait for local production server', () =>
            waitForServerReady(testServer, localProductionBaseUrl)
          );
          printProgress(`Local production server ready on port ${DEV_SERVER_PORT}.`, 58);
          if (recentTestRun) {
            await run.step('Reuse recent Vitest test run', () => undefined, getRecentTaskMetadata(recentTestRun));
            printProgress(`Reused recent Vitest test run: ${formatRecentTask(recentTestRun)}.`, 72);
          } else {
            printProgress('Running Vitest unit, integration, and component tests...', 60);
            await runDeterministicFinaliseStep({
              mode: finaliseMode,
              task: 'test-run',
              command: 'npm run test:run',
              action: () =>
                timeFinaliseStep(timingEntries, 'Run Vitest test run', () =>
                  runCommandAsyncWithHeartbeat('npm', ['run', 'test:run'], {
                    env: localTestEnv,
                    label: 'Vitest test run',
                    percent: 60,
                  })
                ),
            });
            printProgress('Vitest test run passed.', 72);
          }
          if (recentTestsuiteRun) {
            await run.step('Reuse recent API and Playwright testsuite', () => undefined, getRecentTaskMetadata(recentTestsuiteRun));
            printProgress(`Reused recent API and Playwright testsuite: ${formatRecentTask(recentTestsuiteRun)}.`, 84);
          } else {
            printProgress('Running API and Playwright testsuite...', 75);
            await runDeterministicFinaliseStep({
              mode: finaliseMode,
              task: 'testsuite',
              command: 'npm run testsuite',
              action: () =>
                timeFinaliseStep(timingEntries, 'Run API and Playwright testsuite', () =>
                  runCommandAsyncWithHeartbeat('npm', ['run', 'testsuite'], {
                    env: localTestEnv,
                    label: 'API and Playwright testsuite',
                    percent: 75,
                  })
                ),
            });
            printProgress('Full automated test suite passed.', 84);
          }
        } finally {
          printProgress('Stopping local production server...', 85);
          await timeFinaliseStep(timingEntries, 'Stop local production server', () =>
            run.step('Stop local production server', () => stopManagedProcess(testServer))
          );
          printProgress('Local production server stopped.', 86);
        }
        notifyDisplayProgress(() => progress.stageFinish('application-tests', 'passed'));
      }
    } else {
      console.log('\n==> Run full automated test suite');
      printProgress('Skipped for non-full finalise.', 84);
    }

    notifyDisplayProgress(() => progress.stageStart('release-finish'));
    console.log('\n==> Summarise workspace changes');
    printProgress('Summarising workspace changes...', 87);
    const changeSummary = summarizeFinaliseChanges(changedFileStats);
    if (changeSummary.fileCount > 0) {
      console.log(`Changed files: ${changeSummary.fileCount}`);
      console.log(`Areas: ${changeSummary.areas.join(', ')}`);
      console.log(`Commit message: ${changeSummary.commitMessage}`);
    } else {
      console.log('No workspace changes to summarise.');
    }

    console.log('\n==> Commit workspace changes');
    printProgress('Committing workspace changes if needed...', 90);
    const committed = await timeFinaliseStep(timingEntries, 'Commit workspace changes', () =>
      commitAllChanges(changeSummary.commitMessage)
    );
    if (committed) {
      const owned = recordFinaliseOwnedCommit(REPO_ROOT);
      if (!owned.ok) {
        throw new Error(owned.message);
      }
    }
    await run.step(
      'Record commit outcome',
      () => undefined,
      buildFinaliseCommitOutcomeMetadata(committed, changeSummary.commitMessage)
    );
    printProgress(
      committed ? `Created commit: ${changeSummary.commitMessage}` : 'No uncommitted changes, so no commit was created.',
      92
    );

    console.log('\n==> Bump release version locally');
    printProgress('Checking release version bump...', 93);
    const releaseBeforeSha = readReleaseVersionState().lastProcessedSha;
    const releaseAfterSha = getHeadSha();
    const releasePrimaryCommitMessage =
      getReleaseCommitPrimaryMessage(releaseBeforeSha, releaseAfterSha) ??
      (committed ? changeSummary.commitMessage : null);
    const releaseVersion = await timeFinaliseStep(timingEntries, 'Bump release version locally', () => {
      runCommand('npm', ['run', 'version:bump', '--', releaseBeforeSha, releaseAfterSha]);
      return commitReleaseVersionChanges(releasePrimaryCommitMessage);
    });
    if (releaseVersion) {
      const owned = recordFinaliseOwnedCommit(REPO_ROOT);
      if (!owned.ok) {
        throw new Error(owned.message);
      }
    }
    printProgress(
      releaseVersion
        ? `Created release version commit: ${formatReleaseVersionCommitMessage(releasePrimaryCommitMessage, releaseVersion).split(/\r?\n/u)[0]}`
        : 'No release version bump required.',
      95
    );

    let pushedBranch: string | null = null;
    if (options.push) {
      console.log('\n==> Push current branch');
      printProgress(`Pushing branch ${branch || '(detached HEAD)'}...`, 97);
      pushedBranch = await timeFinaliseStep(timingEntries, 'Push current branch', () => pushCurrentBranch());
      printProgress(`Pushed ${pushedBranch}.`, 99);
    } else {
      console.log('\n==> Push current branch');
      printProgress('Skipped for non-push finalise.', 99);
    }
    await run.step(
      'Record push outcome',
      () => undefined,
      buildFinalisePushOutcomeMetadata({
        pushRequested: options.push,
        pushedBranch,
      })
    );

    console.log('\nFinalise complete.');
    console.log(`- Branch: ${branch || '(detached HEAD)'}`);
    console.log(
      `- Database target: ${
        databaseTargetIdentity ?? 'not derivable without exposing connection details'
      }`
    );
    console.log(`- Migrations applied: ${formatMigrationFiles(migrationSummary.applied)}`);
    console.log(`- Migrations reused: ${formatMigrationFiles(migrationSummary.reused)}`);
    console.log(
      `- Migrations deferred (postdeploy): ${formatMigrationFiles(migrationSummary.deferred)}`
    );
    console.log(`- Build: ${recentBuildRun ? 'reused recent passed build' : 'passed'}`);
    console.log(
      `- Tests: ${
        options.full
          ? recentTestRun && recentTestsuiteRun
            ? 'reused recent passed runs'
            : 'passed'
          : 'skipped'
      }`
    );
    console.log(`- Commit: ${committed ? 'created' : 'skipped'}`);
    console.log(`- Release version: ${releaseVersion ? `bumped to ${releaseVersion}` : 'unchanged'}`);
    console.log(`- Push: ${pushedBranch ? `pushed ${pushedBranch}` : 'skipped'}`);
    console.log('\n==> Timing summary');
    getFinaliseTimingSummaryLines(timingEntries).forEach((line) => console.log(line));
    await recordFinaliseTimingSummary(run, timingEntries);
    recordFinaliseDurationAnomaly(finaliseMode, timingEntries);
    clearFinaliseFailureArtifact(REPO_ROOT);
    printProgress('Finalise workflow complete.', 100);
    notifyDisplayProgress(() => progress.stageFinish('release-finish', 'passed'));
    notifyDisplayProgress(() => progress.complete('passed'));
    await run.finish('passed');
  } catch (error) {
    if (timingEntries.length > 0) {
      try {
        console.log('\n==> Timing summary');
        getFinaliseTimingSummaryLines(timingEntries).forEach((line) => console.log(line));
        await recordFinaliseTimingSummary(run, timingEntries);
        recordFinaliseDurationAnomaly(finaliseMode, timingEntries);
      } catch {
        // Keep the original failure as the primary exit reason.
      }
    }
    notifyDisplayProgress(() => activeFinaliseProgress?.complete('failed'));
    await run.finish('failed', error);
    throw error;
  } finally {
    automationRun = null;
    activeFinaliseProgress = null;
    activeFinaliseProgressTTY = false;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFinalise failed: ${message}`);
  process.exit(1);
});
