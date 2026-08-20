import {
  existsSync,
  lstatSync,
  realpathSync,
  statSync,
} from 'fs';
import { createRequire } from 'module';
import path from 'path';
import pg from 'pg';
import {
  getSafeDatabaseProjectRef,
  getSafeDatabaseTargetIdentity,
  loadFinaliseMigrationFiles,
  requireSafeMigrationConnectionString,
  stripOuterMigrationTransaction,
  type FinaliseMigrationFile,
} from './finalise-migrations';
import {
  applyMigrationWithLedger,
  SanitizedMigrationError,
  type MigrationQueryClient,
} from './migration-executor';

export const MIGRATION_CHECKSUM_PREFIX_LENGTH = 12;

export class MigrationCliError extends Error {
  readonly outcome = 'rejected' as const;

  constructor(message: string) {
    super(message);
    this.name = 'MigrationCliError';
  }
}

export interface MigrationPathFs {
  existsSync(targetPath: string): boolean;
  statSync(targetPath: string): { isFile(): boolean; isDirectory(): boolean };
  lstatSync(targetPath: string): { isSymbolicLink(): boolean };
  realpathSync(targetPath: string): string;
}

export interface RunSqlMigrationDeps {
  repoRoot: string;
  argv: string[];
  loadEnvLocal: () => void;
  getEnv: (name: string) => string | undefined;
  createClient: (
    connectionString: string
  ) => Promise<MigrationQueryClient & { end?: () => Promise<void> }>;
  writeLine: (line: string) => void;
  writeError: (line: string) => void;
  fs?: MigrationPathFs;
}

export type ParsedMigrateCliArgs =
  | {
      ok: true;
      inputPath: string;
      apply: boolean;
      confirmTarget?: string;
    }
  | { ok: false; message: string };

const defaultFs: MigrationPathFs = {
  existsSync,
  statSync,
  lstatSync,
  realpathSync,
};

function failParse(message: string): ParsedMigrateCliArgs {
  return { ok: false, message };
}

export function parseMigrateCliArgs(argv: string[]): ParsedMigrateCliArgs {
  const positionals: string[] = [];
  let apply = false;
  let confirmTarget: string | undefined;
  let sawApply = false;
  let sawConfirmTarget = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === '--apply') {
      if (sawApply) return failParse('duplicate --apply flag');
      sawApply = true;
      apply = true;
      continue;
    }
    if (arg === '--confirm-target') {
      if (sawConfirmTarget) return failParse('duplicate --confirm-target flag');
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        return failParse('missing --confirm-target value');
      }
      sawConfirmTarget = true;
      confirmTarget = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      return failParse('unknown flag');
    }
    positionals.push(arg);
  }

  if (positionals.length === 0) {
    return failParse('missing migration path');
  }
  if (positionals.length > 1) {
    return failParse('multiple migration paths');
  }
  if (confirmTarget && !apply) {
    return failParse('--confirm-target requires --apply');
  }
  if (apply && !confirmTarget) {
    return failParse('--apply requires --confirm-target');
  }

  return {
    ok: true,
    inputPath: positionals[0]!.trim(),
    apply,
    confirmTarget,
  };
}

export function canonicalizeMigrationInputPath(inputPath: string): string {
  return inputPath.replace(/\\/g, '/');
}

function isDriveQualified(inputPath: string): boolean {
  return /^[A-Za-z]:/u.test(inputPath);
}

function isUncPath(inputPath: string): boolean {
  return /^(?:\\\\|\/\/)/u.test(inputPath);
}

