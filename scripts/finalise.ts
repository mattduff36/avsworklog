import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { config } from 'dotenv';
import { existsSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import pg from 'pg';
import { parseCommitsFromMessages, selectPrimaryCommitMessage } from '../lib/config/release-version-logic';
import { AutomationRun } from './automation/logger';
import { checkFinaliseBlockingActivity, formatBlockingActivity } from './finalise-activity-guard';
import { formatReleaseVersionCommitMessage, summarizeFinaliseChanges } from './finalise-summary';

config({ path: path.resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const REPO_ROOT = process.cwd();
const NEXT_BUILD_DIR = path.join(REPO_ROOT, '.next');
const RELEASE_VERSION_JSON_PATH = path.join(REPO_ROOT, 'lib/config/release-version.json');
const RELEASE_VERSION_FILES = ['lib/config/release-version.json', 'docs_private/release-log.md'] as const;
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
    env: process.env,
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

function getChangedFiles(): string[] {
  const tracked = runCommand('git', ['diff', '--name-only', 'HEAD', '--'], {
    captureOutput: true,
  });
  const untracked = runCommand('git', ['ls-files', '--others', '--exclude-standard'], {
    captureOutput: true,
  });

  return Array.from(new Set([...getTrimmedLines(tracked.stdout), ...getTrimmedLines(untracked.stdout)]));
}

function getGitStatusPorcelain(): string {
  return runCommand('git', ['status', '--porcelain'], {
    captureOutput: true,
  }).stdout.trim();
}

function getUnmergedFiles(): string[] {
  return getTrimmedLines(
    runCommand('git', ['diff', '--name-only', '--diff-filter=U'], {
      captureOutput: true,
      allowFailure: true,
    }).stdout
  );
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

function collectMigrationFilesFromScript(filePath: string): string[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, 'utf8');
  const matches = content.match(/supabase\/[A-Za-z0-9_./-]+\.sql/gu) ?? [];

  return matches
    .map((relativePath) => relativePath.replace(/\\/g, '/'))
    .filter((relativePath) => existsSync(path.join(REPO_ROOT, relativePath)));
}

function isLikelyMigrationScript(relativePath: string): boolean {
  return (
    /^scripts\/migrations\/.+\.ts$/u.test(relativePath) ||
    /^scripts\/.+migration.+\.ts$/u.test(relativePath) ||
    /^scripts\/.+migrations.+\.ts$/u.test(relativePath)
  );
}

function isDirectMigrationSql(relativePath: string): boolean {
  if (relativePath === 'supabase/schema.sql') {
    return false;
  }

  return /^supabase\/migrations\/.+\.sql$/u.test(relativePath) || /^supabase\/[^/]+\.sql$/u.test(relativePath);
}

function getPendingMigrationFiles(changedFiles: string[]): string[] {
  const pending = new Set<string>();

  for (const relativePath of changedFiles) {
    if (isDirectMigrationSql(relativePath) && existsSync(path.join(REPO_ROOT, relativePath))) {
      pending.add(relativePath);
      continue;
    }

    if (isLikelyMigrationScript(relativePath)) {
      const absolutePath = path.join(REPO_ROOT, relativePath);
      for (const migrationFile of collectMigrationFilesFromScript(absolutePath)) {
        pending.add(migrationFile);
      }
    }
  }

  return Array.from(pending).sort((left, right) => left.localeCompare(right));
}

function migrationNeedsDbValidate(relativePath: string): boolean {
  const content = readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

  return (
    /\balter\s+table\b[\s\S]{0,200}\brename\b/iu.test(content) ||
    /\bdrop\s+column\b/iu.test(content) ||
    /\bdrop\s+table\b/iu.test(content)
  );
}

function getDbConnectionString(): string {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL is not set in .env.local');
  }

  return connectionString;
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

async function runPendingMigrations(migrationFiles: string[]): Promise<void> {
  const client = await createDbClient();

  try {
    for (const relativePath of migrationFiles) {
      const sql = readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
      console.log(`\n==> Apply migration ${relativePath}`);
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
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

function startManagedProcess(command: string, args: string[], label: string): ManagedProcess {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env: process.env,
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
  const activityCheck = checkFinaliseBlockingActivity(REPO_ROOT);
  if (activityCheck.blockingActivities.length === 0) return;

  throw new Error([
    'Blocking Cursor activity detected before finalise:',
    ...activityCheck.blockingActivities.map((activity) => `- ${formatBlockingActivity(activity)}`),
    `Terminal directory checked: ${activityCheck.terminalDirectory}`,
    'Wait for the active Agent Review/finalise run to finish, then rerun finalise.',
  ].join('\n'));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const run = new AutomationRun({
    scriptName: 'finalise',
    mode: getPushModeDescription(options),
    args: process.argv.slice(2),
  });
  automationRun = run;

  try {
    if (options.help) {
      printHelp();
      run.finish('passed');
      return;
    }

    await run.step('Check for blocking Cursor activity', () => assertNoBlockingCursorActivity());

    const unmergedFiles = getUnmergedFiles();
    if (unmergedFiles.length > 0) {
      throw new Error(`Resolve merge conflicts before finalising: ${unmergedFiles.join(', ')}`);
    }

    const changedFiles = getChangedFiles();
    const pendingMigrationFiles = getPendingMigrationFiles(changedFiles);
    const shouldRunDbValidate = pendingMigrationFiles.some((relativePath) => migrationNeedsDbValidate(relativePath));
    const devServerProcesses = getRepoDevServerProcesses();
    const branch = getCurrentBranch();
    const initialChangeSummary = summarizeFinaliseChanges(changedFiles);

    if (options.dryRun) {
      console.log(`Mode: ${getPushModeDescription(options)}`);
      console.log(`Branch: ${branch || '(detached HEAD)'}`);
      console.log(`Dev server: ${devServerProcesses.length > 0 ? `would stop ${devServerProcesses.length} process(es)` : 'none running'}`);
      console.log(
        `Migrations: ${
          pendingMigrationFiles.length > 0
            ? `would run ${pendingMigrationFiles.join(', ')}`
            : 'none pending'
        }`
      );
      console.log(`DB validate: ${shouldRunDbValidate ? 'would run' : 'not needed'}`);
      console.log('Build: would remove .next and run npm run build');
      console.log(
        `Tests: ${
          options.full
            ? `would run npm run test:run, start a local production server on ${DEV_SERVER_PORT}, then run npm run testsuite`
            : 'skipped'
        }`
      );
      console.log(
        `Commit: ${
          hasUncommittedChanges()
            ? `would commit ${initialChangeSummary.fileCount} file(s) with "${initialChangeSummary.commitMessage}"`
            : 'no changes to commit'
        }`
      );
      console.log('Release version: would update locally before push if a bump is due');
      console.log(`Push: ${options.push ? 'would push current branch' : 'skipped'}`);
      run.finish('passed');
      return;
    }

    console.log(`Starting finalise workflow (${getPushModeDescription(options)})`);

    if (devServerProcesses.length > 0) {
      console.log(`\n==> Stop dev server (${devServerProcesses.length} process${devServerProcesses.length === 1 ? '' : 'es'})`);
      await run.step('Stop repo dev server', () => stopRepoDevServer(), {
        processCount: devServerProcesses.length,
      });
    } else {
      console.log('\n==> Stop dev server');
      console.log('No repo dev server detected.');
    }

    if (pendingMigrationFiles.length > 0) {
      console.log(`\n==> Run pending local migrations (${pendingMigrationFiles.length})`);
      await run.step('Run pending local migrations', () => runPendingMigrations(pendingMigrationFiles), {
        migrationFiles: pendingMigrationFiles,
      });
    } else {
      console.log('\n==> Run pending local migrations');
      console.log('No pending local migration files detected.');
    }

    if (shouldRunDbValidate) {
      console.log('\n==> Validate database after schema-risk migration');
      runCommand('npm', ['run', 'db:validate']);
    } else {
      console.log('\n==> Validate database after schema-risk migration');
      console.log('No rename/drop migration detected.');
    }

    console.log('\n==> Remove clean build output');
    const removedBuildOutput = await run.step('Remove clean build output', () => removeNextBuildOutput());
    console.log(removedBuildOutput ? 'Removed .next build output.' : 'No .next build output to remove.');

    console.log('\n==> Run clean production build');
    runCommand('npm', ['run', 'build']);

    if (options.full) {
      console.log('\n==> Run full automated test suite');
      runCommand('npm', ['run', 'test:run']);
      console.log(`Starting local production server on port ${DEV_SERVER_PORT} for testsuite...`);
      const testServer = startManagedProcess(
        'npm',
        ['run', 'start', '--', '--port', String(DEV_SERVER_PORT)],
        'Local production server'
      );

      try {
        await run.step('Wait for local production server', () =>
          waitForServerReady(testServer, `http://127.0.0.1:${DEV_SERVER_PORT}`)
        );
        runCommand('npm', ['run', 'testsuite']);
      } finally {
        await run.step('Stop local production server', () => stopManagedProcess(testServer));
      }
    } else {
      console.log('\n==> Run full automated test suite');
      console.log('Skipped for non-full finalise.');
    }

    console.log('\n==> Summarise workspace changes');
    const changeSummary = summarizeFinaliseChanges(getChangedFiles());
    if (changeSummary.fileCount > 0) {
      console.log(`Changed files: ${changeSummary.fileCount}`);
      console.log(`Areas: ${changeSummary.areas.join(', ')}`);
      console.log(`Commit message: ${changeSummary.commitMessage}`);
    } else {
      console.log('No workspace changes to summarise.');
    }

    console.log('\n==> Commit workspace changes');
    const committed = commitAllChanges(changeSummary.commitMessage);
    console.log(
      committed ? `Created commit: ${changeSummary.commitMessage}` : 'No uncommitted changes, so no commit was created.'
    );

    console.log('\n==> Bump release version locally');
    const releaseBeforeSha = readReleaseVersionState().lastProcessedSha;
    const releaseAfterSha = getHeadSha();
    const releasePrimaryCommitMessage =
      getReleaseCommitPrimaryMessage(releaseBeforeSha, releaseAfterSha) ??
      (committed ? changeSummary.commitMessage : null);
    runCommand('npm', ['run', 'version:bump', '--', releaseBeforeSha, releaseAfterSha]);
    const releaseVersion = commitReleaseVersionChanges(releasePrimaryCommitMessage);
    console.log(
      releaseVersion
        ? `Created release version commit: ${formatReleaseVersionCommitMessage(releasePrimaryCommitMessage, releaseVersion).split(/\r?\n/u)[0]}`
        : 'No release version bump required.'
    );

    let pushedBranch: string | null = null;
    if (options.push) {
      console.log('\n==> Push current branch');
      pushedBranch = pushCurrentBranch();
    } else {
      console.log('\n==> Push current branch');
      console.log('Skipped for non-push finalise.');
    }

    console.log('\nFinalise complete.');
    console.log(`- Branch: ${branch || '(detached HEAD)'}`);
    console.log(`- Migrations run: ${pendingMigrationFiles.length}`);
    console.log(`- Build: passed`);
    console.log(`- Tests: ${options.full ? 'passed' : 'skipped'}`);
    console.log(`- Commit: ${committed ? 'created' : 'skipped'}`);
    console.log(`- Release version: ${releaseVersion ? `bumped to ${releaseVersion}` : 'unchanged'}`);
    console.log(`- Push: ${pushedBranch ? `pushed ${pushedBranch}` : 'skipped'}`);
    run.finish('passed');
  } catch (error) {
    run.finish('failed', error);
    throw error;
  } finally {
    automationRun = null;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFinalise failed: ${message}`);
  process.exit(1);
});
