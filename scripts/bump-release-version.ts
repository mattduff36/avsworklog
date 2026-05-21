import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  RELEASE_LOG_PATH,
  buildWhatChangedSummary,
  computeNextVersionState,
  formatReleaseLogEntry,
  formatReleaseVersion,
  parseCommitsFromMessages,
  prependReleaseLogEntry,
  selectReleasePrimaryCommitMessage,
  shouldSkipVersionBumpCommit,
  type ReleaseVersionState,
} from '../lib/config/release-version-logic';

const REPO_ROOT = process.cwd();
const VERSION_JSON_PATH = path.join(REPO_ROOT, 'lib/config/release-version.json');
const RELEASE_LOG_FILE = path.join(REPO_ROOT, RELEASE_LOG_PATH);

function getExecutable(command: string): string {
  if (process.platform !== 'win32') {
    return command;
  }

  if (command === 'npm') return 'npm.cmd';
  if (command === 'npx') return 'npx.cmd';
  return command;
}

function shouldUseShell(command: string): boolean {
  if (process.platform !== 'win32') return false;
  return !['git', 'powershell.exe', 'pwsh.exe'].includes(command.toLowerCase());
}

function runGit(args: string[]): string {
  const result = spawnSync(getExecutable('git'), args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: shouldUseShell('git'),
  });

  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    throw new Error(stderr || `git ${args.join(' ')} failed`);
  }

  return typeof result.stdout === 'string' ? result.stdout.trim() : '';
}

function readVersionState(): ReleaseVersionState {
  const raw = readFileSync(VERSION_JSON_PATH, 'utf8');
  return JSON.parse(raw) as ReleaseVersionState;
}

function writeVersionState(state: ReleaseVersionState): void {
  writeFileSync(VERSION_JSON_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function getCommitMessages(revRange: string): string[] {
  if (!revRange) {
    return [];
  }

  const output = runGit(['log', '--format=%s', revRange]);
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !shouldSkipVersionBumpCommit(line));
}

function resolveAfterSha(explicitAfter: string | undefined): string {
  if (explicitAfter) {
    return explicitAfter;
  }

  return runGit(['rev-parse', 'HEAD']);
}

function buildRevRange(beforeSha: string | undefined, afterSha: string): string | null {
  if (beforeSha && beforeSha !== '0000000000000000000000000000000000000000') {
    return `${beforeSha}..${afterSha}`;
  }

  if (!beforeSha) {
    return null;
  }

  return null;
}

function ensureReleaseLogDirectory(): void {
  const directory = path.dirname(RELEASE_LOG_FILE);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
}

function readReleaseLog(): string {
  if (!existsSync(RELEASE_LOG_FILE)) {
    return '';
  }

  return readFileSync(RELEASE_LOG_FILE, 'utf8');
}

function writeReleaseLog(content: string): void {
  ensureReleaseLogDirectory();
  writeFileSync(RELEASE_LOG_FILE, content, 'utf8');
}

function main(): void {
  const beforeSha = process.argv[2];
  const afterSha = resolveAfterSha(process.argv[3]);
  const afterResolved = afterSha;
  const revRange = buildRevRange(beforeSha, afterResolved);

  const commitMessages = revRange ? getCommitMessages(revRange) : [];
  const commits = parseCommitsFromMessages(commitMessages);
  const current = readVersionState();
  const { next, bumpKind } = computeNextVersionState(current, commits, new Date());

  if (bumpKind === 'none') {
    console.log(`No release version bump required (still ${formatReleaseVersion(current)}).`);
    return;
  }

  const nextState: ReleaseVersionState = {
    ...next,
    lastProcessedSha: afterResolved,
  };

  const versionLabel = formatReleaseVersion(nextState);
  const primaryCommitMessage = selectReleasePrimaryCommitMessage(commits, bumpKind, nextState);

  if (!primaryCommitMessage) {
    throw new Error('Version bump required but no eligible commit message was found.');
  }

  const logEntry = formatReleaseLogEntry({
    version: versionLabel,
    primaryCommitMessage,
    whatChanged: buildWhatChangedSummary(commits),
    commitMessages: commits.map((commit) => commit.raw),
  });

  writeVersionState(nextState);
  writeReleaseLog(prependReleaseLogEntry(readReleaseLog(), logEntry));

  console.log(`Release version bumped: ${formatReleaseVersion(current)} -> ${versionLabel} (${bumpKind})`);
}

main();