function pathHasSymlinkComponent(absolutePath: string, fsOps: MigrationPathFs): boolean {
  const normalized = path.normalize(absolutePath);
  const { root } = path.parse(normalized);
  const relative = path.relative(root, normalized);
  if (!relative) return false;
  let current = root;
  for (const segment of relative.split(path.sep)) {
    if (!segment) continue;
    current = path.join(current, segment);
    try {
      if (fsOps.lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function isInsideDirectory(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function resolveExplicitMigrationPath(
  repoRoot: string,
  inputPath: string,
  fsOps: MigrationPathFs = defaultFs
): { canonicalPath: string; absolutePath: string } {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new MigrationCliError('missing migration path');
  }
  if (isUncPath(trimmed)) {
    throw new MigrationCliError('UNC migration paths are not allowed');
  }
  if (isDriveQualified(trimmed)) {
    throw new MigrationCliError('drive-qualified migration paths are not allowed');
  }
  if (path.isAbsolute(trimmed) || trimmed.startsWith('/')) {
    throw new MigrationCliError('absolute migration paths are not allowed');
  }

  const canonicalPath = canonicalizeMigrationInputPath(trimmed);
  if (canonicalPath !== trimmed.replace(/\\/g, '/')) {
    throw new MigrationCliError('migration path is not canonical');
  }
  const segments = canonicalPath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new MigrationCliError('migration path traversal is not allowed');
  }
  if (!canonicalPath.startsWith('supabase/migrations/')) {
    throw new MigrationCliError('migration must be inside supabase/migrations');
  }
  if (!canonicalPath.endsWith('.sql')) {
    throw new MigrationCliError('migration path must use a lowercase .sql extension');
  }
  if (segments.length < 3 || !segments[segments.length - 1]) {
    throw new MigrationCliError('migration path must be a file inside supabase/migrations');
  }

  if (!fsOps.existsSync(repoRoot)) {
    throw new MigrationCliError('repository root does not exist');
  }
  if (pathHasSymlinkComponent(path.resolve(repoRoot), fsOps)) {
    throw new MigrationCliError('repository root path escape is not allowed');
  }

  const repoReal = fsOps.realpathSync(path.resolve(repoRoot));
  const candidate = path.resolve(repoReal, canonicalPath.split('/').join(path.sep));
  if (!isInsideDirectory(repoReal, candidate)) {
    throw new MigrationCliError('migration path traversal is not allowed');
  }
  if (!fsOps.existsSync(candidate)) {
    throw new MigrationCliError('migration file does not exist');
  }

  let stats: { isFile(): boolean; isDirectory(): boolean };
  try {
    stats = fsOps.statSync(candidate);
  } catch {
    throw new MigrationCliError('migration file does not exist');
  }
  if (stats.isDirectory() || !stats.isFile()) {
    throw new MigrationCliError('migration path must be a regular file');
  }
  if (pathHasSymlinkComponent(candidate, fsOps)) {
    throw new MigrationCliError('migration path symlink escape is not allowed');
  }

  const migrationsDir = path.join(repoReal, 'supabase', 'migrations');
  if (!fsOps.existsSync(migrationsDir)) {
    throw new MigrationCliError('supabase/migrations directory does not exist');
  }
  const migrationsReal = fsOps.realpathSync(migrationsDir);
  const fileReal = fsOps.realpathSync(candidate);
  if (!isInsideDirectory(migrationsReal, fileReal) || !isInsideDirectory(repoReal, fileReal)) {
    throw new MigrationCliError('migration path symlink escape is not allowed');
  }

  const canonicalFromReal = path.relative(repoReal, fileReal).split(path.sep).join('/');
  if (canonicalFromReal !== canonicalPath) {
    throw new MigrationCliError('migration path case alias is not allowed');
  }

  return { canonicalPath, absolutePath: fileReal };
}

export function formatChecksumPrefix(checksumSha256: string): string {
  return checksumSha256.slice(0, MIGRATION_CHECKSUM_PREFIX_LENGTH);
}

export function isKnownSupabaseMigrationHostname(hostname: string): boolean {
  return /\.supabase\.(?:co|com)$/iu.test(hostname);
}

export function assertExactConfirmedSupabaseTarget(
  connectionString: string,
  confirmTarget: string | undefined
): { projectRef: string; targetIdentity: string } {
  let hostname: string;
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    throw new MigrationCliError('Migration connection is not configured for safe apply');
  }
  if (!isKnownSupabaseMigrationHostname(hostname)) {
    throw new MigrationCliError('Migration connection is not a known Supabase hostname');
  }

  const projectRef = getSafeDatabaseProjectRef(connectionString);
  if (!projectRef) {
    throw new MigrationCliError('Migration connection does not expose a known project ref');
  }
  const hostnameRef = hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/iu)?.[1];
  if (hostnameRef && hostnameRef !== projectRef) {
    throw new MigrationCliError('Migration connection project ref is inconsistent');
  }
  if (!confirmTarget || projectRef !== confirmTarget) {
    throw new MigrationCliError('Confirm-target does not match the configured project ref');
  }

  const targetIdentity = getSafeDatabaseTargetIdentity(connectionString);
  if (!targetIdentity) {
    throw new MigrationCliError('Migration connection does not expose a known project ref');
  }
  return { projectRef, targetIdentity };
}

function stripSqlForTransactionScan(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/--[^\n]*/gu, ' ')
    .replace(/'(?:''|[^'])*'/gu, ' ')
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/gu, ' ');
}

