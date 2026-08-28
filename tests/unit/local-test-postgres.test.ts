import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_PROVENANCE_ENV_KEYS,
  ALLOWED_STATE_KEYS,
  CLEANUP_FAILURE_EXIT_CODE,
  CLI_COMMANDS,
  COMPOSE_FILE_NAME,
  COMPOSE_UP_WAIT_TIMEOUT_SECONDS,
  DB_HOST,
  DB_NAME,
  DB_USER,
  DOCKER_OVERRIDE_ENV_KEYS,
  EXPECTED_POSTGRES_MAJOR,
  HOST_PORT_COUNT,
  HOST_PORT_MIN,
  INHERITED_DATABASE_URL_KEYS,
  PORT_ENV_NAME,
  PROJECT_NAME_HASH_LENGTH,
  PROJECT_NAME_PREFIX,
  PROVENANCE_ENV_KEYS,
  SENTINEL_EXIT_CODE,
  STABLE_IDS,
  STATE_VERSION,
  TARGET_TEST_FILE,
  URL_PROTOCOL,
  DatabaseUrlValidationError,
  LocalTestPostgresError,
  assertComposeArgvContract,
  assertEnvHasNoDatabaseUrl,
  assertLocalDockerEndpoint,
  buildChildTestEnv,
  buildComposeDownArgv,
  buildComposeUpArgv,
  buildDatabaseComment,
  buildDockerLifecycleEnv,
  buildDockerNetworkLsArgv,
  buildDockerPsArgv,
  buildDockerVolumeLsArgv,
  buildSentinelChildEnv,
  createLocalTestPostgresOrchestrator,
  deriveCheckoutIdentity,
  findFreshnessViolations,
  formatLocalTestDatabaseUrl,
  getLifecyclePaths,
  isInheritedDatabaseUrlKey,
  isLifecycleStateConsumed,
  mapSignalToExitCode,
  markLifecycleStateConsumed,
  parseCliCommand,
  parseCliInvocation,
  HGV_SAVE_TARGET_TEST_FILE,
  parseDockerResourceLines,
  parseLifecycleState,
  parseLockPid,
  postgresMajorFromVersionNum,
  resolveOneShotExitCode,
  resolveVerifyFailureCleanupExitCode,
  serializeLifecycleState,
  shouldReclaimStaleLock,
  stripInheritedDatabaseAndProvenanceEnv,
  validateLocalTestDatabaseUrl,
  type ExecCommandRequest,
  type ExecCommandResult,
  type LifecycleState,
  type LocalTestPostgresDependencies,
  type PostgresQueryResult,
  type UrlValidationFailureCode,
} from '../../scripts/local-test-postgres';

export const EXPECTED_LOCAL_TEST_DB_NPM_SCRIPTS = {
  'test:db:local:start': 'tsx scripts/local-test-postgres.ts start',
  'test:db:local:run': 'tsx scripts/local-test-postgres.ts run',
  'test:db:local:stop': 'tsx scripts/local-test-postgres.ts stop',
  'test:db:local': 'tsx scripts/local-test-postgres.ts one-shot',
  'test:db:local:verify-cleanup': 'tsx scripts/local-test-postgres.ts verify-failure-cleanup',
} as const;

/** Parent integration: after wiring package.json, this must hold. */
export const PACKAGE_JSON_NPM_SCRIPT_WIRING_ASSERTION =
  'expect(getUnwiredLocalTestDatabaseNpmScripts(packageJson.scripts)).toEqual([])';

export function getUnwiredLocalTestDatabaseNpmScripts(
  scripts: Record<string, unknown>,
): string[] {
  return Object.entries(EXPECTED_LOCAL_TEST_DB_NPM_SCRIPTS)
    .filter(([name, command]) => scripts[name] !== command)
    .map(([name]) => name);
}

const GUIDE_PATH = path.join(process.cwd(), 'docs/guides/LOCAL_DATABASE_TESTING.md');
const PACKAGE_PATH = path.join(process.cwd(), 'package.json');
const FAKE_EXEC = 'ltdb-fake-node';
const FIXED_PID = 4242;
const FIXED_NONCE = `${'ab'.repeat(32)}`;
const FIXED_NOW = new Date('2026-08-13T21:00:00.000Z');
const CHECKOUT_PATH = path.resolve('/ltdb-unit-checkout');
const TMP_DIR = path.resolve('/ltdb-unit-tmp');

