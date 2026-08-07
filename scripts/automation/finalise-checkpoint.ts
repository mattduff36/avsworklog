import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type { FinaliseTaskKey } from '../finalise-recent-tasks';
import {
  getWorkflowPaths,
  loadWorkflowReviewState,
  writeJsonAtomic,
} from './workflow-events';
import { getActiveFinaliseContext, readProtocolRecord } from './workflow-review-protocol';

export interface FinaliseCheckpointStep {
  task: FinaliseTaskKey;
  status: 'passed' | 'failed' | 'started' | 'incomplete';
  startedAt: string;
  endedAt?: string;
  inputFingerprint: string;
  artifactHashes: Record<string, string>;
  command: string;
  exitCode?: number | null;
}

export interface FinaliseCheckpointRecord {
  schemaVersion: '1';
  checkpointId: string;
  workstreamId: string;
  branchName: string;
  headCommit: string;
  createdAt: string;
  updatedAt: string;
  inputFingerprint: string;
  migrationFingerprint: string;
  /** Live schema fingerprint from read-only catalog query, or 'unavailable'. */
  liveSchemaFingerprint: string;
  environmentFingerprint: string;
  steps: Partial<Record<FinaliseTaskKey, FinaliseCheckpointStep>>;
}

function runGit(repoRoot: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return '';
  return (result.stdout ?? '').trim();
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function hashFile(filePath: string): string {
  if (!existsSync(filePath)) return 'missing';
  return hashText(readFileSync(filePath, 'utf8'));
}

function listDirtyFingerprint(repoRoot: string): string {
  const status = runGit(repoRoot, ['status', '--porcelain', '-uall']);
  const lines = status
    ? status
        .split(/\r?\n/u)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .sort()
    : [];
  const parts: string[] = [];
  for (const line of lines) {
    // Rename lines look like: `R  old -> new` (or with score). Hash both paths.
    const renameMatch = line.match(/^R\d*\s+(.+?)\s+->\s+(.+)$/u);
    const relativePaths = renameMatch
      ? [renameMatch[1]!.trim(), renameMatch[2]!.trim()]
      : [line.slice(3).trim()];
    for (const relative of relativePaths) {
      const absolute = path.join(repoRoot, relative);
      if (!existsSync(absolute) || !statSync(absolute).isFile()) {
        parts.push(`${relative}:absent`);
        continue;
      }
      parts.push(`${relative}:${hashFile(absolute)}`);
    }
  }
  return hashText(parts.join('\n'));
}

function collectSqlFiles(directory: string, prefix = ''): string[] {
  if (!existsSync(directory)) return [];
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSqlFiles(absolute, relative));
      continue;
    }
    if (entry.name.endsWith('.sql')) files.push(relative.replace(/\\/g, '/'));
  }
  return files.sort();
}

function migrationFingerprint(repoRoot: string): string {
  const migrationsDir = path.join(repoRoot, 'supabase');
  if (!existsSync(migrationsDir)) return hashText('no-migrations');
  const files = collectSqlFiles(migrationsDir);
  return hashText(
    files.map((name) => `${name}:${hashFile(path.join(migrationsDir, name))}`).join('\n')
  );
}

function environmentFingerprint(): string {
  return hashText(
    [
      `node:${process.version}`,
      `platform:${process.platform}`,
      `arch:${process.arch}`,
      // Safe keyed indicators only — never raw env secrets.
      `ci:${process.env.CI ? '1' : '0'}`,
      `vercel:${process.env.VERCEL ? '1' : '0'}`,
    ].join('|')
  );
}

function liveSchemaFingerprint(): string {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) return 'unavailable';
  try {
    // Lazy require keeps unit tests free of pg unless the env is present.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client } = require('pg') as typeof import('pg');
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    // Synchronous fingerprint via child process would be safer; use spawn of a tiny query.
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `
        const { Client } = require('pg');
        const client = new Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING, ssl: { rejectUnauthorized: false } });
        (async () => {
          await client.connect();
          await client.query('BEGIN TRANSACTION READ ONLY');
          await client.query('SET LOCAL statement_timeout = 5000');
          const res = await client.query("SELECT md5(string_agg(table_name || ':' || column_name, ',' ORDER BY table_name, column_name)) AS fp FROM information_schema.columns WHERE table_schema = 'public'");
          await client.query('ROLLBACK');
          await client.end();
          process.stdout.write(String(res.rows[0]?.fp || 'unknown'));
        })().catch(async (error) => {
          try { await client.end(); } catch {}
          process.stderr.write(String(error));
          process.exit(1);
        });
        `,
      ],
      {
        encoding: 'utf8',
        env: process.env,
        shell: false,
        timeout: 15_000,
      }
    );
    void client;
    if (result.status !== 0) return 'unavailable';
    const fp = (result.stdout || '').trim();
    return fp || 'unavailable';
  } catch {
    return 'unavailable';
  }
}

