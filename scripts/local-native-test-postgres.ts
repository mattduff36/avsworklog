#!/usr/bin/env tsx
/**
 * Windows-native, checkout-scoped PostgreSQL one-shot test runner.
 *
 * It never reads inherited database URLs, binds only to 127.0.0.1 on the
 * checkout-derived non-5432 port, and deletes only a sentinel-owned temp root.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  ALLOWED_TARGET_TEST_FILES,
  DB_HOST,
  DB_NAME,
  DB_PASSWORD,
  DB_USER,
  assessNativePostgresClusterCapability,
  buildChildTestEnv,
  buildDatabaseComment,
  createDefaultDependencies,
  deriveCheckoutIdentity,
  formatLocalTestDatabaseUrl,
  quotePgLiteral,
  sanitizeLogText,
  stripInheritedDatabaseAndProvenanceEnv,
} from './local-test-postgres';

const NATIVE_ROOT_NAME = 'avsworklog-ltdb-native';
const OWNERSHIP_FILE = 'owner.txt';
const DATA_DIR_NAME = 'data';
const LOG_FILE_NAME = 'postgres.log';
const PASSWORD_FILE_NAME = 'initdb.pw';
const CONNECT_TIMEOUT_MS = 15_000;

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface RunNativeLifecycleCommandOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  inherit?: boolean;
  timeoutMs?: number;
  track?: (child: ChildProcess | null) => void;
  terminate?: (child: ChildProcess) => Promise<void>;
}

async function waitForChildExit(child: ChildProcess, timeoutMs = 5_000): Promise<boolean> {
  if (child.exitCode !== null) return true;
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once('close', () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const taskkillExitCode = await new Promise<number>((resolve) => {
      const terminator = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      terminator.once('error', () => resolve(-1));
      terminator.once('close', (code) => resolve(code ?? -1));
    });
    const exited = await waitForChildExit(child);
    if (!exited) {
      throw new Error(
        `Failed to terminate owned lifecycle process tree (taskkill exit ${taskkillExitCode}).`
      );
    }
    return;
  }
  child.kill('SIGTERM');
  if (!(await waitForChildExit(child))) {
    throw new Error('Failed to terminate owned lifecycle process.');
  }
}

export type NativeLifecyclePhase = 'initdb' | 'version' | 'startup' | 'test';

export function createNativeLifecycleChildController(
  terminate: (child: ChildProcess) => Promise<void> = terminateProcessTree
) {
  let active: { phase: NativeLifecyclePhase; child: ChildProcess } | null = null;
  return {
    track(phase: NativeLifecyclePhase) {
      return (child: ChildProcess | null) => {
        active = child ? { phase, child } : null;
      };
    },
    activePhase(): NativeLifecyclePhase | null {
      return active?.phase ?? null;
    },
    async terminateActive(): Promise<void> {
      const current = active;
      if (!current) return;
      await terminate(current.child);
      if (active === current) active = null;
    },
  };
}

function parseTarget(argv: string[]): string {
  if (
    argv.length !== 3 ||
    argv[0] !== 'one-shot' ||
    argv[1] !== '--target' ||
    !(ALLOWED_TARGET_TEST_FILES as readonly string[]).includes(argv[2])
  ) {
    throw new Error(
      'Usage: tsx scripts/local-native-test-postgres.ts one-shot --target <allowed-test-file>'
    );
  }
  return argv[2];
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function resolveNativeBinDir(): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error('The native PostgreSQL runner currently supports Windows only.');
  }
  for (const major of [18, 17, 16, 15]) {
    const candidate = path.join('C:\\Program Files\\PostgreSQL', String(major), 'bin');
    if (assessNativePostgresClusterCapability(candidate).usable) {
      return candidate;
    }
  }
  throw new Error(
    'No complete native PostgreSQL 15+ runtime was found under C:\\Program Files\\PostgreSQL.'
  );
}

export function runNativeLifecycleCommand(
  command: string,
  args: string[],
  options: RunNativeLifecycleCommandOptions
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    options.track?.(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const finish = (result: ExecResult | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.track?.(null);
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      const terminate = options.terminate || terminateProcessTree;
      void terminate(child)
        .then(() => {
          finish(new Error(`Lifecycle command timed out after ${options.timeoutMs ?? 120_000}ms.`));
        })
        .catch((error) => {
          finish(
            new Error(
              `Lifecycle command timed out and termination failed: ${sanitizeLogText(
                error instanceof Error ? error.message : String(error)
              )}`
            )
          );
        });
    }, options.timeoutMs ?? 120_000);
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      if (!timedOut) finish(error);
    });
    child.once('close', (code) => {
      if (!timedOut) finish({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

async function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: DB_HOST, port });
    const finish = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForDatabase(url: string): Promise<void> {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: url, ssl: false });
    try {
      await client.connect();
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Native PostgreSQL did not become ready: ${sanitizeLogText(String(lastError))}`);
}

async function assertOwnedOrAbsent(root: string, ownerFile: string, projectId: string): Promise<void> {
  if (!(await exists(root))) return;
  if (!(await exists(ownerFile))) {
    throw new Error(`Refusing to remove native test directory without ${OWNERSHIP_FILE}.`);
  }
  const owner = (await fs.readFile(ownerFile, 'utf8')).trim();
  if (owner !== projectId) {
    throw new Error('Refusing to remove native test directory owned by another checkout.');
  }
}

async function main(): Promise<number> {
  const target = parseTarget(process.argv.slice(2));
  const repoRoot = await fs.realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const identity = deriveCheckoutIdentity(repoRoot);
  const binDir = await resolveNativeBinDir();
  const postgresExe = path.join(binDir, 'postgres.exe');
  const initdbExe = path.join(binDir, 'initdb.exe');
  const pgCtlExe = path.join(binDir, 'pg_ctl.exe');
  const root = path.join(os.tmpdir(), NATIVE_ROOT_NAME, identity.projectName);
  const ownerFile = path.join(root, OWNERSHIP_FILE);
  const dataDir = path.join(root, DATA_DIR_NAME);
  const logFile = path.join(root, LOG_FILE_NAME);
  const passwordFile = path.join(root, PASSWORD_FILE_NAME);
  const cleanEnv = stripInheritedDatabaseAndProvenanceEnv(process.env);
  let started = false;
  let startAttempted = false;
  const lifecycleChild = createNativeLifecycleChildController();
  let cleanupPromise: Promise<void> | null = null;

  const cleanup = (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      await lifecycleChild.terminateActive();
      const postmasterPid = path.join(dataDir, 'postmaster.pid');
      if (started || (startAttempted && (await exists(postmasterPid)))) {
        const stopped = await runNativeLifecycleCommand(pgCtlExe, ['-D', dataDir, 'stop', '-m', 'fast'], {
          cwd: repoRoot,
          env: cleanEnv,
          timeoutMs: 30_000,
        });
        if (stopped.exitCode !== 0 && (await isPortListening(identity.hostPort))) {
          throw new Error(`Native PostgreSQL stop failed: ${sanitizeLogText(stopped.stderr)}`);
        }
        started = false;
      }
      const deadline = Date.now() + 5_000;
      while ((await isPortListening(identity.hostPort)) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (await isPortListening(identity.hostPort)) {
        throw new Error('Native PostgreSQL still owns the derived port after stop.');
      }
      await assertOwnedOrAbsent(root, ownerFile, identity.projectId);
      await fs.rm(root, { recursive: true, force: true });
    })();
    return cleanupPromise;
  };

  const onSignal = (signal: 'SIGINT' | 'SIGTERM') => {
    void cleanup()
      .catch((error) => process.stderr.write(`${sanitizeLogText(String(error))}\n`))
      .finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    await assertOwnedOrAbsent(root, ownerFile, identity.projectId);
    if (await isPortListening(identity.hostPort)) {
      throw new Error(`Derived port ${identity.hostPort} is already in use.`);
    }
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(ownerFile, `${identity.projectId}\n`, 'utf8');
    await fs.writeFile(passwordFile, DB_PASSWORD, { encoding: 'utf8', mode: 0o600 });

    const initialized = await runNativeLifecycleCommand(
      initdbExe,
      [
        `--pgdata=${dataDir}`,
        `--username=${DB_USER}`,
        '--encoding=UTF8',
        '--auth-local=trust',
        '--auth-host=scram-sha-256',
        `--pwfile=${passwordFile}`,
      ],
      {
        cwd: repoRoot,
        env: cleanEnv,
        timeoutMs: 120_000,
        track: lifecycleChild.track('initdb'),
      }
    );
    await fs.rm(passwordFile, { force: true });
    if (initialized.exitCode !== 0) {
      throw new Error(`initdb failed: ${sanitizeLogText(initialized.stderr)}`);
    }

    const version = await runNativeLifecycleCommand(postgresExe, ['--version'], {
      cwd: repoRoot,
      env: cleanEnv,
      track: lifecycleChild.track('version'),
    });
    const versionMatch = /PostgreSQL\)\s+(\d+)(?:\.\d+)?/u.exec(version.stdout);
    const major = Number.parseInt(versionMatch?.[1] || '', 10);
    if (!Number.isInteger(major) || major < 15) {
      throw new Error(`Unsupported native PostgreSQL version: ${sanitizeLogText(version.stdout)}`);
    }

    startAttempted = true;
    const startedResult = await runNativeLifecycleCommand(
      pgCtlExe,
      ['-D', dataDir, '-l', logFile, '-o', `-h ${DB_HOST} -p ${identity.hostPort}`, 'start'],
      {
        cwd: repoRoot,
        env: cleanEnv,
        inherit: true,
        timeoutMs: 30_000,
        track: lifecycleChild.track('startup'),
      }
    );
    if (startedResult.exitCode !== 0) {
      throw new Error(`Native PostgreSQL start failed: ${sanitizeLogText(startedResult.stderr)}`);
    }
    started = true;

    const adminUrl = `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${identity.hostPort}/postgres`;
    await waitForDatabase(adminUrl);
    const admin = new pg.Client({ connectionString: adminUrl, ssl: false });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
    await admin.end();

    const databaseUrl = formatLocalTestDatabaseUrl(identity.hostPort);
    const nonce = randomBytes(32).toString('hex');
    const marker = buildDatabaseComment(identity.projectId, nonce);
    const database = new pg.Client({ connectionString: databaseUrl, ssl: false });
    await database.connect();
    await database.query(`COMMENT ON DATABASE ${DB_NAME} IS ${quotePgLiteral(marker)}`);
    const server = await database.query<{
      server_version: string;
      address: string;
      port: number;
      database: string;
      username: string;
    }>(
      `SELECT current_setting('server_version') AS server_version,
              host(inet_server_addr()) AS address,
              inet_server_port() AS port,
              current_database() AS database,
              current_user AS username`
    );
    await database.end();
    const row = server.rows[0];
    if (
      row?.address !== DB_HOST ||
      row.port !== identity.hostPort ||
      row.database !== DB_NAME ||
      row.username !== DB_USER
    ) {
      throw new Error(
        `Native PostgreSQL identity or loopback binding did not match: ${JSON.stringify(row)}`
      );
    }
    process.stdout.write(
      `[LTDB-NATIVE-001] PostgreSQL ${row.server_version}; ${DB_HOST}:${identity.hostPort}; ${DB_NAME}; target=${target}\n`
    );

    const deps = createDefaultDependencies({ repoRoot });
    const childEnv = buildChildTestEnv({
      parentEnv: process.env,
      databaseUrl,
      marker,
      projectName: identity.projectName,
      hostPort: identity.hostPort,
    });
    const tested = await runNativeLifecycleCommand(
      process.execPath,
      [deps.resolveVitestEntrypoint(repoRoot), 'run', target, '--reporter=verbose'],
      {
        cwd: repoRoot,
        env: childEnv,
        inherit: true,
        timeoutMs: 30 * 60_000,
        track: lifecycleChild.track('test'),
      }
    );
    return tested.exitCode;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await fs.rm(passwordFile, { force: true }).catch(() => undefined);
    await cleanup();
    process.stdout.write('[LTDB-NATIVE-001] Native PostgreSQL stopped; owned data directory removed.\n');
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  void main()
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`${sanitizeLogText(error instanceof Error ? error.message : String(error))}\n`);
      process.exit(1);
    });
}