const POISON_PARENT_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PATH: '/usr/bin',
  KEEP_ME: 'yes',
  TEST_DATABASE_URL: 'postgresql://inherited-test',
  POSTGRES_URL: 'postgresql://inherited-postgres',
  POSTGRES_PRISMA_URL: 'postgresql://inherited-prisma',
  POSTGRES_URL_NON_POOLING: 'postgresql://inherited-non-pooling',
  POSTGRES_URL_CUSTOM: 'postgresql://inherited-custom',
  DATABASE_URL: 'postgresql://inherited-database',
  DIRECT_URL: 'postgresql://inherited-direct',
  SUPABASE_DB_URL: 'postgresql://inherited-supabase',
  [PROVENANCE_ENV_KEYS.marker]: 'inherited-marker',
  [PROVENANCE_ENV_KEYS.project]: 'inherited-project',
  [PROVENANCE_ENV_KEYS.port]: '9',
  [PROVENANCE_ENV_KEYS.nonce]: 'inherited-nonce',
  DOCKER_HOST: 'tcp://203.0.113.10:2375',
  DOCKER_CONTEXT: 'remote-context',
};

function readGuide(): string {
  return readFileSync(GUIDE_PATH, 'utf8').replace(/\r\n/g, '\n');
}

function validState(overrides: Partial<LifecycleState> = {}): LifecycleState {
  const identity = deriveCheckoutIdentity(CHECKOUT_PATH);
  return {
    version: STATE_VERSION,
    projectId: identity.projectId,
    nonce: FIXED_NONCE,
    pid: FIXED_PID,
    startedAt: FIXED_NOW.toISOString(),
    consumedAt: null,
    ...overrides,
  };
}

