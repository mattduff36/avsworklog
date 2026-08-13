import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

export type FinaliseMigrationPhase = 'predeploy' | 'postdeploy';

export interface FinaliseMigrationFile {
  relativePath: string;
  checksumSha256: string;
  phase: FinaliseMigrationPhase;
  sql: string;
}

export interface FinaliseMigrationLedgerRow {
  filename: string;
  checksum_sha256: string;
  phase: FinaliseMigrationPhase;
  applied_at: string | Date;
}

export type FinaliseMigrationLedgerDecision = 'apply' | 'reuse';

export function getValidatedMigrationEvidencePaths(summary: {
  applied: string[];
  reused: string[];
}): string[] {
  return Array.from(new Set([...summary.applied, ...summary.reused]));
}

export interface GitCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type RunGitCommand = (args: string[]) => GitCommandResult;

const LEDGER_NAME = 'private.finalise_migration_ledger';

export const FINALISE_MIGRATION_LEDGER_SQL = `
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS ${LEDGER_NAME} (
  filename TEXT PRIMARY KEY,
  checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  phase TEXT NOT NULL CHECK (phase IN ('predeploy', 'postdeploy')),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

REVOKE ALL ON TABLE ${LEDGER_NAME} FROM PUBLIC;
`;

function defaultRunGit(repoRoot: string): RunGitCommand {
  return (args) => {
    const result = spawnSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return {
      status: result.status,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    };
  };
}

function requireGitSuccess(result: GitCommandResult, operation: string): string {
  if (result.status !== 0) {
    const details = result.stderr.trim();
    throw new Error(`Unable to ${operation}${details ? `: ${details}` : ''}`);
  }
  return result.stdout;
}

function parseNullDelimitedPaths(output: string): string[] {
  return output
    .split('\0')
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.replace(/\\/g, '/'));
}

function getRemoteBaseRef(runGit: RunGitCommand): string | null {
  const upstreamResult = runGit([
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{u}',
  ]);
  if (upstreamResult.status === 0 && upstreamResult.stdout.trim()) {
    return upstreamResult.stdout.trim();
  }

  const originHead = runGit([
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD',
  ]);
  if (originHead.status === 0 && originHead.stdout.trim()) {
    return originHead.stdout.trim();
  }

  for (const candidate of ['origin/main', 'origin/master']) {
    const result = runGit(['rev-parse', '--verify', '--quiet', candidate]);
    if (result.status === 0) {
      return candidate;
    }
  }
  return null;
}

export function getFinaliseMigrationDiscoveryPaths(
  repoRoot: string,
  runGit: RunGitCommand = defaultRunGit(repoRoot)
): string[] {
  const discovered = new Set<string>();
  const remoteBaseRef = getRemoteBaseRef(runGit);

  if (remoteBaseRef) {
    const mergeBase = requireGitSuccess(
      runGit(['merge-base', 'HEAD', remoteBaseRef]),
      `resolve the merge base with ${remoteBaseRef}`
    ).trim();
    const committedDelta = requireGitSuccess(
      runGit(['diff', '--name-only', '--diff-filter=ACMR', '-z', `${mergeBase}..HEAD`, '--']),
      'inspect committed branch changes'
    );
    parseNullDelimitedPaths(committedDelta).forEach((filePath) => discovered.add(filePath));
  }

  const workspaceDelta = requireGitSuccess(
    runGit(['diff', '--name-only', '--diff-filter=ACMR', '-z', 'HEAD', '--']),
    'inspect staged and unstaged changes'
  );
  parseNullDelimitedPaths(workspaceDelta).forEach((filePath) => discovered.add(filePath));

  const untracked = requireGitSuccess(
    runGit(['ls-files', '--others', '--exclude-standard', '-z']),
    'inspect untracked files'
  );
  parseNullDelimitedPaths(untracked).forEach((filePath) => discovered.add(filePath));

  return Array.from(discovered).sort((left, right) => left.localeCompare(right));
}

function collectMigrationFilesFromScript(repoRoot: string, relativePath: string): string[] {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return [];
  }

  const content = readFileSync(absolutePath, 'utf8');
  const matches = content.match(/supabase\/[A-Za-z0-9_./-]+\.sql/gu) ?? [];

  return matches
    .map((migrationPath) => migrationPath.replace(/\\/g, '/'))
    .filter((migrationPath) => existsSync(path.join(repoRoot, migrationPath)));
}

function isLikelyMigrationScript(relativePath: string): boolean {
  if (
    relativePath.startsWith('scripts/migrations/')
    || relativePath === 'scripts/finalise-migrations.ts'
  ) {
    return false;
  }
  return (
    /^scripts\/.+migration.+\.ts$/u.test(relativePath) ||
    /^scripts\/.+migrations.+\.ts$/u.test(relativePath)
  );
}

function isDirectMigrationSql(relativePath: string): boolean {
  if (relativePath === 'supabase/schema.sql') {
    return false;
  }
  return (
    /^supabase\/migrations\/.+\.sql$/u.test(relativePath) ||
    /^supabase\/[^/]+\.sql$/u.test(relativePath)
  );
}