function inputFingerprint(repoRoot: string): string {
  return hashText(
    [
      `head:${runGit(repoRoot, ['rev-parse', 'HEAD'])}`,
      `dirty:${listDirtyFingerprint(repoRoot)}`,
      `lock:${hashFile(path.join(repoRoot, 'package-lock.json'))}`,
      `pkg:${hashFile(path.join(repoRoot, 'package.json'))}`,
      `tsconfig:${hashFile(path.join(repoRoot, 'tsconfig.json'))}`,
      `next:${hashFile(path.join(repoRoot, 'next.config.ts'))}`,
      `nextAlt:${hashFile(path.join(repoRoot, 'next.config.js'))}`,
      `migrations:${migrationFingerprint(repoRoot)}`,
      `env:${environmentFingerprint()}`,
    ].join('\n')
  );
}

export function getCheckpointDirectory(repoRoot: string, workstreamId: string): string {
  return path.join(
    repoRoot,
    'docs_private',
    'automation',
    'workstreams',
    workstreamId,
    'checkpoints'
  );
}

export function getCheckpointPath(
  repoRoot: string,
  workstreamId: string,
  checkpointId: string
): string {
  return path.join(getCheckpointDirectory(repoRoot, workstreamId), `${checkpointId}.json`);
}

export function readFinaliseCheckpoint(
  repoRoot: string,
  workstreamId: string,
  checkpointId: string
): FinaliseCheckpointRecord | null {
  const filePath = getCheckpointPath(repoRoot, workstreamId, checkpointId);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as FinaliseCheckpointRecord;
    return {
      ...parsed,
      liveSchemaFingerprint: parsed.liveSchemaFingerprint ?? 'unavailable',
    };
  } catch {
    return null;
  }
}