function expectUrlFailure(
  candidate: string,
  port: number,
  code: UrlValidationFailureCode,
): void {
  try {
    validateLocalTestDatabaseUrl(candidate, port);
    expect.fail(`expected URL validation to fail with ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseUrlValidationError);
    expect((error as DatabaseUrlValidationError).code).toBe(code);
  }
}

function emptyExec(stdout = ''): ExecCommandResult {
  return { exitCode: 0, signal: null, stdout, stderr: '' };
}

function createFakeWorld(
  options: { childExitCode?: number; extraSchemas?: string[]; deferTestChild?: boolean } = {},
) {
  const identity = deriveCheckoutIdentity(CHECKOUT_PATH);
  const composeFileAbs = path.join(CHECKOUT_PATH, COMPOSE_FILE_NAME);
  const files = new Map<string, string>();
  const dirs = new Set<string>([CHECKOUT_PATH, TMP_DIR]);
  dirs.add(composeFileAbs);

  const world = {
    identity,
    composeFileAbs,
    childExitCode: options.childExitCode ?? 0,
    extraSchemas: options.extraSchemas ?? [],
    marker: null as string | null,
    composeDownArgvs: [] as string[][],
    dockerEnvs: [] as NodeJS.ProcessEnv[],
    childEnvs: [] as NodeJS.ProcessEnv[],
    sentinelEnvs: [] as NodeJS.ProcessEnv[],
    spawnCommands: [] as string[],
    deferredChildStarted: false,
  };

  const exists = (target: string) => files.has(target) || dirs.has(target);

  const rmPath = async (target: string, recursive?: boolean) => {
    files.delete(target);
    dirs.delete(target);
    if (!recursive) return;
    for (const key of [...files.keys()]) {
      if (key.startsWith(`${target}${path.sep}`)) files.delete(key);
    }
    for (const key of [...dirs]) {
      if (key.startsWith(`${target}${path.sep}`)) dirs.delete(key);
    }
  };

  const query = async <T extends object>(sql: string): Promise<PostgresQueryResult<T>> => {
    let rows: object[];
    if (sql.includes('COMMENT ON DATABASE')) {
      const match = /IS '([^']*)'/u.exec(sql);
      world.marker = match?.[1] ?? world.marker;
      rows = [];
    } else if (sql.includes('shobj_description')) {
      rows = [{ comment: world.marker }];
    } else if (sql.includes('server_version_num')) {
      rows = [{ server_version: '15.8', server_version_num: '150008' }];
    } else if (sql.includes('current_database()')) {
      rows = [{ current_database: DB_NAME, current_user: DB_USER }];
    } else if (sql.includes('pg_namespace')) {
      rows = world.extraSchemas.map((name) => ({ name }));
    } else if (sql.includes('pg_class') || sql.includes('pg_proc')) {
      rows = [];
    } else if (sql.includes('pg_extension')) {
      rows = [{ name: 'plpgsql' }];
    } else {
      throw new Error(`unhandled fake SQL: ${sql.slice(0, 80)}`);
    }
    return { rows: rows as T[] };
  };

  const spawnTracked = (request: ExecCommandRequest) => {
    world.spawnCommands.push(request.command);
    if (request.command !== 'docker' && request.command !== FAKE_EXEC) {
      throw new Error(`refusing to spawn ${request.command}`);
    }

    let result: ExecCommandResult = emptyExec();
    if (request.command === 'docker') {
      const args = [...request.args];
      world.dockerEnvs.push(request.env);
      if (args[0] === 'context' && args[1] === 'show') {
        result = emptyExec('desktop-linux\n');
      } else if (args[0] === 'context' && args[1] === 'inspect') {
        result = emptyExec('npipe:////./pipe/dockerDesktopLinuxEngine\n');
      } else if (args[0] === 'compose' && args.includes('down')) {
        world.composeDownArgvs.push(args);
        result = emptyExec();
      } else if (args[0] === 'compose' && args.includes('up')) {
        result = emptyExec();
      } else if (args[0] === 'ps' || args[0] === 'volume' || args[0] === 'network') {
        result = emptyExec();
      } else {
        throw new Error(`unhandled docker argv: ${args.join(' ')}`);
      }
    } else if (request.args.some((arg) => String(arg).includes('process.exit(23)'))) {
      world.sentinelEnvs.push(request.env);
      result = { exitCode: SENTINEL_EXIT_CODE, signal: null, stdout: '', stderr: '' };
    } else if (request.args.includes(TARGET_TEST_FILE)) {
      world.childEnvs.push(request.env);
      if (options.deferTestChild) {
        world.deferredChildStarted = true;
        let exitCode: number | null = null;
        let complete!: (result: ExecCommandResult) => void;
        const completed = new Promise<ExecCommandResult>((resolve) => {
          complete = resolve;
        });
        return {
          child: {
            pid: 99,
            kill: (signal: NodeJS.Signals = 'SIGTERM') => {
              if (exitCode === null) {
                exitCode = signal === 'SIGTERM' ? 143 : 1;
                complete({ exitCode, signal, stdout: '', stderr: '' });
              }
              return true;
            },
            get exitCode() {
              return exitCode;
            },
          },
          completed,
        };
      }
      result = { exitCode: world.childExitCode, signal: null, stdout: '', stderr: '' };
    } else {
      throw new Error(`unhandled child argv: ${request.args.join(' ')}`);
    }

    return {
      child: { pid: 99, kill: () => true, exitCode: result.exitCode },
      completed: Promise.resolve(result),
    };
  };

  const deps: LocalTestPostgresDependencies = {
    repoRoot: CHECKOUT_PATH,
    tmpDir: TMP_DIR,
    execPath: FAKE_EXEC,
    parentEnv: { ...POISON_PARENT_ENV },
    now: () => FIXED_NOW,
    randomNonce: () => FIXED_NONCE,
    currentPid: () => FIXED_PID,
    isProcessAlive: (pid) => pid === FIXED_PID,
    realpath: async (target) => target,
    pathExists: async (target) => exists(target),
    mkdir: async (target, options) => {
      if (!options?.recursive && exists(target)) {
        const error = new Error('EEXIST') as NodeJS.ErrnoException;
        error.code = 'EEXIST';
        throw error;
      }
      dirs.add(target);
    },
    rm: async (target, options) => {
      await rmPath(target, options?.recursive);
    },
    readFile: async (target) => {
      const contents = files.get(target);
      if (contents === undefined) {
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return contents;
    },
    writeFile: async (target, contents) => {
      files.set(target, contents);
    },
    rename: async (from, to) => {
      const contents = files.get(from);
      if (contents === undefined) {
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      files.delete(from);
      files.set(to, contents);
    },
    execCommand: async () => {
      throw new Error('execCommand must not be used; spawnTracked is the fake boundary');
    },
    spawnTracked,
    connectDatabase: async () => ({
      query,
      end: async () => undefined,
    }),
    resolveVitestEntrypoint: () => path.join(CHECKOUT_PATH, 'node_modules', 'vitest', 'vitest.mjs'),
    log: () => undefined,
    logError: () => undefined,
  };

  return { world, deps, files };
}

describe('local test postgres contracts', () => {
  describe('LTDB-SAFE-001 URL validation', () => {
    it('LTDB-SAFE-001: accepts the exact constructed loopback URL', () => {
      const { hostPort } = deriveCheckoutIdentity(CHECKOUT_PATH);
      const exact = formatLocalTestDatabaseUrl(hostPort);
      expect(validateLocalTestDatabaseUrl(exact, hostPort)).toBe(exact);
      expect(exact.startsWith(`${URL_PROTOCOL}//${DB_USER}:`)).toBe(true);
      expect(exact.includes(`@${DB_HOST}:${hostPort}/${DB_NAME}`)).toBe(true);
      expect(exact.includes('?')).toBe(false);
      expect(exact.includes('#')).toBe(false);
    });

    it('LTDB-SAFE-001: rejects wrong protocol, host, port, user, password, database, query, hash, malformed, and noncanonical values', () => {
      const { hostPort } = deriveCheckoutIdentity(CHECKOUT_PATH);
      const exact = formatLocalTestDatabaseUrl(hostPort);
      const withUser = (user: string) =>
        exact.replace(`${URL_PROTOCOL}//${DB_USER}:`, `${URL_PROTOCOL}//${user}:`);
      const withHost = (host: string) => exact.replace(`@${DB_HOST}:`, `@${host}:`);
      const withPort = (port: number) => exact.replace(`:${hostPort}/`, `:${port}/`);
      const withDatabase = (name: string) => exact.replace(new RegExp(`/${DB_NAME}$`, 'u'), `/${name}`);
      const withPassword = (password: string) =>
        exact.replace(new RegExp(`://${DB_USER}:[^@]+@`, 'u'), `://${DB_USER}:${password}@`);

      expectUrlFailure(exact.replace(`${URL_PROTOCOL}//`, 'postgres://'), hostPort, 'protocol');
      expectUrlFailure(exact.replace(`${URL_PROTOCOL}//`, 'http://'), hostPort, 'protocol');
      expectUrlFailure(withHost('localhost'), hostPort, 'host');
      expectUrlFailure(withHost('127.0.0.2'), hostPort, 'host');
      expectUrlFailure(withHost('8.8.8.8'), hostPort, 'host');
      expectUrlFailure(withHost('0.0.0.0'), hostPort, 'host');
      expectUrlFailure(withPort(hostPort + 1), hostPort, 'port');
      expectUrlFailure(withPort(5432), hostPort, 'port');
      expectUrlFailure(withUser('postgres'), hostPort, 'user');
      expectUrlFailure(withPassword('wrong-password'), hostPort, 'password');
      expectUrlFailure(withDatabase('postgres'), hostPort, 'database');
      expectUrlFailure(`${exact}?sslmode=disable`, hostPort, 'query');
      expectUrlFailure(`${exact}#frag`, hostPort, 'hash');
      expectUrlFailure('', hostPort, 'malformed');
      expectUrlFailure('not-a-url', hostPort, 'malformed');
      expectUrlFailure('%%%', hostPort, 'malformed');
      expectUrlFailure(`${exact}?`, hostPort, 'mismatch');
      expectUrlFailure(
        exact.replace(`${URL_PROTOCOL}//`, `${URL_PROTOCOL.toUpperCase()}//`),
        hostPort,
        'mismatch',
      );
    });
  });

  describe('LTDB-SAFE-001 env stripping and provenance', () => {
    it('LTDB-SAFE-001: strips inherited TEST_DATABASE_URL, POSTGRES_URL*, DATABASE_URL, provenance, DOCKER_HOST, and DOCKER_CONTEXT', () => {
      const stripped = stripInheritedDatabaseAndProvenanceEnv(POISON_PARENT_ENV);
      expect(stripped.KEEP_ME).toBe('yes');
      expect(stripped.PATH).toBe('/usr/bin');
      expect(stripped.TEST_DATABASE_URL).toBeUndefined();
      expect(stripped.DOCKER_HOST).toBeUndefined();
      expect(stripped.DOCKER_CONTEXT).toBeUndefined();
      for (const key of INHERITED_DATABASE_URL_KEYS) {
        expect(stripped[key]).toBeUndefined();
      }
      for (const key of ALL_PROVENANCE_ENV_KEYS) {
        expect(stripped[key]).toBeUndefined();
      }
      for (const key of DOCKER_OVERRIDE_ENV_KEYS) {
        expect(stripped[key]).toBeUndefined();
      }
      expect(isInheritedDatabaseUrlKey('POSTGRES_URL_CUSTOM')).toBe(true);
      expect(isInheritedDatabaseUrlKey('KEEP_ME')).toBe(false);
    });

    it('LTDB-SAFE-001: only the child test env receives the validated URL, marker, project, and port', () => {
      const identity = deriveCheckoutIdentity(CHECKOUT_PATH);
      const exact = formatLocalTestDatabaseUrl(identity.hostPort);
      const marker = buildDatabaseComment(identity.projectId, FIXED_NONCE);

      const child = buildChildTestEnv({
        parentEnv: POISON_PARENT_ENV,
        databaseUrl: exact,
        marker,
        projectName: identity.projectName,
        hostPort: identity.hostPort,
      });
      const docker = buildDockerLifecycleEnv(POISON_PARENT_ENV, identity.hostPort);
      const sentinel = buildSentinelChildEnv(POISON_PARENT_ENV);

      expect(child.TEST_DATABASE_URL).toBe(exact);
      expect(child[PROVENANCE_ENV_KEYS.marker]).toBe(marker);
      expect(child[PROVENANCE_ENV_KEYS.project]).toBe(identity.projectName);
      expect(child[PROVENANCE_ENV_KEYS.port]).toBe(String(identity.hostPort));
      expect(child[PROVENANCE_ENV_KEYS.nonce]).toBeUndefined();
      expect(child.KEEP_ME).toBe('yes');
      expect(child.DOCKER_HOST).toBeUndefined();

      expect(docker.TEST_DATABASE_URL).toBeUndefined();
      expect(docker[PORT_ENV_NAME]).toBe(String(identity.hostPort));
      expect(docker[PROVENANCE_ENV_KEYS.marker]).toBeUndefined();
      expect(docker.DOCKER_HOST).toBeUndefined();
      assertEnvHasNoDatabaseUrl(docker);

      expect(sentinel.TEST_DATABASE_URL).toBeUndefined();
      expect(sentinel[PROVENANCE_ENV_KEYS.marker]).toBeUndefined();
      expect(sentinel[PORT_ENV_NAME]).toBeUndefined();
      assertEnvHasNoDatabaseUrl(sentinel);
    });
  });

  describe('LTDB-SAFE-001 state, marker, freshness, and lock', () => {
    it('LTDB-SAFE-001: state serialization allowlists nonsecret keys and rejects credential, URL, and unsupported keys', () => {
      const serialized = serializeLifecycleState({
        ...validState(),
        password: 'secret',
        url: 'postgresql://example',
      } as LifecycleState);
      const parsed = JSON.parse(serialized) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual([...ALLOWED_STATE_KEYS].sort());
      expect(parsed).not.toHaveProperty('password');
      expect(parsed).not.toHaveProperty('url');

      const roundTrip = parseLifecycleState(serialized);
      expect(roundTrip.consumedAt).toBeNull();
      expect(isLifecycleStateConsumed(roundTrip)).toBe(false);
      expect(isLifecycleStateConsumed(markLifecycleStateConsumed(roundTrip, FIXED_NOW.toISOString()))).toBe(
        true,
      );

      const forbidden = [
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
      for (const key of forbidden) {
        expect(() => parseLifecycleState({ ...validState(), [key]: 'nope' })).toThrow(
          LocalTestPostgresError,
        );
      }
      expect(() => parseLifecycleState({ ...validState(), extra: true })).toThrow(LocalTestPostgresError);
      expect(() => parseLifecycleState('{')).toThrow(LocalTestPostgresError);
    });

    it('LTDB-SAFE-001: marker mismatch, freshness violations, and consumed state fail closed', () => {
      const identity = deriveCheckoutIdentity(CHECKOUT_PATH);
      const marker = buildDatabaseComment(identity.projectId, FIXED_NONCE);
      const otherNonce = `${'cd'.repeat(32)}`;
      expect(buildDatabaseComment(identity.projectId, otherNonce)).not.toBe(marker);

      expect(
        findFreshnessViolations({
          schemas: [],
          relations: [],
          functions: [],
          extensions: ['plpgsql'],
        }),
      ).toEqual([]);
      expect(
        findFreshnessViolations({
          schemas: ['extensions'],
          relations: [{ schema: 'public', name: 'jobs' }],
          functions: [{ schema: 'public', name: 'fn' }],
          extensions: ['plpgsql', 'vector'],
        }),
      ).toEqual([
        'unexpected schema extensions',
        'unexpected relation public.jobs',
        'unexpected function public.fn',
        'unexpected extension vector',
      ]);

      expect(isLifecycleStateConsumed(validState({ consumedAt: FIXED_NOW.toISOString() }))).toBe(true);
    });

    it('LTDB-SAFE-001: stale-lock decision reclaims only a dead positive PID', () => {
      expect(shouldReclaimStaleLock(88, false)).toBe(true);
      expect(shouldReclaimStaleLock(88, true)).toBe(false);
      expect(shouldReclaimStaleLock(null, false)).toBe(false);
      expect(shouldReclaimStaleLock(0, false)).toBe(false);
      expect(parseLockPid('88\n')).toBe(88);
      expect(parseLockPid('nope')).toBeNull();
    });

    it('LTDB-SAFE-001: checkout identity and port are deterministic and bounded', () => {
      const first = deriveCheckoutIdentity(CHECKOUT_PATH);
      const second = deriveCheckoutIdentity(CHECKOUT_PATH);
      expect(second).toEqual(first);
      expect(first.projectName).toBe(
        `${PROJECT_NAME_PREFIX}${first.projectId.slice(0, PROJECT_NAME_HASH_LENGTH)}`,
      );
      expect(first.hostPort).toBeGreaterThanOrEqual(HOST_PORT_MIN);
      expect(first.hostPort).toBeLessThan(HOST_PORT_MIN + HOST_PORT_COUNT);
      expect(first.hostPort).not.toBe(5432);
      expect(() => deriveCheckoutIdentity('relative/checkout')).toThrow(LocalTestPostgresError);
      expect(postgresMajorFromVersionNum('150008')).toBe(EXPECTED_POSTGRES_MAJOR);
    });
  });

  describe('LTDB-SAFE-001 Docker endpoint', () => {
    it('LTDB-SAFE-001: rejects non-local Docker endpoints and accepts npipe, unix, and loopback TCP', () => {
      expect(() => assertLocalDockerEndpoint('npipe:////./pipe/docker_engine')).not.toThrow();
      expect(() => assertLocalDockerEndpoint('unix:///var/run/docker.sock')).not.toThrow();
      expect(() => assertLocalDockerEndpoint('tcp://127.0.0.1:2375')).not.toThrow();
      expect(() => assertLocalDockerEndpoint('tcp://localhost:2375')).not.toThrow();
      expect(() => assertLocalDockerEndpoint('TCP://127.0.0.1:2376')).not.toThrow();
      expect(() => assertLocalDockerEndpoint('tcp://203.0.113.10:2375')).toThrow(LocalTestPostgresError);
      expect(() => assertLocalDockerEndpoint('tcp://192.168.1.10:2375')).toThrow(LocalTestPostgresError);
      expect(() => assertLocalDockerEndpoint('ssh://user@host')).toThrow(LocalTestPostgresError);
      expect(() => assertLocalDockerEndpoint('http://127.0.0.1:2375')).toThrow(LocalTestPostgresError);
    });
  });

  describe('lifecycle argv and exit contracts', () => {
    it('LTDB-CLEAN-001: Compose argv uses the exact absolute file and project, with down --volumes --remove-orphans and up --wait --wait-timeout', () => {
      const identity = deriveCheckoutIdentity(CHECKOUT_PATH);
      const composeFileAbs = path.join(CHECKOUT_PATH, COMPOSE_FILE_NAME);
      const down = buildComposeDownArgv(composeFileAbs, identity.projectName);
      const up = buildComposeUpArgv(composeFileAbs, identity.projectName);

      assertComposeArgvContract(down, composeFileAbs, identity.projectName);
      assertComposeArgvContract(up, composeFileAbs, identity.projectName);
      expect(down.slice(-3)).toEqual(['down', '--volumes', '--remove-orphans']);
      expect(up).toContain('up');
      expect(up).toContain('--wait');
      expect(up).toContain('--wait-timeout');
      expect(up[up.indexOf('--wait-timeout') + 1]).toBe(String(COMPOSE_UP_WAIT_TIMEOUT_SECONDS));
      expect(() => buildComposeDownArgv('docker-compose.test-db.yml', identity.projectName)).toThrow(
        LocalTestPostgresError,
      );

      expect(buildDockerPsArgv(identity.projectName)).toEqual([
        'ps',
        '-a',
        '--filter',
        `label=com.docker.compose.project=${identity.projectName}`,
        '--format',
        '{{.ID}}',
      ]);
      expect(buildDockerVolumeLsArgv(identity.projectName)).toEqual([
        'volume',
        'ls',
        '--filter',
        `label=com.docker.compose.project=${identity.projectName}`,
        '--format',
        '{{.Name}}',
      ]);
      expect(buildDockerNetworkLsArgv(identity.projectName)).toEqual([
        'network',
        'ls',
        '--filter',
        `label=com.docker.compose.project=${identity.projectName}`,
        '--format',
        '{{.ID}}',
      ]);
      expect(parseDockerResourceLines('abc\n\n def \n')).toEqual(['abc', 'def']);
    });

    it('LTDB-CLEAN-001: child exit takes precedence over cleanup failure unless the child succeeded', () => {
      expect(resolveOneShotExitCode(0, false)).toBe(0);
      expect(resolveOneShotExitCode(0, true)).toBe(CLEANUP_FAILURE_EXIT_CODE);
      expect(resolveOneShotExitCode(7, true)).toBe(7);
      expect(resolveOneShotExitCode(null, false)).toBe(1);
      expect(mapSignalToExitCode('SIGINT')).toBe(130);
      expect(mapSignalToExitCode('SIGTERM')).toBe(143);
      expect(mapSignalToExitCode('SIGKILL')).toBe(1);
    });

    it('LTDB-CLEAN-002: failure-sentinel proof passes only for exit 23 with successful cleanup and no remaining resources', () => {
      expect(
        resolveVerifyFailureCleanupExitCode({
          childExitCode: SENTINEL_EXIT_CODE,
          cleanupFailed: false,
          resourcesRemain: false,
        }),
      ).toBe(0);
      expect(
        resolveVerifyFailureCleanupExitCode({
          childExitCode: SENTINEL_EXIT_CODE,
          cleanupFailed: true,
          resourcesRemain: false,
        }),
      ).toBe(1);
      expect(
        resolveVerifyFailureCleanupExitCode({
          childExitCode: SENTINEL_EXIT_CODE,
          cleanupFailed: false,
          resourcesRemain: true,
        }),
      ).toBe(1);
      expect(
        resolveVerifyFailureCleanupExitCode({
          childExitCode: 1,
          cleanupFailed: false,
          resourcesRemain: false,
        }),
      ).toBe(1);
    });

    it('LTDB-SAFE-001: CLI command parser accepts the five commands and rejects extras', () => {
      expect([...CLI_COMMANDS]).toEqual([
        'start',
        'run',
        'stop',
        'one-shot',
        'verify-failure-cleanup',
      ]);
      for (const command of CLI_COMMANDS) {
        expect(parseCliCommand([command])).toBe(command);
      }
      expect(() => parseCliCommand(['unknown'])).toThrow(LocalTestPostgresError);
      expect(() => parseCliCommand(['start', '--extra'])).toThrow(LocalTestPostgresError);
      expect(parseCliInvocation(['one-shot', '--target', HGV_SAVE_TARGET_TEST_FILE])).toEqual({
        command: 'one-shot',
        targetFile: HGV_SAVE_TARGET_TEST_FILE,
      });
      expect(() => parseCliInvocation(['one-shot', '--target', 'tests/db/not-allowed.test.ts'])).toThrow(
        LocalTestPostgresError
      );
    });
  });

  describe('fake orchestrator cleanup (not Docker LTDB-CLEAN-001/002 proof)', () => {
    it('LTDB-CLEAN-001: fake orchestrator calls Compose down on a successful child without Docker', async () => {
      const { world, deps } = createFakeWorld({ childExitCode: 0 });
      const orchestrator = createLocalTestPostgresOrchestrator(deps);
      const exitCode = await orchestrator.oneShot();

      expect(exitCode).toBe(0);
      expect(world.spawnCommands.every((command) => command === 'docker' || command === FAKE_EXEC)).toBe(
        true,
      );
      expect(world.composeDownArgvs.length).toBeGreaterThanOrEqual(2);
      const lastDown = world.composeDownArgvs.at(-1) ?? [];
      assertComposeArgvContract(lastDown, world.composeFileAbs, world.identity.projectName);
      expect(lastDown.slice(-3)).toEqual(['down', '--volumes', '--remove-orphans']);

      expect(world.childEnvs).toHaveLength(1);
      expect(world.childEnvs[0]?.TEST_DATABASE_URL).toBe(
        formatLocalTestDatabaseUrl(world.identity.hostPort),
      );
      expect(world.childEnvs[0]?.[PROVENANCE_ENV_KEYS.project]).toBe(world.identity.projectName);
      expect(world.dockerEnvs.length).toBeGreaterThan(0);
      for (const env of world.dockerEnvs) {
        expect(env.TEST_DATABASE_URL).toBeUndefined();
        expect(env.DOCKER_HOST).toBeUndefined();
        expect(env[PORT_ENV_NAME]).toBe(String(world.identity.hostPort));
      }
    });

    it('LTDB-CLEAN-002: fake orchestrator still calls Compose down on a failing child and sentinel without Docker', async () => {
      const failing = createFakeWorld({ childExitCode: 7 });
      const failingExit = await createLocalTestPostgresOrchestrator(failing.deps).oneShot();
      expect(failingExit).toBe(7);
      expect(failing.world.composeDownArgvs.length).toBeGreaterThanOrEqual(2);

      const sentinel = createFakeWorld();
      const sentinelExit = await createLocalTestPostgresOrchestrator(sentinel.deps).verifyFailureCleanup();
      expect(sentinelExit).toBe(0);
      expect(sentinel.world.sentinelEnvs).toHaveLength(1);
      expect(sentinel.world.sentinelEnvs[0]?.TEST_DATABASE_URL).toBeUndefined();
      assertEnvHasNoDatabaseUrl(sentinel.world.sentinelEnvs[0] ?? {});
      expect(sentinel.world.composeDownArgvs.length).toBeGreaterThanOrEqual(2);
    });

    it('LTDB-CLEAN-001: signal during an active child shares one serialized final teardown', async () => {
      const deferred = createFakeWorld({ deferTestChild: true });
      const orchestrator = createLocalTestPostgresOrchestrator(deferred.deps);
      const oneShot = orchestrator.oneShot();

      for (let attempt = 0; attempt < 20 && !deferred.world.deferredChildStarted; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      expect(deferred.world.deferredChildStarted).toBe(true);

      const signalExit = await orchestrator.handleSignal('SIGINT');
      const oneShotExit = await oneShot;

      expect(signalExit).toBe(130);
      expect(oneShotExit).toBe(143);
      expect(deferred.world.composeDownArgvs).toHaveLength(2);
      expect(
        deferred.world.composeDownArgvs.filter((args) => args.includes('down')),
      ).toHaveLength(2);
    });

    it('LTDB-SAFE-001: fake orchestrator fail-closes on consumed state and marker/state mismatch', async () => {
      const consumed = createFakeWorld();
      const consumedOrch = createLocalTestPostgresOrchestrator(consumed.deps);
      expect(await consumedOrch.start()).toBe(0);
      expect(await consumedOrch.run()).toBe(0);
      await expect(consumedOrch.run()).rejects.toThrow(/already been used/u);

      const mismatched = createFakeWorld();
      const mismatchedOrch = createLocalTestPostgresOrchestrator(mismatched.deps);
      expect(await mismatchedOrch.start()).toBe(0);
      mismatched.world.marker = 'wrong-marker';
      await expect(mismatchedOrch.run()).rejects.toThrow(/marker does not match/u);

      const wrongState = createFakeWorld();
      const wrongStateOrch = createLocalTestPostgresOrchestrator(wrongState.deps);
      expect(await wrongStateOrch.start()).toBe(0);
      const paths = getLifecyclePaths(TMP_DIR, wrongState.world.identity.projectName);
      wrongState.files.set(
        paths.stateFile,
        serializeLifecycleState(validState({ projectId: 'ff'.repeat(32) })),
      );
      await expect(wrongStateOrch.run()).rejects.toThrow(/does not match this checkout/u);
    });
  });

  describe('LTDB-DOC-001', () => {
    it('LTDB-DOC-001: guide covers local-only use, tiers, commands, safety, cleanup, troubleshooting, and verification IDs', () => {
      const guide = readGuide();
      expect(guide.startsWith('# Local database testing\n')).toBe(true);
      expect(guide).toMatch(/Local-only warning/u);
      expect(guide).toContain('Docker Desktop');
      expect(guide).toContain('docker compose version');
      expect(guide).toContain('does **not** require the Supabase CLI');
      expect(guide).toContain('does **not** require a cloud Supabase project');
      expect(guide).toContain('PGlite isolated/runtime tests');
      expect(guide).toContain('Disposable plain PostgreSQL');
      expect(guide).toContain('advisory locks');
      expect(guide).toContain('fixture-mocked');
      expect(guide).toContain('Possible future full local Supabase stack');
      expect(guide).toContain('Auth, PostgREST, Realtime, and Storage');
      expect(guide).toContain('does **not** prove production-major parity or full-Supabase parity');
      expect(guide).toContain('patch-level drift');
      expect(guide).toContain('Prefer the one-shot command');
      expect(guide).toContain('exactly one `npm run test:db:local:run`');
      expect(guide).toContain('A second `run` without a fresh `start` fails closed');
      expect(guide).toContain(`Database name: \`${DB_NAME}\``);
      expect(guide).toContain(`User: \`${DB_USER}\``);
      expect(guide).toContain('exactly `127.0.0.1`');
      expect(guide).toContain('TEST_DATABASE_URL` is **child-only**');
      expect(guide).toContain('not sourced from `.env` / `.env.local` files');
      expect(guide).toContain('POSTGRES_URL');
      expect(guide).toContain('checkout-scoped');
      expect(guide).toContain('does not run production activation SQL');
      expect(guide).toContain('SIGINT');
      expect(guide).toContain('SIGTERM');
      expect(guide).toContain('SIGKILL');
      expect(guide).toContain('down --volumes --remove-orphans');
      expect(guide).toContain('Docker unavailable');
      expect(guide).toContain('Port conflict');
      expect(guide).toContain('Live lock');
      expect(guide).toContain('Stale lock');
      expect(guide).toContain('Dirty database');
      expect(guide).toContain('Consumed database');
      expect(guide).toContain('Health timeout');
      expect(guide).toContain('Cleanup failure');
      expect(guide).toContain('A skipped concurrency test is not a pass.');
      for (const id of [
        STABLE_IDS.BOOT,
        STABLE_IDS.SAFE,
        STABLE_IDS.CLEAN_SUCCESS,
        STABLE_IDS.CLEAN_FAILURE,
        'LTDB-CONC-001',
        'LTDB-RERUN-001',
        'LTDB-PGLITE-001',
        'LTDB-DOC-001',
      ]) {
        expect(guide).toContain(id);
      }
      for (const [name, command] of Object.entries(EXPECTED_LOCAL_TEST_DB_NPM_SCRIPTS)) {
        expect(guide).toContain(name);
        expect(guide).toContain(command);
      }
      expect(guide).not.toContain('postgresql://');
      expect(guide).not.toContain('postgres://');
      expect(guide).not.toContain('avsworklog_test_only');
    });

    it('LTDB-DOC-001: package.json wires every local database lifecycle command exactly', () => {
      const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')) as {
        name: string;
        scripts: Record<string, string>;
      };
      expect(packageJson.name).toBe('avsworklog');
      expect(packageJson.scripts).toBeTypeOf('object');

      const unwired = getUnwiredLocalTestDatabaseNpmScripts(packageJson.scripts);
      expect(unwired).toEqual([]);
      expect(PACKAGE_JSON_NPM_SCRIPT_WIRING_ASSERTION).toContain(
        'getUnwiredLocalTestDatabaseNpmScripts',
      );
    });
  });
});