const REMAINING_TRANSACTION_CONTROL =
  /\b(?:PREPARE\s+TRANSACTION|START\s+TRANSACTION|(?:BEGIN|COMMIT|ROLLBACK|ABORT|END)(?:\s+(?:WORK|TRANSACTION))?)(?:\s+AND\s+(?:NO\s+)?CHAIN)?\s*(?:;|$)/iu;

export function assertGenericRunnerMigrationAllowed(migration: FinaliseMigrationFile): void {
  if (migration.phase !== 'predeploy') {
    throw new MigrationCliError(
      'Generic runner rejects postdeploy migrations; use a reviewed feature-specific runner'
    );
  }
  if (/private\.finalise_migration_ledger/iu.test(migration.sql)) {
    throw new MigrationCliError('Generic runner cannot target the finalise migration ledger');
  }

  let stripped: string;
  try {
    stripped = stripOuterMigrationTransaction(migration.sql);
  } catch {
    throw new MigrationCliError('Migration has remaining transaction-control statements');
  }

  if (REMAINING_TRANSACTION_CONTROL.test(stripSqlForTransactionScan(stripped))) {
    throw new MigrationCliError('Migration has remaining transaction-control statements');
  }

  if (
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/iu.test(migration.sql) ||
    /\bDROP\s+INDEX\s+CONCURRENTLY\b/iu.test(migration.sql) ||
    /\bREINDEX\s+CONCURRENTLY\b/iu.test(migration.sql) ||
    /\bVACUUM\b/iu.test(migration.sql) ||
    /\bALTER\s+SYSTEM\b/iu.test(migration.sql) ||
    /\bCREATE\s+DATABASE\b/iu.test(migration.sql) ||
    /\bDROP\s+DATABASE\b/iu.test(migration.sql)
  ) {
    throw new MigrationCliError(
      'Generic runner rejects non-transactional SQL; use a reviewed feature-specific runner'
    );
  }
}

export function formatMigrationCliResult(result: {
  outcome: 'validated' | 'applied' | 'reused' | 'rejected';
  canonicalPath?: string;
  phase?: string;
  checksumPrefix?: string;
  targetIdentity?: string | null;
  message?: string;
  category?: string;
}): string {
  const lines = [`outcome=${result.outcome}`];
  if (result.canonicalPath) lines.push(`path=${result.canonicalPath}`);
  if (result.phase) lines.push(`phase=${result.phase}`);
  if (result.checksumPrefix) lines.push(`checksum=${result.checksumPrefix}`);
  if (result.targetIdentity) lines.push(`target=${result.targetIdentity}`);
  if (result.category) lines.push(`category=${result.category}`);
  if (result.message) lines.push(`message=${result.message}`);
  return lines.join('\n');
}