export function createOrLoadFinaliseCheckpoint(params: {
  repoRoot: string;
  workstreamId: string;
  checkpointId: string;
}): FinaliseCheckpointRecord {
  const existing = readFinaliseCheckpoint(
    params.repoRoot,
    params.workstreamId,
    params.checkpointId
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const record: FinaliseCheckpointRecord = {
    schemaVersion: '1',
    checkpointId: params.checkpointId,
    workstreamId: params.workstreamId,
    branchName: runGit(params.repoRoot, ['branch', '--show-current']) || 'unknown',
    headCommit: runGit(params.repoRoot, ['rev-parse', 'HEAD']) || 'unknown',
    createdAt: now,
    updatedAt: now,
    inputFingerprint: inputFingerprint(params.repoRoot),
    migrationFingerprint: migrationFingerprint(params.repoRoot),
    liveSchemaFingerprint: liveSchemaFingerprint(),
    environmentFingerprint: environmentFingerprint(),
    steps: {},
  };
  mkdirSync(getCheckpointDirectory(params.repoRoot, params.workstreamId), { recursive: true });
  writeJsonAtomic(
    getCheckpointPath(params.repoRoot, params.workstreamId, params.checkpointId),
    record
  );
  return record;
}

export function markFinaliseCheckpointStep(params: {
  repoRoot: string;
  workstreamId: string;
  checkpointId: string;
  task: FinaliseTaskKey;
  status: FinaliseCheckpointStep['status'];
  command: string;
  exitCode?: number | null;
  artifactPaths?: string[];
}): FinaliseCheckpointRecord {
  const current = createOrLoadFinaliseCheckpoint(params);
  const artifactHashes: Record<string, string> = {};
  for (const relative of params.artifactPaths ?? []) {
    const absolute = path.isAbsolute(relative)
      ? relative
      : path.join(params.repoRoot, relative);
    artifactHashes[relative.replace(/\\/g, '/')] = hashFile(absolute);
  }

  const now = new Date().toISOString();
  const previous = current.steps[params.task];
  const step: FinaliseCheckpointStep = {
    task: params.task,
    status: params.status,
    startedAt: previous?.startedAt ?? now,
    endedAt: params.status === 'started' ? undefined : now,
    inputFingerprint: inputFingerprint(params.repoRoot),
    artifactHashes,
    command: params.command,
    exitCode: params.exitCode,
  };

  const next: FinaliseCheckpointRecord = {
    ...current,
    updatedAt: now,
    inputFingerprint: inputFingerprint(params.repoRoot),
    migrationFingerprint: migrationFingerprint(params.repoRoot),
    liveSchemaFingerprint: liveSchemaFingerprint(),
    environmentFingerprint: environmentFingerprint(),
    headCommit: runGit(params.repoRoot, ['rev-parse', 'HEAD']) || current.headCommit,
    steps: {
      ...current.steps,
      [params.task]: step,
    },
  };
  writeJsonAtomic(
    getCheckpointPath(params.repoRoot, params.workstreamId, params.checkpointId),
    next
  );
  return next;
}

export function canResumeFinaliseCheckpointStep(params: {
  repoRoot: string;
  workstreamId: string;
  checkpointId: string;
  task: FinaliseTaskKey;
  requiredArtifactPaths?: string[];
}): { resumable: boolean; reason: string } {
  const record = readFinaliseCheckpoint(
    params.repoRoot,
    params.workstreamId,
    params.checkpointId
  );
  if (!record) return { resumable: false, reason: 'checkpoint-missing' };

  const currentInput = inputFingerprint(params.repoRoot);
  if (record.inputFingerprint !== currentInput) {
    return { resumable: false, reason: 'input-fingerprint-mismatch' };
  }
  if (record.migrationFingerprint !== migrationFingerprint(params.repoRoot)) {
    return { resumable: false, reason: 'migration-fingerprint-mismatch' };
  }
  if (params.task === 'migrations' || params.task === 'db-validate') {
    const liveFp = liveSchemaFingerprint();
    if (liveFp === 'unavailable' || record.liveSchemaFingerprint === 'unavailable') {
      return { resumable: false, reason: 'live-schema-fingerprint-unavailable' };
    }
    if (liveFp !== record.liveSchemaFingerprint) {
      return { resumable: false, reason: 'live-schema-fingerprint-mismatch' };
    }
  }
  if (record.environmentFingerprint !== environmentFingerprint()) {
    return { resumable: false, reason: 'environment-fingerprint-mismatch' };
  }

  const step = record.steps[params.task];
  if (!step) return { resumable: false, reason: 'step-missing' };
  if (step.status !== 'passed') return { resumable: false, reason: `step-status=${step.status}` };
  if (step.inputFingerprint !== currentInput) {
    return { resumable: false, reason: 'step-input-mismatch' };
  }

  for (const relative of params.requiredArtifactPaths ?? []) {
    const normalized = relative.replace(/\\/g, '/');
    const absolute = path.isAbsolute(relative)
      ? relative
      : path.join(params.repoRoot, relative);
    const expected = step.artifactHashes[normalized];
    if (!expected) return { resumable: false, reason: `artifact-untracked:${normalized}` };
    if (hashFile(absolute) !== expected) {
      return { resumable: false, reason: `artifact-mismatch:${normalized}` };
    }
  }

  return { resumable: true, reason: 'exact-match' };
}

export function resolveActiveProtocolFinaliseContext(repoRoot: string): {
  workstreamId: string;
  checkpointId: string;
} | null {
  const paths = getWorkflowPaths(repoRoot);
  const state = loadWorkflowReviewState(paths.statePath);
  const active = getActiveFinaliseContext(state);
  if (!active) return null;
  const protocol = readProtocolRecord(repoRoot, active.workstreamId);
  if (!protocol || protocol.activeCheckpointId !== active.checkpointId) {
    return null;
  }
  if (protocol.phase !== 'finalise_ready' && protocol.phase !== 'finalised') {
    return null;
  }
  return {
    workstreamId: active.workstreamId,
    checkpointId: active.checkpointId,
  };
}

export function getProtocolSkippableFinaliseTasks(params: {
  repoRoot: string;
  buildArtifactPath?: string;
}): Partial<Record<FinaliseTaskKey, { reason: string; checkpointId: string }>> {
  const active = resolveActiveProtocolFinaliseContext(params.repoRoot);
  if (!active) return {};

  const tasks: FinaliseTaskKey[] = ['migrations', 'db-validate', 'build', 'test-run', 'testsuite'];
  const skippable: Partial<Record<FinaliseTaskKey, { reason: string; checkpointId: string }>> = {};
  for (const task of tasks) {
    const requiredArtifactPaths =
      task === 'build' && params.buildArtifactPath ? [params.buildArtifactPath] : [];
    const result = canResumeFinaliseCheckpointStep({
      repoRoot: params.repoRoot,
      workstreamId: active.workstreamId,
      checkpointId: active.checkpointId,
      task,
      requiredArtifactPaths,
    });
    if (result.resumable) {
      skippable[task] = { reason: result.reason, checkpointId: active.checkpointId };
    }
  }
  return skippable;
}
