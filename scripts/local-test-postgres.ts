#!/usr/bin/env tsx
/**
 * Checkout-scoped disposable PostgreSQL lifecycle CLI.
 *
 * Signal handling:
 * - SIGINT and SIGTERM share a single-entry handler. A second signal is ignored
 *   while that handler runs.
 * - The handler terminates the active child when possible, then awaits bounded
 *   cleanup (`docker compose down --volumes --remove-orphans` for this
 *   checkout-scoped project only) and exits 130 (SIGINT) or 143 (SIGTERM).
 * - SIGKILL, process crash, host shutdown, and Docker daemon failure cannot run
 *   these handlers. The next `start` performs verified recovery teardown of the
 *   derived project before creating a new instance.
 *
 * Safety:
 * - Never reads `.env.local`, `POSTGRES_URL*`, or inherited `TEST_DATABASE_URL`
 *   when constructing or validating the database URL.
 * - Never logs URLs, passwords, or environment contents.
 * - Docker and child processes always use argv arrays with `shell: false`.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

export const COMPOSE_FILE_NAME = 'docker-compose.test-db.yml';
export const COMPOSE_SERVICE_NAME = 'postgres';
export const PORT_ENV_NAME = 'AVSWORKLOG_TEST_POSTGRES_PORT';
export const DB_USER = 'avsworklog_test';
export const DB_PASSWORD = 'avsworklog_test_only';
export const DB_NAME = 'avsworklog_test';
export const DB_HOST = '127.0.0.1';
export const URL_PROTOCOL = 'postgresql:';
export const PROJECT_NAME_PREFIX = 'avsworklog-ltdb-';
export const PROJECT_NAME_HASH_LENGTH = 12;
export const STATE_VERSION = 1;
export const DATABASE_COMMENT_PREFIX = 'avsworklog-ltdb';
export const TARGET_TEST_FILE = 'tests/db/daily-allocation-v2-runtime.test.ts';
export const HOST_PORT_MIN = 20_000;
export const HOST_PORT_COUNT = 10_000;
export const COMPOSE_UP_WAIT_TIMEOUT_SECONDS = 90;
export const COMPOSE_DOWN_TIMEOUT_MS = 60_000;
export const PG_CONNECT_TIMEOUT_MS = 10_000;
export const CHILD_TERMINATE_GRACE_MS = 5_000;
export const SENTINEL_EXIT_CODE = 23;
export const NONCE_BYTES = 32;
export const LOCK_DIR_NAME = 'lock';
export const STATE_FILE_NAME = 'state.json';
export const PID_FILE_NAME = 'pid';
export const TEMP_SCOPE_DIR_NAME = 'avsworklog-ltdb';
export const EXPECTED_POSTGRES_MAJOR = 15;
export const CLEANUP_FAILURE_EXIT_CODE = 1;
export const DOCKER_OVERRIDE_ENV_KEYS = ['DOCKER_HOST', 'DOCKER_CONTEXT'] as const;

export const STABLE_IDS = {
  BOOT: 'LTDB-BOOT-001',
  SAFE: 'LTDB-SAFE-001',
  CLEAN_SUCCESS: 'LTDB-CLEAN-001',
  CLEAN_FAILURE: 'LTDB-CLEAN-002',
} as const;

export const CLI_COMMANDS = [
  'start',
  'run',
  'stop',
  'one-shot',
  'verify-failure-cleanup',
] as const;

export type CliCommand = (typeof CLI_COMMANDS)[number];

export const PROVENANCE_ENV_KEYS = {
  marker: 'AVSWORKLOG_LTDB_MARKER',
  project: 'AVSWORKLOG_LTDB_PROJECT',
  port: 'AVSWORKLOG_LTDB_PORT',
  nonce: 'AVSWORKLOG_LTDB_NONCE',
} as const;

export const ALL_PROVENANCE_ENV_KEYS = Object.values(PROVENANCE_ENV_KEYS);

export const INHERITED_DATABASE_URL_KEYS = [
  'TEST_DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_URL',
  'DIRECT_URL',
  'SUPABASE_DB_URL',
] as const;

export const ALLOWED_FRESH_SCHEMAS = [
  'pg_catalog',
  'information_schema',
  'pg_toast',
  'public',
] as const;

export const ALLOWED_FRESH_EXTENSIONS = ['plpgsql'] as const;

export const ALLOWED_STATE_KEYS = [
  'version',
  'projectId',
  'nonce',
  'pid',
  'startedAt',
  'consumedAt',
] as const;

export const FRESHNESS_SQL = {
  schemas: `
    SELECT n.nspname AS name
    FROM pg_namespace n
    WHERE n.nspname NOT LIKE 'pg_toast%'
      AND n.nspname NOT LIKE 'pg_temp_%'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
    ORDER BY 1
  `,
  relations: `
    SELECT n.nspname AS schema_name, c.relname AS name, c.relkind AS kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    ORDER BY 1, 2
  `,
  functions: `
    SELECT n.nspname AS schema_name, p.proname AS name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema'
    ORDER BY 1, 2
  `,
  extensions: `
    SELECT e.extname AS name
    FROM pg_extension e
    ORDER BY 1
  `,
  identity: `
    SELECT current_database() AS current_database, current_user AS current_user
  `,
  marker: `
    SELECT shobj_description(d.oid, 'pg_database') AS comment
    FROM pg_database d
    WHERE d.datname = current_database()
  `,
  server: `
    SELECT current_setting('server_version') AS server_version,
           current_setting('server_version_num') AS server_version_num
  `,
} as const;

export type UrlValidationFailureCode =
  | 'malformed'
  | 'protocol'
  | 'host'
  | 'port'
  | 'user'
  | 'password'
  | 'database'
  | 'query'
  | 'hash'
  | 'mismatch';

export class DatabaseUrlValidationError extends Error {
  readonly code: UrlValidationFailureCode;

  constructor(code: UrlValidationFailureCode, message: string) {
    super(message);
    this.name = 'DatabaseUrlValidationError';
    this.code = code;
  }
}

export class LocalTestPostgresError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'LocalTestPostgresError';
    this.exitCode = exitCode;
  }
}

export interface CheckoutIdentity {
  canonicalPath: string;
  projectId: string;
  projectName: string;
  hostPort: number;
}

export interface LifecycleState {
  version: number;
  projectId: string;
  nonce: string;
  pid: number;
  startedAt: string;
  consumedAt: string | null;
}

export interface LifecyclePaths {
  root: string;
  lockDir: string;
  pidFile: string;
  stateFile: string;
}

export interface FreshnessInventory {
  schemas: string[];
  relations: Array<{ schema: string; name: string }>;
  functions: Array<{ schema: string; name: string }>;
  extensions: string[];
}

export interface OwnedResource {
  kind: 'container' | 'volume' | 'network';
  id: string;
}

export interface ExecCommandRequest {
  command: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  stdio: 'pipe' | 'inherit';
}

export interface ExecCommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface ManagedChild {
  pid?: number;
  kill(signal?: NodeJS.Signals): boolean;
  readonly exitCode: number | null;
}

export interface TrackedSpawn {
  child: ManagedChild;
  completed: Promise<ExecCommandResult>;
}

export interface PostgresQueryResult<T extends object = Record<string, unknown>> {
  rows: T[];
}

export interface PostgresSession {
  query<T extends object = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<PostgresQueryResult<T>>;
  end(): Promise<void>;
}

export interface LocalTestPostgresDependencies {
  repoRoot: string;
  tmpDir: string;
  execPath: string;
  parentEnv: NodeJS.ProcessEnv;
  now(): Date;
  randomNonce(): string;
  currentPid(): number;
  isProcessAlive(pid: number): boolean;
  realpath(target: string): Promise<string>;
  pathExists(target: string): Promise<boolean>;
  mkdir(target: string, options?: { recursive?: boolean }): Promise<void>;
  rm(target: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  readFile(target: string): Promise<string>;
  writeFile(target: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  execCommand(request: ExecCommandRequest): Promise<ExecCommandResult>;
  spawnTracked(request: ExecCommandRequest): TrackedSpawn;
  connectDatabase(url: string): Promise<PostgresSession>;
  resolveVitestEntrypoint(repoRoot: string): string;
  log(message: string): void;
  logError(message: string): void;
}

const FORBIDDEN_STATE_KEYS = [
  'url',
  'password',
  'user',
  'username',
  'database',
  'host',
  'port',
  'TEST_DATABASE_URL',
  'connectionString',
  'credentials',
];

export function hashCanonicalCheckoutPath(canonicalPath: string): string {
  return createHash('sha256').update(canonicalPath, 'utf8').digest('hex');
}

export function deriveHostPort(projectId: string): number {
  const slice = projectId.slice(PROJECT_NAME_HASH_LENGTH, PROJECT_NAME_HASH_LENGTH + 8);
  const n = Number.parseInt(slice, 16);
  if (!Number.isInteger(n) || n < 0) {
    throw new LocalTestPostgresError('Unable to derive a host port from the checkout hash.');
  }
  return HOST_PORT_MIN + (n % HOST_PORT_COUNT);
}

export function deriveCheckoutIdentity(canonicalPath: string): CheckoutIdentity {
  if (!canonicalPath || !path.isAbsolute(canonicalPath)) {
    throw new LocalTestPostgresError('Canonical checkout path must be an absolute resolved path.');
  }
  const projectId = hashCanonicalCheckoutPath(canonicalPath);
  const projectName = `${PROJECT_NAME_PREFIX}${projectId.slice(0, PROJECT_NAME_HASH_LENGTH)}`;
  const hostPort = deriveHostPort(projectId);
  if (hostPort === 5432 || hostPort < 1024 || hostPort > 65535) {
    throw new LocalTestPostgresError('Derived host port is outside the bounded unprivileged range.');
  }
  return { canonicalPath, projectId, projectName, hostPort };
}

export function formatLocalTestDatabaseUrl(hostPort: number): string {
  return `${URL_PROTOCOL}//${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${hostPort}/${DB_NAME}`;
}

export function buildDatabaseComment(projectId: string, nonce: string): string {
  assertHexToken(projectId, 'projectId');
  assertHexToken(nonce, 'nonce');
  return `${DATABASE_COMMENT_PREFIX}:v${STATE_VERSION}:${projectId}:${nonce}`;
}

export function assertHexToken(value: string, label: string): void {
  if (!/^[0-9a-f]+$/.test(value) || value.length < 16) {
    throw new LocalTestPostgresError(`${label} must be a lowercase hex token.`);
  }
}

export function quotePgLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function validateLocalTestDatabaseUrl(candidate: string, expectedPort: number): string {
  const expected = formatLocalTestDatabaseUrl(expectedPort);
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new DatabaseUrlValidationError('malformed', 'Database URL is missing or empty.');
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new DatabaseUrlValidationError('malformed', 'Database URL is malformed.');
  }

  if (parsed.protocol !== URL_PROTOCOL) {
    throw new DatabaseUrlValidationError('protocol', 'Database URL protocol must be postgresql:');
  }
  if (parsed.hostname !== DB_HOST) {
    throw new DatabaseUrlValidationError('host', 'Database URL host must be exactly 127.0.0.1.');
  }
  const port = Number.parseInt(parsed.port, 10);
  if (!Number.isInteger(port) || port !== expectedPort) {
    throw new DatabaseUrlValidationError(
      'port',
      'Database URL port does not match the derived checkout port.',
    );
  }
  if (parsed.username !== DB_USER) {
    throw new DatabaseUrlValidationError('user', 'Database URL user is not the local test user.');
  }
  if (parsed.password !== DB_PASSWORD) {
    throw new DatabaseUrlValidationError(
      'password',
      'Database URL password is not the local test password.',
    );
  }
  if (parsed.pathname !== `/${DB_NAME}`) {
    throw new DatabaseUrlValidationError(
      'database',
      'Database URL database name must be exactly avsworklog_test.',
    );
  }
  if (parsed.search !== '' || [...parsed.searchParams].length > 0) {
    throw new DatabaseUrlValidationError('query', 'Database URL must not include a query string.');
  }
  if (parsed.hash !== '') {
    throw new DatabaseUrlValidationError('hash', 'Database URL must not include a hash.');
  }
  if (candidate !== expected) {
    throw new DatabaseUrlValidationError(
      'mismatch',
      'Database URL must match the exact locally constructed URL.',
    );
  }
  return expected;
}

export function isInheritedDatabaseUrlKey(key: string): boolean {
  if (key.startsWith('POSTGRES_URL')) return true;
  return (INHERITED_DATABASE_URL_KEYS as readonly string[]).includes(key);
}

export function stripInheritedDatabaseAndProvenanceEnv(
  parentEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parentEnv };
  for (const key of Object.keys(env)) {
    if (
      isInheritedDatabaseUrlKey(key) ||
      (ALL_PROVENANCE_ENV_KEYS as readonly string[]).includes(key) ||
      (DOCKER_OVERRIDE_ENV_KEYS as readonly string[]).includes(key)
    ) {
      delete env[key];
    }
  }
  return env;
}

export function buildDockerLifecycleEnv(
  parentEnv: NodeJS.ProcessEnv,
  hostPort: number,
): NodeJS.ProcessEnv {
  const env = stripInheritedDatabaseAndProvenanceEnv(parentEnv);
  env[PORT_ENV_NAME] = String(hostPort);
  return env;
}

export function buildChildTestEnv(input: {
  parentEnv: NodeJS.ProcessEnv;
  databaseUrl: string;
  marker: string;
  projectName: string;
  hostPort: number;
}): NodeJS.ProcessEnv {
  const env = stripInheritedDatabaseAndProvenanceEnv(input.parentEnv);
  env.TEST_DATABASE_URL = validateLocalTestDatabaseUrl(input.databaseUrl, input.hostPort);
  env[PROVENANCE_ENV_KEYS.marker] = input.marker;
  env[PROVENANCE_ENV_KEYS.project] = input.projectName;
  env[PROVENANCE_ENV_KEYS.port] = String(input.hostPort);
  return env;
}

export function buildSentinelChildEnv(parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return stripInheritedDatabaseAndProvenanceEnv(parentEnv);
}

export function assertEnvHasNoDatabaseUrl(env: NodeJS.ProcessEnv): void {
  if (env.TEST_DATABASE_URL) {
    throw new LocalTestPostgresError('TEST_DATABASE_URL must not be present on this child.');
  }
  for (const key of Object.keys(env)) {
    if (isInheritedDatabaseUrlKey(key)) {
      throw new LocalTestPostgresError(`${key} must not be present on this child.`);
    }
  }
}

export function getLifecyclePaths(tmpDir: string, projectName: string): LifecyclePaths {
  const root = path.join(tmpDir, TEMP_SCOPE_DIR_NAME, projectName);
  const lockDir = path.join(root, LOCK_DIR_NAME);
  return {
    root,
    lockDir,
    pidFile: path.join(lockDir, PID_FILE_NAME),
    stateFile: path.join(root, STATE_FILE_NAME),
  };
}

export function serializeLifecycleState(state: LifecycleState): string {
  return `${JSON.stringify(state, [...ALLOWED_STATE_KEYS], 2)}\n`;
}

export function parseLifecycleState(raw: unknown): LifecycleState {
  if (typeof raw === 'string') {
    try {
      return parseLifecycleState(JSON.parse(raw) as unknown);
    } catch (error) {
      if (error instanceof LocalTestPostgresError) throw error;
      throw new LocalTestPostgresError('Lifecycle state JSON is malformed.');
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LocalTestPostgresError('Lifecycle state must be a JSON object.');
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_STATE_KEYS.includes(key)) {
      throw new LocalTestPostgresError('Lifecycle state must not contain URLs or credentials.');
    }
    if (!(ALLOWED_STATE_KEYS as readonly string[]).includes(key)) {
      throw new LocalTestPostgresError(`Lifecycle state contains unsupported key "${key}".`);
    }
  }
  const version = record.version;
  const projectId = record.projectId;
  const nonce = record.nonce;
  const pid = record.pid;
  const startedAt = record.startedAt;
  const consumedAt = record.consumedAt ?? null;
  if (typeof version !== 'number' || version !== STATE_VERSION) {
    throw new LocalTestPostgresError('Lifecycle state version is unsupported.');
  }
  if (typeof projectId !== 'string') {
    throw new LocalTestPostgresError('Lifecycle state projectId is invalid.');
  }
  if (typeof nonce !== 'string') {
    throw new LocalTestPostgresError('Lifecycle state nonce is invalid.');
  }
  assertHexToken(projectId, 'projectId');
  assertHexToken(nonce, 'nonce');
  if (!Number.isInteger(pid) || (pid as number) <= 0) {
    throw new LocalTestPostgresError('Lifecycle state pid is invalid.');
  }
  if (typeof startedAt !== 'string' || Number.isNaN(Date.parse(startedAt))) {
    throw new LocalTestPostgresError('Lifecycle state startedAt is invalid.');
  }
  if (consumedAt !== null && (typeof consumedAt !== 'string' || Number.isNaN(Date.parse(consumedAt)))) {
    throw new LocalTestPostgresError('Lifecycle state consumedAt is invalid.');
  }
  return {
    version,
    projectId,
    nonce,
    pid: pid as number,
    startedAt,
    consumedAt,
  };
}

export function isLifecycleStateConsumed(state: LifecycleState): boolean {
  return typeof state.consumedAt === 'string' && state.consumedAt.length > 0;
}

export function markLifecycleStateConsumed(state: LifecycleState, consumedAt: string): LifecycleState {
  return { ...state, consumedAt };
}

export function parseLockPid(contents: string): number | null {
  const trimmed = contents.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const pid = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return pid;
}

export function shouldReclaimStaleLock(pid: number | null, alive: boolean): boolean {
  return pid !== null && pid > 0 && !alive;
}

export function findFreshnessViolations(inventory: FreshnessInventory): string[] {
  const violations: string[] = [];
  for (const schema of inventory.schemas) {
    violations.push(`unexpected schema ${schema}`);
  }
  for (const relation of inventory.relations) {
    violations.push(`unexpected relation ${relation.schema}.${relation.name}`);
  }
  for (const fn of inventory.functions) {
    violations.push(`unexpected function ${fn.schema}.${fn.name}`);
  }
  for (const extension of inventory.extensions) {
    if (!(ALLOWED_FRESH_EXTENSIONS as readonly string[]).includes(extension)) {
      violations.push(`unexpected extension ${extension}`);
    }
  }
  return violations;
}

export function buildComposeBaseArgv(composeFileAbs: string, projectName: string): string[] {
  if (!path.isAbsolute(composeFileAbs)) {
    throw new LocalTestPostgresError('Compose file path must be absolute.');
  }
  return ['compose', '-f', composeFileAbs, '-p', projectName];
}

export function buildComposeDownArgv(composeFileAbs: string, projectName: string): string[] {
  return [
    ...buildComposeBaseArgv(composeFileAbs, projectName),
    'down',
    '--volumes',
    '--remove-orphans',
  ];
}

export function buildComposeUpArgv(
  composeFileAbs: string,
  projectName: string,
  waitTimeoutSeconds = COMPOSE_UP_WAIT_TIMEOUT_SECONDS,
): string[] {
  return [
    ...buildComposeBaseArgv(composeFileAbs, projectName),
    'up',
    '--detach',
    '--wait',
    '--wait-timeout',
    String(waitTimeoutSeconds),
  ];
}

export function buildDockerPsArgv(projectName: string): string[] {
  return [
    'ps',
    '-a',
    '--filter',
    `label=com.docker.compose.project=${projectName}`,
    '--format',
    '{{.ID}}',
  ];
}

export function buildDockerVolumeLsArgv(projectName: string): string[] {
  return [
    'volume',
    'ls',
    '--filter',
    `label=com.docker.compose.project=${projectName}`,
    '--format',
    '{{.Name}}',
  ];
}

export function buildDockerNetworkLsArgv(projectName: string): string[] {
  return [
    'network',
    'ls',
    '--filter',
    `label=com.docker.compose.project=${projectName}`,
    '--format',
    '{{.ID}}',
  ];
}

export function assertComposeArgvContract(
  argv: readonly string[],
  composeFileAbs: string,
  projectName: string,
): void {
  if (argv[0] !== 'compose') {
    throw new LocalTestPostgresError('Docker Compose argv must start with compose.');
  }
  const fileIndex = argv.indexOf('-f');
  const projectIndex = argv.indexOf('-p');
  if (fileIndex < 0 || argv[fileIndex + 1] !== composeFileAbs || !path.isAbsolute(composeFileAbs)) {
    throw new LocalTestPostgresError('Docker Compose argv must include the exact absolute compose file.');
  }
  if (projectIndex < 0 || argv[projectIndex + 1] !== projectName) {
    throw new LocalTestPostgresError('Docker Compose argv must include the derived project name.');
  }
}

export function assertDockerEnvContainsPort(env: NodeJS.ProcessEnv, hostPort: number): void {
  if (env[PORT_ENV_NAME] !== String(hostPort)) {
    throw new LocalTestPostgresError(`${PORT_ENV_NAME} must be set to the derived port.`);
  }
}

export function parseDockerResourceLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function assertLocalDockerEndpoint(endpoint: string): void {
  const normalized = endpoint.trim().toLowerCase();
  const isLocal =
    normalized.startsWith('npipe://') ||
    normalized.startsWith('unix://') ||
    normalized.startsWith('tcp://127.0.0.1:') ||
    normalized.startsWith('tcp://localhost:');
  if (!isLocal) {
    throw new LocalTestPostgresError(
      'Refusing to use a non-local Docker endpoint for the disposable test database.',
    );
  }
}

export function mapSignalToExitCode(signal: NodeJS.Signals): number {
  if (signal === 'SIGINT') return 130;
  if (signal === 'SIGTERM') return 143;
  return 1;
}

export function resolveOneShotExitCode(
  childExitCode: number | null,
  cleanupFailed: boolean,
): number {
  const child = childExitCode ?? 1;
  if (cleanupFailed && child === 0) return CLEANUP_FAILURE_EXIT_CODE;
  return child;
}

export function resolveVerifyFailureCleanupExitCode(input: {
  childExitCode: number | null;
  cleanupFailed: boolean;
  resourcesRemain: boolean;
}): number {
  const proofPassed =
    input.childExitCode === SENTINEL_EXIT_CODE &&
    !input.cleanupFailed &&
    !input.resourcesRemain;
  return proofPassed ? 0 : 1;
}

export function parseCliCommand(argv: readonly string[]): CliCommand {
  const command = argv[0];
  if (!command || !(CLI_COMMANDS as readonly string[]).includes(command)) {
    throw new LocalTestPostgresError(
      `Unknown command. Usage: tsx scripts/local-test-postgres.ts <${CLI_COMMANDS.join('|')}>`,
      2,
    );
  }
  if (argv.length !== 1) {
    throw new LocalTestPostgresError(`Command "${command}" takes no extra arguments.`, 2);
  }
  return command as CliCommand;
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

export function resolveVitestEntrypoint(repoRoot: string): string {
  const require = createRequire(path.join(repoRoot, 'package.json'));
  const packageJsonPath = require.resolve('vitest/package.json');
  const pkg = require(packageJsonPath) as { bin?: string | { vitest?: string } };
  const relative = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.vitest;
  if (!relative) {
    throw new LocalTestPostgresError(
      'Unable to resolve the local Vitest entrypoint. Install repository devDependencies and retry.',
    );
  }
  return path.resolve(path.dirname(packageJsonPath), relative);
}

export function sanitizeLogText(text: string): string {
  return text
    .replace(/postgresql:\/\/[^\s'"]+/giu, 'postgresql://***')
    .replace(/postgres:\/\/[^\s'"]+/giu, 'postgres://***')
    .replaceAll(DB_PASSWORD, '***');
}

export function postgresMajorFromVersionNum(serverVersionNum: string): number {
  const n = Number.parseInt(serverVersionNum, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new LocalTestPostgresError('PostgreSQL server_version_num is invalid.');
  }
  return Math.floor(n / 10_000);
}

function spawnProcess(request: ExecCommandRequest): { child: ChildProcess; completed: Promise<ExecCommandResult> } {
  const child = spawn(request.command, [...request.args], {
    cwd: request.cwd,
    env: request.env,
    shell: false,
    windowsHide: true,
    stdio: request.stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });

  const completed = new Promise<ExecCommandResult>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, CHILD_TERMINATE_GRACE_MS).unref?.();
    }, request.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        signal: signal as NodeJS.Signals | null,
        stdout,
        stderr,
      });
    });
  });

  return { child, completed };
}

export function createDefaultDependencies(
  overrides: Partial<LocalTestPostgresDependencies> = {},
): LocalTestPostgresDependencies {
  const repoRoot = overrides.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const base: LocalTestPostgresDependencies = {
    repoRoot,
    tmpDir: overrides.tmpDir ?? os.tmpdir(),
    execPath: overrides.execPath ?? process.execPath,
    parentEnv: overrides.parentEnv ?? process.env,
    now: () => new Date(),
    randomNonce: () => randomBytes(NONCE_BYTES).toString('hex'),
    currentPid: () => process.pid,
    isProcessAlive: isPidAlive,
    realpath: (target) => fs.realpath(target),
    pathExists: async (target) => {
      try {
        await fs.access(target);
        return true;
      } catch {
        return false;
      }
    },
    mkdir: (target, options) => fs.mkdir(target, options).then(() => undefined),
    rm: (target, options) => fs.rm(target, options),
    readFile: (target) => fs.readFile(target, 'utf8'),
    writeFile: (target, contents) => fs.writeFile(target, contents, 'utf8'),
    rename: (from, to) => fs.rename(from, to),
    execCommand: async (request) => {
      const { completed } = spawnProcess(request);
      return completed;
    },
    spawnTracked: (request) => spawnProcess(request),
    connectDatabase: async (url) => {
      const validatedHint = url.startsWith(`${URL_PROTOCOL}//`);
      if (!validatedHint) {
        throw new LocalTestPostgresError('Refusing to connect with a non-postgresql URL.');
      }
      const client = new Client({
        connectionString: url,
        connectionTimeoutMillis: PG_CONNECT_TIMEOUT_MS,
        ssl: false,
      });
      await client.connect();
      return {
        query: (sql, params) => client.query(sql, params as never),
        end: () => client.end(),
      };
    },
    resolveVitestEntrypoint,
    log: (message) => {
      process.stdout.write(`${message}\n`);
    },
    logError: (message) => {
      process.stderr.write(`${message}\n`);
    },
  };
  return { ...base, ...overrides };
}

export function createLocalTestPostgresOrchestrator(
  deps: LocalTestPostgresDependencies = createDefaultDependencies(),
): LocalTestPostgresOrchestrator {
  return new LocalTestPostgresOrchestrator(deps);
}

export class LocalTestPostgresOrchestrator {
  private lockDepth = 0;
  private activeChild: ManagedChild | null = null;
  private cleanupPromise: Promise<void> | null = null;
  private signalEntered = false;
  private identity: CheckoutIdentity | null = null;

  constructor(private readonly deps: LocalTestPostgresDependencies) {}

  async start(): Promise<number> {
    await this.withLock(async () => {
      try {
        await this.startLocked();
      } catch (error) {
        try {
          await this.stopOnceLocked();
        } catch (cleanupError) {
          this.deps.logError(
            `Startup failed and recovery cleanup also failed: ${sanitizeLogText(errorMessage(cleanupError))}`,
          );
        }
        throw error;
      }
    });
    return 0;
  }

  async run(): Promise<number> {
    return this.withLock(() => this.runLocked());
  }

  async stop(): Promise<number> {
    await this.withLock(() => this.stopOnceLocked());
    this.deps.log(`[${STABLE_IDS.CLEAN_SUCCESS}] Checkout-scoped Compose resources are absent.`);
    return 0;
  }

  async oneShot(): Promise<number> {
    return this.withLock(async () => {
      let childExitCode: number | null = null;
      let runError: unknown = null;
      try {
        await this.startLocked();
        childExitCode = await this.runLocked();
      } catch (error) {
        runError = error;
      }

      let cleanupError: unknown = null;
      try {
        await this.stopOnceLocked();
      } catch (error) {
        cleanupError = error;
        this.deps.logError(sanitizeLogText(errorMessage(error)));
        this.deps.logError('Local test database cleanup failed.');
      }

      if (runError) {
        if (cleanupError) {
          this.deps.logError('Command failed and cleanup also failed; preserving the original error.');
        }
        throw runError;
      }

      const exitCode = resolveOneShotExitCode(childExitCode, Boolean(cleanupError));
      if (cleanupError && childExitCode === 0) {
        this.deps.logError('Tests passed but cleanup failed.');
      } else if (!cleanupError) {
        this.deps.log(`[${STABLE_IDS.CLEAN_SUCCESS}] Checkout-scoped Compose resources are absent.`);
      }
      return exitCode;
    });
  }

  async verifyFailureCleanup(): Promise<number> {
    return this.withLock(async () => {
      let childExitCode: number | null = null;
      let runError: unknown = null;
      try {
        await this.startLocked();
        const sentinelEnv = buildSentinelChildEnv(this.deps.parentEnv);
        assertEnvHasNoDatabaseUrl(sentinelEnv);
        const result = await this.runTracked({
          command: this.deps.execPath,
          args: ['-e', 'process.exit(23)'],
          cwd: this.deps.repoRoot,
          env: sentinelEnv,
          timeoutMs: 15_000,
          stdio: 'pipe',
        });
        childExitCode = result.exitCode;
      } catch (error) {
        runError = error;
      }

      let cleanupError: unknown = null;
      try {
        await this.stopOnceLocked();
      } catch (error) {
        cleanupError = error;
        this.deps.logError(sanitizeLogText(errorMessage(error)));
      }

      const remaining = cleanupError ? [{ kind: 'container' as const, id: 'unverified' }] : await this.listOwnedResources();
      const exitCode = resolveVerifyFailureCleanupExitCode({
        childExitCode,
        cleanupFailed: Boolean(cleanupError) || Boolean(runError),
        resourcesRemain: remaining.length > 0,
      });
      if (exitCode === 0) {
        this.deps.log(
          `[${STABLE_IDS.CLEAN_FAILURE}] Sentinel exit ${SENTINEL_EXIT_CODE} preserved; owned resources are absent.`,
        );
        return 0;
      }
      if (runError) {
        this.deps.logError(sanitizeLogText(errorMessage(runError)));
      }
      this.deps.logError(
        `[${STABLE_IDS.CLEAN_FAILURE}] Failure-cleanup proof did not pass (child=${childExitCode ?? 'none'}).`,
      );
      return 1;
    });
  }

  async handleSignal(signal: NodeJS.Signals): Promise<number> {
    if (this.signalEntered) return mapSignalToExitCode(signal);
    this.signalEntered = true;
    try {
      if (this.cleanupPromise) {
        await this.cleanupPromise;
      } else {
        await this.terminateActiveChild();
        if (this.lockDepth === 0) {
          await this.withLock(() => this.stopOnceLocked());
        } else {
          await this.stopOnceLocked();
        }
      }
    } catch (error) {
      this.deps.logError(sanitizeLogText(errorMessage(error)));
    }
    return mapSignalToExitCode(signal);
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const acquired = this.lockDepth === 0;
    if (acquired) await this.acquireLock();
    this.lockDepth += 1;
    try {
      return await fn();
    } finally {
      this.lockDepth -= 1;
      if (acquired) {
        await this.releaseLock();
      }
    }
  }

  private async resolveIdentity(): Promise<CheckoutIdentity> {
    if (this.identity) return this.identity;
    const canonicalPath = await this.deps.realpath(this.deps.repoRoot);
    this.identity = deriveCheckoutIdentity(canonicalPath);
    return this.identity;
  }

  private async resolveComposeFile(identity: CheckoutIdentity): Promise<string> {
    const candidate = path.join(identity.canonicalPath, COMPOSE_FILE_NAME);
    if (!(await this.deps.pathExists(candidate))) {
      throw new LocalTestPostgresError(
        `Missing ${COMPOSE_FILE_NAME} at the repository root. Create the Compose file before starting the local test database.`,
      );
    }
    return this.deps.realpath(candidate);
  }

  private async acquireLock(): Promise<void> {
    const identity = await this.resolveIdentity();
    const paths = getLifecyclePaths(this.deps.tmpDir, identity.projectName);
    await this.deps.mkdir(paths.root, { recursive: true });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.deps.mkdir(paths.lockDir);
        await this.deps.writeFile(paths.pidFile, `${this.deps.currentPid()}\n`);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') throw error;
        let pid: number | null = null;
        try {
          pid = parseLockPid(await this.deps.readFile(paths.pidFile));
        } catch {
          pid = null;
        }
        const alive = pid !== null && this.deps.isProcessAlive(pid);
        if (shouldReclaimStaleLock(pid, alive)) {
          await this.deps.rm(paths.lockDir, { recursive: true, force: true });
          continue;
        }
        if (alive) {
          throw new LocalTestPostgresError(
            `Local test database lifecycle lock is held by live PID ${pid}. Wait for that command to finish.`,
          );
        }
        throw new LocalTestPostgresError(
          'Local test database lifecycle lock exists without a reclaimable dead PID. Remove it only after confirming no lifecycle command is running.',
        );
      }
    }
    throw new LocalTestPostgresError('Unable to acquire the local test database lifecycle lock.');
  }

  private async releaseLock(): Promise<void> {
    try {
      const identity = await this.resolveIdentity();
      const paths = getLifecyclePaths(this.deps.tmpDir, identity.projectName);
      await this.deps.rm(paths.lockDir, { recursive: true, force: true });
    } catch (error) {
      this.deps.logError(sanitizeLogText(errorMessage(error)));
    }
  }

  private async startLocked(): Promise<void> {
    this.cleanupPromise = null;
    const identity = await this.resolveIdentity();
    const composeFileAbs = await this.resolveComposeFile(identity);
    const dockerEnv = this.dockerEnv(identity);

    await this.verifyLocalDockerContext(dockerEnv);
    await this.composeDown(composeFileAbs, identity, dockerEnv);
    await this.assertNoOwnedResources(identity);

    const upArgv = buildComposeUpArgv(composeFileAbs, identity.projectName);
    assertComposeArgvContract(upArgv, composeFileAbs, identity.projectName);
    const up = await this.runDocker(upArgv, dockerEnv, (COMPOSE_UP_WAIT_TIMEOUT_SECONDS + 15) * 1000);
    if (up.exitCode !== 0) {
      throw new LocalTestPostgresError(
        `Docker Compose failed to become healthy. ${summarizeDockerFailure(up)}`,
      );
    }

    const nonce = this.deps.randomNonce();
    assertHexToken(nonce, 'nonce');
    const url = validateLocalTestDatabaseUrl(
      formatLocalTestDatabaseUrl(identity.hostPort),
      identity.hostPort,
    );
    const marker = buildDatabaseComment(identity.projectId, nonce);
    const server = await this.withDatabase(url, async (session) => {
      await this.verifyIdentity(session);
      await this.verifyFreshness(session);
      await this.assertNoMarker(session);
      await session.query(
        `COMMENT ON DATABASE ${DB_NAME} IS ${quotePgLiteral(marker)}`,
      );
      const written = await this.readMarker(session);
      if (written !== marker) {
        throw new LocalTestPostgresError('Database marker write did not round-trip.');
      }
      return this.readServerVersion(session);
    });

    if (postgresMajorFromVersionNum(server.server_version_num) !== EXPECTED_POSTGRES_MAJOR) {
      throw new LocalTestPostgresError(
        `Expected PostgreSQL ${EXPECTED_POSTGRES_MAJOR} but received server_version_num=${server.server_version_num}.`,
      );
    }

    await this.writeState({
      version: STATE_VERSION,
      projectId: identity.projectId,
      nonce,
      pid: this.deps.currentPid(),
      startedAt: this.deps.now().toISOString(),
      consumedAt: null,
    });

    this.deps.log(
      `[${STABLE_IDS.BOOT}] PostgreSQL ${server.server_version} (server_version_num=${server.server_version_num})`,
    );
  }

  private async runLocked(): Promise<number> {
    const identity = await this.resolveIdentity();
    const state = await this.readState();
    if (state.projectId !== identity.projectId) {
      throw new LocalTestPostgresError('Lifecycle state does not match this checkout.');
    }
    if (isLifecycleStateConsumed(state)) {
      throw new LocalTestPostgresError(
        'This local test database has already been used. Run start again before a second run.',
      );
    }

    const url = validateLocalTestDatabaseUrl(
      formatLocalTestDatabaseUrl(identity.hostPort),
      identity.hostPort,
    );
    const expectedMarker = buildDatabaseComment(state.projectId, state.nonce);
    await this.withDatabase(url, async (session) => {
      await this.verifyIdentity(session);
      const marker = await this.readMarker(session);
      if (marker !== expectedMarker) {
        throw new LocalTestPostgresError(
          'Database marker does not match the checkout identity and nonce.',
        );
      }
      await this.verifyFreshness(session);
    });

    const consumed = markLifecycleStateConsumed(state, this.deps.now().toISOString());
    await this.writeState(consumed);

    const childEnv = buildChildTestEnv({
      parentEnv: this.deps.parentEnv,
      databaseUrl: url,
      marker: expectedMarker,
      projectName: identity.projectName,
      hostPort: identity.hostPort,
    });
    const vitestEntrypoint = this.deps.resolveVitestEntrypoint(identity.canonicalPath);
    const result = await this.runTracked({
      command: this.deps.execPath,
      args: [vitestEntrypoint, 'run', TARGET_TEST_FILE, '--reporter=verbose'],
      cwd: identity.canonicalPath,
      env: childEnv,
      timeoutMs: 30 * 60 * 1000,
      stdio: 'inherit',
    });
    return result.exitCode ?? 1;
  }

  private async stopLocked(): Promise<void> {
    const identity = await this.resolveIdentity();
    const composeFileAbs = await this.resolveComposeFile(identity);
    const dockerEnv = this.dockerEnv(identity);
    const paths = getLifecyclePaths(this.deps.tmpDir, identity.projectName);

    await this.verifyLocalDockerContext(dockerEnv);
    await this.composeDown(composeFileAbs, identity, dockerEnv);
    await this.assertNoOwnedResources(identity);

    if (await this.deps.pathExists(paths.stateFile)) {
      await this.deps.rm(paths.stateFile, { force: true });
    }
  }

  private stopOnceLocked(): Promise<void> {
    if (!this.cleanupPromise) {
      this.cleanupPromise = this.stopLocked();
    }
    return this.cleanupPromise;
  }

  private dockerEnv(identity: CheckoutIdentity): NodeJS.ProcessEnv {
    const env = buildDockerLifecycleEnv(this.deps.parentEnv, identity.hostPort);
    assertDockerEnvContainsPort(env, identity.hostPort);
    assertEnvHasNoDatabaseUrl(env);
    return env;
  }

  private async composeDown(
    composeFileAbs: string,
    identity: CheckoutIdentity,
    dockerEnv: NodeJS.ProcessEnv,
  ): Promise<void> {
    const argv = buildComposeDownArgv(composeFileAbs, identity.projectName);
    assertComposeArgvContract(argv, composeFileAbs, identity.projectName);
    const result = await this.runDocker(argv, dockerEnv, COMPOSE_DOWN_TIMEOUT_MS);
    if (result.exitCode !== 0) {
      throw new LocalTestPostgresError(
        `Docker Compose down failed. ${summarizeDockerFailure(result)}`,
      );
    }
  }

  private async runDocker(
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
  ): Promise<ExecCommandResult> {
    try {
      return await this.runTracked({
        command: 'docker',
        args,
        cwd: this.deps.repoRoot,
        env,
        timeoutMs,
        stdio: 'pipe',
      });
    } catch (error) {
      throw wrapDockerAvailabilityError(error);
    }
  }

  private async verifyLocalDockerContext(env: NodeJS.ProcessEnv): Promise<void> {
    let shown: ExecCommandResult;
    try {
      shown = await this.runTracked({
        command: 'docker',
        args: ['context', 'show'],
        cwd: this.deps.repoRoot,
        env,
        timeoutMs: 30_000,
        stdio: 'pipe',
      });
    } catch (error) {
      throw wrapDockerAvailabilityError(error);
    }
    const contextName = shown.stdout.trim();
    if (
      shown.exitCode !== 0 ||
      !/^[a-zA-Z0-9_.-]+$/u.test(contextName)
    ) {
      throw new LocalTestPostgresError(
        `Unable to identify a safe local Docker context. ${summarizeDockerFailure(shown)}`,
      );
    }

    const inspected = await this.runDocker(
      [
        'context',
        'inspect',
        contextName,
        '--format',
        '{{ (index .Endpoints "docker").Host }}',
      ],
      env,
      30_000,
    );
    if (inspected.exitCode !== 0) {
      throw new LocalTestPostgresError(
        `Unable to inspect the active Docker context. ${summarizeDockerFailure(inspected)}`,
      );
    }
    assertLocalDockerEndpoint(inspected.stdout);
  }

  private async runTracked(request: ExecCommandRequest): Promise<ExecCommandResult> {
    const tracked = this.deps.spawnTracked(request);
    this.activeChild = tracked.child;
    try {
      return await tracked.completed;
    } finally {
      if (this.activeChild === tracked.child) this.activeChild = null;
    }
  }

  private async terminateActiveChild(): Promise<void> {
    const child = this.activeChild;
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    const started = Date.now();
    while (child.exitCode === null && Date.now() - started < CHILD_TERMINATE_GRACE_MS) {
      await delay(50);
    }
    if (child.exitCode === null) child.kill('SIGKILL');
  }

  private async listOwnedResources(): Promise<OwnedResource[]> {
    const identity = await this.resolveIdentity();
    const env = this.dockerEnv(identity);
    const queries: Array<{ kind: OwnedResource['kind']; args: string[] }> = [
      { kind: 'container', args: buildDockerPsArgv(identity.projectName) },
      { kind: 'volume', args: buildDockerVolumeLsArgv(identity.projectName) },
      { kind: 'network', args: buildDockerNetworkLsArgv(identity.projectName) },
    ];
    const owned: OwnedResource[] = [];
    for (const query of queries) {
      const result = await this.runDocker(query.args, env, 30_000);
      if (result.exitCode !== 0) {
        throw new LocalTestPostgresError(
          `Unable to list Docker ${query.kind}s for cleanup proof. ${summarizeDockerFailure(result)}`,
        );
      }
      for (const id of parseDockerResourceLines(result.stdout)) {
        owned.push({ kind: query.kind, id });
      }
    }
    return owned;
  }

  private async assertNoOwnedResources(identity: CheckoutIdentity): Promise<void> {
    const remaining = await this.listOwnedResources();
    if (remaining.length > 0) {
      const summary = remaining.map((item) => `${item.kind}:${item.id}`).join(', ');
      throw new LocalTestPostgresError(
        `Owned Docker resources remain for ${identity.projectName}: ${summary}.`,
      );
    }
  }

  private async withDatabase<T>(
    url: string,
    fn: (session: PostgresSession) => Promise<T>,
  ): Promise<T> {
    validateLocalTestDatabaseUrl(url, (await this.resolveIdentity()).hostPort);
    let session: PostgresSession | null = null;
    try {
      session = await this.deps.connectDatabase(url);
      return await fn(session);
    } catch (error) {
      throw new LocalTestPostgresError(sanitizeLogText(errorMessage(error)));
    } finally {
      try {
        await session?.end();
      } catch {
        // Session close failures must not hide identity/freshness errors.
      }
    }
  }

  private async verifyIdentity(session: PostgresSession): Promise<void> {
    const result = await session.query<{ current_database: string; current_user: string }>(
      FRESHNESS_SQL.identity,
    );
    const row = result.rows[0];
    if (!row || row.current_database !== DB_NAME || row.current_user !== DB_USER) {
      throw new LocalTestPostgresError(
        'Connected database/user does not match the local test identity.',
      );
    }
  }

  private async verifyFreshness(session: PostgresSession): Promise<void> {
    const [schemas, relations, functions, extensions] = await Promise.all([
      session.query<{ name: string }>(FRESHNESS_SQL.schemas),
      session.query<{ schema_name: string; name: string }>(FRESHNESS_SQL.relations),
      session.query<{ schema_name: string; name: string }>(FRESHNESS_SQL.functions),
      session.query<{ name: string }>(FRESHNESS_SQL.extensions),
    ]);
    const violations = findFreshnessViolations({
      schemas: schemas.rows.map((row) => row.name),
      relations: relations.rows.map((row) => ({ schema: row.schema_name, name: row.name })),
      functions: functions.rows.map((row) => ({ schema: row.schema_name, name: row.name })),
      extensions: extensions.rows.map((row) => row.name),
    });
    if (violations.length > 0) {
      throw new LocalTestPostgresError(
        `Database is not a fresh PostgreSQL default (${violations.slice(0, 8).join('; ')}).`,
      );
    }
  }

  private async assertNoMarker(session: PostgresSession): Promise<void> {
    const marker = await this.readMarker(session);
    if (marker) {
      throw new LocalTestPostgresError('Database already has a lifecycle marker; refusing to reuse it.');
    }
  }

  private async readMarker(session: PostgresSession): Promise<string | null> {
    const result = await session.query<{ comment: string | null }>(FRESHNESS_SQL.marker);
    const comment = result.rows[0]?.comment;
    return comment && comment.length > 0 ? comment : null;
  }

  private async readServerVersion(
    session: PostgresSession,
  ): Promise<{ server_version: string; server_version_num: string }> {
    const result = await session.query<{ server_version: string; server_version_num: string }>(
      FRESHNESS_SQL.server,
    );
    const row = result.rows[0];
    if (!row?.server_version || !row.server_version_num) {
      throw new LocalTestPostgresError('Unable to read a sanitized PostgreSQL server version.');
    }
    return row;
  }

  private async readState(): Promise<LifecycleState> {
    const identity = await this.resolveIdentity();
    const paths = getLifecyclePaths(this.deps.tmpDir, identity.projectName);
    if (!(await this.deps.pathExists(paths.stateFile))) {
      throw new LocalTestPostgresError('No local test database state found. Run start first.');
    }
    return parseLifecycleState(await this.deps.readFile(paths.stateFile));
  }

  private async writeState(state: LifecycleState): Promise<void> {
    const identity = await this.resolveIdentity();
    const paths = getLifecyclePaths(this.deps.tmpDir, identity.projectName);
    await this.deps.mkdir(paths.root, { recursive: true });
    const tempFile = `${paths.stateFile}.${this.deps.currentPid()}.tmp`;
    await this.deps.writeFile(tempFile, serializeLifecycleState(state));
    try {
      await this.deps.rename(tempFile, paths.stateFile);
    } catch {
      await this.deps.rm(paths.stateFile, { force: true });
      await this.deps.rename(tempFile, paths.stateFile);
    }
  }
}

export async function runLocalTestPostgresCli(
  argv: readonly string[],
  deps: LocalTestPostgresDependencies = createDefaultDependencies(),
  orchestrator: LocalTestPostgresOrchestrator = new LocalTestPostgresOrchestrator(deps),
): Promise<number> {
  try {
    const command = parseCliCommand(argv);
    switch (command) {
      case 'start':
        return await orchestrator.start();
      case 'run':
        return await orchestrator.run();
      case 'stop':
        return await orchestrator.stop();
      case 'one-shot':
        return await orchestrator.oneShot();
      case 'verify-failure-cleanup':
        return await orchestrator.verifyFailureCleanup();
      default: {
        const exhaustive: never = command;
        throw new LocalTestPostgresError(`Unhandled command ${String(exhaustive)}.`, 2);
      }
    }
  } catch (error) {
    const message = sanitizeLogText(errorMessage(error));
    deps.logError(message);
    if (error instanceof DatabaseUrlValidationError || error instanceof LocalTestPostgresError) {
      return error instanceof LocalTestPostgresError ? error.exitCode : 1;
    }
    return 1;
  }
}

export function installSignalHandlers(
  handler: (signal: NodeJS.Signals) => Promise<number>,
): () => void {
  const signals = ['SIGINT', 'SIGTERM'] as const;
  let entered = false;
  const listener = (signal: NodeJS.Signals): void => {
    if (entered) return;
    entered = true;
    void handler(signal).then((code) => {
      process.exit(code);
    });
  };
  for (const signal of signals) {
    process.on(signal, listener);
  }
  return () => {
    for (const signal of signals) {
      process.off(signal, listener);
    }
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function summarizeDockerFailure(result: ExecCommandResult): string {
  const details = sanitizeLogText(`${result.stderr}\n${result.stdout}`.trim());
  const suffix = details ? ` ${details.slice(0, 400)}` : '';
  return `exit ${result.exitCode ?? 'none'}.${suffix}`;
}

function wrapDockerAvailabilityError(error: unknown): LocalTestPostgresError {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') {
    return new LocalTestPostgresError(
      'Docker is not available on PATH. Install Docker Desktop, ensure Linux containers are running, and confirm `docker compose version` works, then retry.',
    );
  }
  return new LocalTestPostgresError(
    `Docker command failed: ${sanitizeLogText(errorMessage(error))}. Ensure Docker Desktop is running and retry.`,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isDirectCliInvocation(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return path.resolve(invoked) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectCliInvocation()) {
  const deps = createDefaultDependencies();
  const orchestrator = new LocalTestPostgresOrchestrator(deps);
  const uninstallSignals = installSignalHandlers((signal) => orchestrator.handleSignal(signal));
  void (async () => {
    try {
      const code = await runLocalTestPostgresCli(process.argv.slice(2), deps, orchestrator);
      uninstallSignals();
      process.exit(code);
    } catch (error) {
      uninstallSignals();
      deps.logError(sanitizeLogText(errorMessage(error)));
      process.exit(error instanceof LocalTestPostgresError ? error.exitCode : 1);
    }
  })();
}