function formatCliFailure(error: unknown): string {
  if (error instanceof SanitizedMigrationError) {
    return formatMigrationCliResult({
      outcome: 'rejected',
      category: error.category,
      message: error.message,
    });
  }
  if (error instanceof MigrationCliError) {
    return formatMigrationCliResult({
      outcome: 'rejected',
      message: error.message,
    });
  }
  return formatMigrationCliResult({
    outcome: 'rejected',
    message: 'Migration command failed',
  });
}

export async function defaultCreateMigrationClient(
  connectionString: string
): Promise<MigrationQueryClient & { end: () => Promise<void> }> {
  const url = new URL(connectionString);
  const client = new pg.Client({
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

export function defaultLoadEnvLocal(repoRoot: string): void {
  const require = createRequire(import.meta.url);
  const { config } = require('dotenv') as { config: (options: { path: string }) => void };
  config({ path: path.resolve(repoRoot, '.env.local') });
}

export async function runSqlMigrationMain(deps: RunSqlMigrationDeps): Promise<number> {
  const fsOps = deps.fs ?? defaultFs;
  try {
    const parsed = parseMigrateCliArgs(deps.argv);
    if (!parsed.ok) {
      throw new MigrationCliError(parsed.message);
    }

    const resolved = resolveExplicitMigrationPath(deps.repoRoot, parsed.inputPath, fsOps);
    const migration = loadFinaliseMigrationFiles(deps.repoRoot, [resolved.canonicalPath])[0];
    if (!migration) {
      throw new MigrationCliError('migration file could not be loaded');
    }
    assertGenericRunnerMigrationAllowed(migration);

    const checksumPrefix = formatChecksumPrefix(migration.checksumSha256);

    if (!parsed.apply) {
      deps.writeLine(
        formatMigrationCliResult({
          outcome: 'validated',
          canonicalPath: resolved.canonicalPath,
          phase: migration.phase,
          checksumPrefix,
        })
      );
      return 0;
    }

    deps.loadEnvLocal();
    let connectionString: string;
    try {
      connectionString = requireSafeMigrationConnectionString(
        deps.getEnv('POSTGRES_URL_NON_POOLING')
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/POSTGRES_URL_NON_POOLING is not set/iu.test(message)) {
        throw new MigrationCliError('POSTGRES_URL_NON_POOLING is not set in .env.local');
      }
      if (/6543|transaction mode/iu.test(message)) {
        throw new MigrationCliError(
          'Migration execution cannot use Supavisor transaction mode on port 6543'
        );
      }
      throw new MigrationCliError('Migration connection is not configured for safe apply');
    }

    const confirmed = assertExactConfirmedSupabaseTarget(
      connectionString,
      parsed.confirmTarget
    );

    const client = await deps.createClient(connectionString);
    try {
      const result = await applyMigrationWithLedger(client, migration);
      deps.writeLine(
        formatMigrationCliResult({
          outcome: result.action === 'reuse' ? 'reused' : 'applied',
          canonicalPath: resolved.canonicalPath,
          phase: migration.phase,
          checksumPrefix,
          targetIdentity: confirmed.targetIdentity,
        })
      );
      return 0;
    } finally {
      await client.end?.();
    }
  } catch (error) {
    deps.writeError(formatCliFailure(error));
    return 1;
  }
}

function isDirectCliInvocation(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const normalized = path.normalize(entry);
  return (
    normalized.endsWith(`${path.sep}run-sql-migration.ts`) ||
    normalized.endsWith(`${path.sep}run-sql-migration.js`)
  );
}

if (isDirectCliInvocation()) {
  void runSqlMigrationMain({
    repoRoot: process.cwd(),
    argv: process.argv.slice(2),
    loadEnvLocal: () => defaultLoadEnvLocal(process.cwd()),
    getEnv: (name) => process.env[name],
    createClient: defaultCreateMigrationClient,
    writeLine: (line) => {
      process.stdout.write(`${line}\n`);
    },
    writeError: (line) => {
      process.stderr.write(`${line}\n`);
    },
  }).then(
    (code) => {
      process.exit(code);
    },
    () => {
      process.exit(1);
    }
  );
}