export function getFinaliseMigrationFilesFromPaths(
  repoRoot: string,
  changedPaths: string[]
): string[] {
  const migrationFiles = new Set<string>();

  for (const relativePath of changedPaths.map((entry) => entry.replace(/\\/g, '/'))) {
    if (isDirectMigrationSql(relativePath) && existsSync(path.join(repoRoot, relativePath))) {
      migrationFiles.add(relativePath);
      continue;
    }
    if (isLikelyMigrationScript(relativePath)) {
      collectMigrationFilesFromScript(repoRoot, relativePath).forEach((migrationPath) =>
        migrationFiles.add(migrationPath)
      );
    }
  }

  return Array.from(migrationFiles).sort((left, right) => left.localeCompare(right));
}

export function parseFinaliseMigrationPhase(sql: string): FinaliseMigrationPhase {
  const lines = sql.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  let phase: FinaliseMigrationPhase | null = null;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (!trimmed) continue;
    if (trimmed.startsWith('/*')) {
      inBlockComment = !trimmed.includes('*/');
      continue;
    }
    if (!trimmed.startsWith('--')) break;

    const metadata = trimmed.match(/^--\s*finalise-phase\s*:\s*(\S+)\s*$/iu);
    if (!metadata) continue;
    const value = metadata[1]?.toLowerCase();
    if (value !== 'predeploy' && value !== 'postdeploy') {
      throw new Error(`Invalid finalise-phase "${metadata[1]}"`);
    }
    if (phase && phase !== value) {
      throw new Error('Conflicting finalise-phase metadata');
    }
    phase = value;
  }

  return phase ?? 'predeploy';
}

export function loadFinaliseMigrationFiles(
  repoRoot: string,
  relativePaths: string[]
): FinaliseMigrationFile[] {
  return relativePaths.map((relativePath) => {
    const sql = readFileSync(path.join(repoRoot, relativePath), 'utf8');
    return {
      relativePath,
      checksumSha256: createHash('sha256').update(sql, 'utf8').digest('hex'),
      phase: parseFinaliseMigrationPhase(sql),
      sql,
    };
  });
}

export function decideFinaliseMigrationLedgerAction(
  migration: FinaliseMigrationFile,
  ledgerRow: FinaliseMigrationLedgerRow | null
): FinaliseMigrationLedgerDecision {
  if (!ledgerRow) {
    return 'apply';
  }
  if (ledgerRow.checksum_sha256 !== migration.checksumSha256) {
    throw new Error(
      `Migration checksum drift detected for ${migration.relativePath}; the applied ledger checksum does not match the file`
    );
  }
  if (ledgerRow.phase !== migration.phase) {
    throw new Error(
      `Migration phase drift detected for ${migration.relativePath}; ledger=${ledgerRow.phase}, file=${migration.phase}`
    );
  }
  return 'reuse';
}

export function stripOuterMigrationTransaction(sql: string): string {
  const leadingTransaction =
    /^(\uFEFF?(?:(?:\s+)|(?:--[^\r\n]*(?:\r?\n|$))|(?:\/\*[\s\S]*?\*\/))*)BEGIN\s*;/iu;
  const trailingTransaction =
    /COMMIT\s*;((?:(?:\s+)|(?:--[^\r\n]*(?:\r?\n|$))|(?:\/\*[\s\S]*?\*\/))*)$/iu;
  const hasLeadingTransaction = leadingTransaction.test(sql);
  const hasTrailingTransaction = trailingTransaction.test(sql);

  if (hasLeadingTransaction !== hasTrailingTransaction) {
    throw new Error('Migration has an unmatched outer BEGIN/COMMIT transaction');
  }
  if (!hasLeadingTransaction) {
    return sql;
  }

  return sql.replace(leadingTransaction, '$1').replace(trailingTransaction, '$1');
}

export function getSafeDatabaseTargetIdentity(connectionString: string | null | undefined): string | null {
  if (!connectionString) return null;
  try {
    const url = new URL(connectionString);
    const username = decodeURIComponent(url.username);
    const usernameProjectRef = username.match(/^postgres\.([a-z0-9]+)$/iu)?.[1];
    const hostnameProjectRef = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/iu)?.[1];
    const projectRef = usernameProjectRef ?? hostnameProjectRef;
    return projectRef ? `Supabase project ${projectRef}` : null;
  } catch {
    return null;
  }
}

export function requireSafeMigrationConnectionString(
  connectionString: string | null | undefined
): string {
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING is not set in .env.local');
  }
  const configuredUrl = new URL(connectionString);
  const configuredPort = Number.parseInt(configuredUrl.port, 10) || 5432;
  if (configuredPort === 6543) {
    throw new Error(
      'Migration execution cannot use Supavisor transaction mode on port 6543. Use direct or session mode on port 5432.'
    );
  }
  return connectionString;
}
