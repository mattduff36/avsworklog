import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';
import {
  getSafeDatabaseTargetIdentity,
  requireSafeMigrationConnectionString,
} from './finalise-migrations';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

export const DAILY_ALLOCATION_PROJECT_REF = 'lrhufzqfzeutgvudcowy';
export const DAILY_ALLOCATION_PROJECT_IDENTITY =
  `Supabase project ${DAILY_ALLOCATION_PROJECT_REF}`;
export const DAILY_ALLOCATION_V2_MIGRATION =
  'supabase/migrations/20260813_zzz_daily_allocation_v2_visit_model.sql';
export const DAILY_ALLOCATION_V2_GRANT_MIGRATION =
  'supabase/migrations/20260814155048_daily_allocation_v2_rpc_only_grants.sql';
export const DAILY_ALLOCATION_V2_ACTIVATION =
  'scripts/supabase/activate-daily-allocation-v2.sql';
export const DAILY_ALLOCATION_V2_DISABLE =
  'supabase/rollback/20260813_zzz_disable_daily_allocation_v2.sql';
export const DAILY_ALLOCATION_ROLLOUT_ARTIFACTS = [
  'scripts/manage-daily-allocation-v2-rollout.ts',
  DAILY_ALLOCATION_V2_ACTIVATION,
  DAILY_ALLOCATION_V2_DISABLE,
  DAILY_ALLOCATION_V2_GRANT_MIGRATION,
] as const;

export const REQUIRED_V2_RELATIONS = [
  'private.daily_allocation_v2_runtime',
  'public.daily_allocation_plan_days',
  'public.daily_allocation_visits',
  'public.daily_allocation_visit_labour',
  'public.daily_allocation_visit_plant',
  'public.daily_allocation_conflict_overrides',
  'private.daily_allocation_plant_day_jobs',
  'public.daily_allocation_published_visits',
  'public.daily_allocation_published_labour',
  'public.daily_allocation_published_plant',
  'public.daily_allocation_published_overrides',
  'public.daily_allocation_publication_notifications',
] as const;

export const REQUIRED_V2_PROCEDURES = [
  'public.get_daily_allocation_v2_runtime()',
  'public.convert_daily_allocation_plan_day_v2(date,text)',
  'public.upsert_daily_allocation_visit_v2(uuid,uuid,integer,integer,text,uuid,text,timestamptz,timestamptz,text,text,text)',
  'public.delete_daily_allocation_visit_v2(uuid,integer,integer)',
  'public.assign_daily_allocation_labour_v2(uuid,uuid,integer,text,text,text,uuid)',
  'public.unassign_daily_allocation_labour_v2(uuid,integer)',
  'public.assign_daily_allocation_plant_v2(uuid,integer,text,uuid,text,text,text,text)',
  'public.unassign_daily_allocation_plant_v2(uuid,integer)',
  'public.publish_daily_allocation_plan_v2(uuid,integer,text,boolean)',
  'public.move_daily_allocation_visit_v2(uuid,uuid,integer,integer,integer,timestamptz,timestamptz)',
  'public.create_daily_allocation_conflict_override_v2(uuid,integer,text,text,uuid,uuid)',
] as const;

const SMOKE_TIMEOUT_MS = 30_000;
const SMOKE_CANCEL_TIMEOUT_MS = 5_000;
const NONEXISTENT_VISIT_ID = '00000000-0000-4000-8000-000000000001';
const ROLLOUT_LOCK_KEY = 'daily-allocation-v2-rollout';

export type RolloutCommand = 'status' | 'preflight' | 'activate' | 'disable';

export interface RuntimeState {
  boardEnabled: boolean;
  writesEnabled: boolean;
  updatedAt: string;
}

export interface RolloutSnapshot {
  runtime: RuntimeState;
  permissionFingerprint: string;
  v1Fingerprint: string;
  v2ContentFingerprint: string;
  v2Counts: Record<string, number>;
}

export interface ActivationAdapter {
  captureSnapshot(): Promise<RolloutSnapshot>;
  executeActivation(): Promise<void>;
  executeDisable(): Promise<void>;
  runSmokeChecks(): Promise<void>;
  cancelSmoke(): Promise<void>;
  shouldAbort?(): boolean;
}

interface RuntimeRow {
  board_enabled: boolean;
  writes_enabled: boolean;
  updated_at: Date | string;
}

interface FingerprintRow {
  permission_fingerprint: string;
  v1_fingerprint: string;
  v2_content_fingerprint: string;
  v2_counts: Record<string, number> | string;
}

interface PrincipalRow {
  id: string;
  access_level: number;
}

interface LedgerRow {
  checksum_sha256: string;
  phase: string;
}

interface LockRow {
  acquired: boolean;
}

interface BackendPidRow {
  backend_pid: number;
}

interface ProcedureContractRow {
  exists: boolean;
  security_definer: boolean;
  authenticated_execute: boolean;
  service_role_execute: boolean;
  anon_execute: boolean;
}

interface RelationContractRow {
  exists: boolean;
  table_kind: string | null;
  rls_enabled: boolean;
  authenticated_select: boolean;
  authenticated_insert: boolean;
  authenticated_update: boolean;
  authenticated_delete: boolean;
  authenticated_truncate: boolean;
  authenticated_references: boolean;
  authenticated_trigger: boolean;
  authenticated_column_select: boolean;
  authenticated_column_insert: boolean;
  authenticated_column_update: boolean;
  authenticated_column_references: boolean;
  anon_select: boolean;
  anon_insert: boolean;
  anon_update: boolean;
  anon_delete: boolean;
  anon_truncate: boolean;
  anon_references: boolean;
  anon_trigger: boolean;
  anon_column_select: boolean;
  anon_column_insert: boolean;
  anon_column_update: boolean;
  anon_column_references: boolean;
}

interface ExistsRow {
  exists: boolean;
}

type DatabaseClient = InstanceType<typeof Client>;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function readRepositorySql(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

export function requireDailyAllocationProductionTarget(
  connectionString: string | null | undefined
): string {
  const safeConnection = requireSafeMigrationConnectionString(connectionString);
  const url = new URL(safeConnection);
  const hostname = url.hostname.toLowerCase();
  const username = decodeURIComponent(url.username).toLowerCase();
  const port = Number.parseInt(url.port, 10) || 5432;
  if (port !== 5432) {
    throw new Error(
      'Daily Allocation rollout requires a direct/session PostgreSQL connection on port 5432.'
    );
  }
  const directTarget =
    hostname === `db.${DAILY_ALLOCATION_PROJECT_REF}.supabase.co`
    && username === 'postgres';
  const sessionPoolerTarget =
    hostname.endsWith('.pooler.supabase.com')
    && username === `postgres.${DAILY_ALLOCATION_PROJECT_REF}`;
  if (
    getSafeDatabaseTargetIdentity(safeConnection) !== DAILY_ALLOCATION_PROJECT_IDENTITY
    || (!directTarget && !sessionPoolerTarget)
  ) {
    throw new Error(
      `Daily Allocation rollout refused: expected ${DAILY_ALLOCATION_PROJECT_IDENTITY}.`
    );
  }
  return safeConnection;
}

export function requireExpectedCommit(expectedCommit: string | undefined): string {
  if (!expectedCommit || !/^[0-9a-f]{40}$/u.test(expectedCommit)) {
    throw new Error('Activation requires --expected-commit with the exact 40-character deployed SHA.');
  }
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error('Unable to resolve the current Git commit.');
  }
  const currentCommit = result.stdout.trim();
  if (currentCommit !== expectedCommit) {
    throw new Error(
      `Activation refused: current commit ${currentCommit} does not match expected deployed commit.`
    );
  }
  const tracked = spawnSync(
    'git',
    ['ls-tree', '-r', '--name-only', expectedCommit, '--', ...DAILY_ALLOCATION_ROLLOUT_ARTIFACTS],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: false,
    }
  );
  const trackedPaths = new Set(
    tracked.stdout.split(/\r?\n/u).filter((path) => path.length > 0)
  );
  if (
    tracked.status !== 0
    || DAILY_ALLOCATION_ROLLOUT_ARTIFACTS.some((path) => !trackedPaths.has(path))
  ) {
    throw new Error('Activation refused: rollout artifacts are not present in the expected commit.');
  }
  const diff = spawnSync(
    'git',
    ['diff', '--quiet', expectedCommit, '--', ...DAILY_ALLOCATION_ROLLOUT_ARTIFACTS],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: false,
    }
  );
  if (diff.status !== 0) {
    throw new Error(
      'Activation refused: local rollout artifacts do not exactly match the expected commit.'
    );
  }
  return currentCommit;
}

export function snapshotsPreserveProtectedState(
  before: RolloutSnapshot,
  after: RolloutSnapshot
): boolean {
  return before.permissionFingerprint === after.permissionFingerprint
    && before.v1Fingerprint === after.v1Fingerprint
    && before.v2ContentFingerprint === after.v2ContentFingerprint;
}

function assertProtectedStatePreserved(
  before: RolloutSnapshot,
  after: RolloutSnapshot,
  operation: string
): void {
  if (!snapshotsPreserveProtectedState(before, after)) {
    throw new Error(
      `Daily Allocation ${operation} changed permissions or protected v1/v2 content.`
    );
  }
}

function assertRuntimeState(
  state: RuntimeState,
  expected: { boardEnabled: boolean; writesEnabled: boolean },
  operation: string
): void {
  if (
    state.boardEnabled !== expected.boardEnabled
    || state.writesEnabled !== expected.writesEnabled
  ) {
    throw new Error(
      `Daily Allocation ${operation} runtime state is ${state.boardEnabled}/${state.writesEnabled}, expected ${expected.boardEnabled}/${expected.writesEnabled}.`
    );
  }
}

export async function activateWithAutomaticDisable(
  adapter: ActivationAdapter,
  smokeTimeoutMs = SMOKE_TIMEOUT_MS
): Promise<RolloutSnapshot> {
  const before = await adapter.captureSnapshot();
  assertRuntimeState(
    before.runtime,
    { boardEnabled: false, writesEnabled: false },
    'pre-activation'
  );

  try {
    if (adapter.shouldAbort?.()) {
      throw new Error('Daily Allocation activation was interrupted before runtime enable.');
    }
    await adapter.executeActivation();
    if (adapter.shouldAbort?.()) {
      throw new Error('Daily Allocation activation was interrupted after runtime enable.');
    }
    await withTimeout(
      adapter.runSmokeChecks(),
      smokeTimeoutMs,
      adapter.cancelSmoke
    );
    if (adapter.shouldAbort?.()) {
      throw new Error('Daily Allocation activation was interrupted after smoke.');
    }
    const after = await adapter.captureSnapshot();
    assertRuntimeState(
      after.runtime,
      { boardEnabled: true, writesEnabled: true },
      'post-activation'
    );
    assertProtectedStatePreserved(before, after, 'activation');
    if (adapter.shouldAbort?.()) {
      throw new Error('Daily Allocation activation was interrupted before completion.');
    }
    return after;
  } catch (activationError) {
    let disableError: unknown;
    try {
      await adapter.executeDisable();
      const disabled = await adapter.captureSnapshot();
      assertRuntimeState(
        disabled.runtime,
        { boardEnabled: false, writesEnabled: false },
        'automatic disable'
      );
      assertProtectedStatePreserved(before, disabled, 'automatic disable');
    } catch (error) {
      disableError = error;
    }
    const activationMessage = activationError instanceof Error
      ? activationError.message
      : String(activationError);
    if (disableError) {
      const disableMessage = disableError instanceof Error
        ? disableError.message
        : String(disableError);
      throw new Error(
        `Daily Allocation activation failed (${activationMessage}); automatic disable also failed (${disableMessage}).`
      );
    }
    throw new Error(
      `Daily Allocation activation failed and was automatically disabled: ${activationMessage}`
    );
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  cancelOperation: () => Promise<void>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            timedOut = true;
            reject(new Error('Daily Allocation post-activation smoke timed out.'));
          },
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (timedOut) {
      await cancelOperation();
    }
  }
}

async function settlesWithin(operation: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.then(
        () => true,
        () => true
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function destroyClientConnection(client: DatabaseClient): void {
  const connection = client as unknown as {
    connection?: { stream?: { destroy(error?: Error): void } };
  };
  connection.connection?.stream?.destroy(
    new Error('Daily Allocation smoke connection forcibly closed.')
  );
}

async function endClientBounded(client: DatabaseClient): Promise<void> {
  const endPromise = client.end();
  if (!await settlesWithin(endPromise, SMOKE_CANCEL_TIMEOUT_MS)) {
    destroyClientConnection(client);
  }
}

async function createClient(connectionString: string): Promise<DatabaseClient> {
  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
    query_timeout: 20_000,
  });
  await client.connect();
  await client.query("SET statement_timeout = '15s'");
  await client.query("SET lock_timeout = '5s'");
  return client;
}

export async function acquireRolloutLock(client: DatabaseClient): Promise<void> {
  const result = await client.query<LockRow>(
    "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
    [ROLLOUT_LOCK_KEY]
  );
  if (!result.rows[0]?.acquired) {
    throw new Error('Another Daily Allocation v2 rollout operation is already running.');
  }
}

export async function releaseRolloutLock(client: DatabaseClient): Promise<void> {
  await client.query(
    "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
    [ROLLOUT_LOCK_KEY]
  );
}

async function loadRuntimeState(client: DatabaseClient): Promise<RuntimeState> {
  const result = await client.query<RuntimeRow>(`
    SELECT board_enabled, writes_enabled, updated_at
    FROM private.daily_allocation_v2_runtime
    WHERE singleton = TRUE
  `);
  if (result.rowCount !== 1) {
    throw new Error('Daily Allocation rollout expected exactly one runtime singleton.');
  }
  const row = result.rows[0];
  return {
    boardEnabled: row.board_enabled,
    writesEnabled: row.writes_enabled,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function captureSnapshot(client: DatabaseClient): Promise<RolloutSnapshot> {
  const runtime = await loadRuntimeState(client);
  const result = await client.query<FingerprintRow>(`
    SELECT
      md5(
        jsonb_build_object(
          'module', COALESCE((
            SELECT jsonb_agg(to_jsonb(module_row) ORDER BY module_row.module_name)
            FROM public.permission_modules module_row
            WHERE module_row.module_name = 'daily-allocation'
          ), '[]'::jsonb),
          'teams', COALESCE((
            SELECT jsonb_agg(to_jsonb(team_row) ORDER BY team_row.team_id)
            FROM public.team_module_permissions team_row
            WHERE team_row.module_name = 'daily-allocation'
          ), '[]'::jsonb),
          'users', COALESCE((
            SELECT jsonb_agg(to_jsonb(user_row) ORDER BY user_row.user_id)
            FROM public.user_module_permissions user_row
            WHERE user_row.module_name = 'daily-allocation'
          ), '[]'::jsonb),
          'roles', COALESCE((
            SELECT jsonb_agg(to_jsonb(role_row) ORDER BY role_row.role_id)
            FROM public.role_permissions role_row
            WHERE role_row.module_name = 'daily-allocation'
          ), '[]'::jsonb)
        )::text
      ) AS permission_fingerprint,
      md5(
        jsonb_build_object(
          'labour_drafts', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM public.daily_labour_allocation_drafts row_data
          ), '[]'::jsonb),
          'plant_drafts', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM public.daily_plant_allocation_drafts row_data
          ), '[]'::jsonb),
          'publications', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM public.daily_allocation_publications row_data
          ), '[]'::jsonb),
          'labour_items', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM public.daily_allocation_labour_items row_data
          ), '[]'::jsonb),
          'plant_items', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM public.daily_allocation_plant_items row_data
          ), '[]'::jsonb)
        )::text
      ) AS v1_fingerprint,
      md5(
        jsonb_build_object(
          'plan_days', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM public.daily_allocation_plan_days row_data
          ), '[]'::jsonb),
          'visits', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM public.daily_allocation_visits row_data
          ), '[]'::jsonb),
          'visit_labour', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM public.daily_allocation_visit_labour row_data
          ), '[]'::jsonb),
          'visit_plant', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM public.daily_allocation_visit_plant row_data
          ), '[]'::jsonb),
          'overrides', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM public.daily_allocation_conflict_overrides row_data
          ), '[]'::jsonb),
          'plant_day_jobs', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM private.daily_allocation_plant_day_jobs row_data
          ), '[]'::jsonb),
          'published_visits', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM public.daily_allocation_published_visits row_data
          ), '[]'::jsonb),
          'published_labour', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM public.daily_allocation_published_labour row_data
          ), '[]'::jsonb),
          'published_plant', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM public.daily_allocation_published_plant row_data
          ), '[]'::jsonb),
          'published_overrides', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM public.daily_allocation_published_overrides row_data
          ), '[]'::jsonb),
          'publication_notifications', COALESCE((
            SELECT jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id)
            FROM public.daily_allocation_publication_notifications row_data
          ), '[]'::jsonb),
          'linked_messages', COALESCE((
            SELECT jsonb_agg(to_jsonb(messages) ORDER BY messages.id)
            FROM public.messages
            WHERE messages.daily_allocation_labour_item_id IS NOT NULL
              OR messages.daily_allocation_publication_id IS NOT NULL
              OR EXISTS (
                SELECT 1
                FROM public.daily_allocation_publication_notifications notifications
                WHERE notifications.message_id = messages.id
              )
          ), '[]'::jsonb),
          'linked_recipients', COALESCE((
            SELECT jsonb_agg(to_jsonb(recipients) ORDER BY recipients.id)
            FROM public.message_recipients recipients
            WHERE EXISTS (
              SELECT 1
              FROM public.messages
              WHERE messages.id = recipients.message_id
                AND (
                  messages.daily_allocation_labour_item_id IS NOT NULL
                  OR messages.daily_allocation_publication_id IS NOT NULL
                  OR EXISTS (
                    SELECT 1
                    FROM public.daily_allocation_publication_notifications notifications
                    WHERE notifications.message_id = messages.id
                  )
                )
            )
          ), '[]'::jsonb)
        )::text
      ) AS v2_content_fingerprint,
      jsonb_build_object(
        'plan_days', (SELECT COUNT(*) FROM public.daily_allocation_plan_days),
        'visits', (SELECT COUNT(*) FROM public.daily_allocation_visits),
        'visit_labour', (SELECT COUNT(*) FROM public.daily_allocation_visit_labour),
        'visit_plant', (SELECT COUNT(*) FROM public.daily_allocation_visit_plant),
        'overrides', (SELECT COUNT(*) FROM public.daily_allocation_conflict_overrides),
        'plant_day_jobs', (SELECT COUNT(*) FROM private.daily_allocation_plant_day_jobs),
        'published_visits', (SELECT COUNT(*) FROM public.daily_allocation_published_visits),
        'published_labour', (SELECT COUNT(*) FROM public.daily_allocation_published_labour),
        'published_plant', (SELECT COUNT(*) FROM public.daily_allocation_published_plant),
        'published_overrides', (SELECT COUNT(*) FROM public.daily_allocation_published_overrides),
        'publication_notifications', (SELECT COUNT(*) FROM public.daily_allocation_publication_notifications)
      ) AS v2_counts
  `);
  const row = result.rows[0];
  const v2Counts = typeof row.v2_counts === 'string'
    ? JSON.parse(row.v2_counts) as Record<string, number>
    : row.v2_counts;
  return {
    runtime,
    permissionFingerprint: row.permission_fingerprint,
    v1Fingerprint: row.v1_fingerprint,
    v2ContentFingerprint: row.v2_content_fingerprint,
    v2Counts,
  };
}

async function verifyMigrationLedger(client: DatabaseClient): Promise<void> {
  for (const migrationPath of [
    DAILY_ALLOCATION_V2_MIGRATION,
    DAILY_ALLOCATION_V2_GRANT_MIGRATION,
  ]) {
    const migrationSql = readRepositorySql(migrationPath);
    const expectedChecksum = sha256(migrationSql);
    const result = await client.query<LedgerRow>(`
      SELECT checksum_sha256, phase
      FROM private.finalise_migration_ledger
      WHERE filename = $1
    `, [migrationPath]);
    if (
      result.rowCount !== 1
      || result.rows[0].checksum_sha256 !== expectedChecksum
      || result.rows[0].phase !== 'predeploy'
    ) {
      throw new Error(
        `Daily Allocation migration ledger/checksum verification failed: ${migrationPath}`
      );
    }
  }
}

async function verifyObjectAndGrantContract(client: DatabaseClient): Promise<void> {
  for (const relation of REQUIRED_V2_RELATIONS) {
    const result = await client.query<RelationContractRow>(`
      SELECT
        to_regclass($1) IS NOT NULL AS exists,
        (
          SELECT relkind::text
          FROM pg_class
          WHERE oid = to_regclass($1)
        ) AS table_kind,
        COALESCE((
          SELECT relrowsecurity
          FROM pg_class
          WHERE oid = to_regclass($1)
        ), FALSE) AS rls_enabled,
        COALESCE(has_table_privilege('authenticated', to_regclass($1), 'SELECT'), FALSE)
          AS authenticated_select,
        COALESCE(has_table_privilege('authenticated', to_regclass($1), 'INSERT'), FALSE)
          AS authenticated_insert,
        COALESCE(has_table_privilege('authenticated', to_regclass($1), 'UPDATE'), FALSE)
          AS authenticated_update,
        COALESCE(has_table_privilege('authenticated', to_regclass($1), 'DELETE'), FALSE)
          AS authenticated_delete,
        COALESCE(has_table_privilege('authenticated', to_regclass($1), 'TRUNCATE'), FALSE)
          AS authenticated_truncate,
        COALESCE(has_table_privilege('authenticated', to_regclass($1), 'REFERENCES'), FALSE)
          AS authenticated_references,
        COALESCE(has_table_privilege('authenticated', to_regclass($1), 'TRIGGER'), FALSE)
          AS authenticated_trigger,
        COALESCE(has_any_column_privilege('authenticated', to_regclass($1), 'SELECT'), FALSE)
          AS authenticated_column_select,
        COALESCE(has_any_column_privilege('authenticated', to_regclass($1), 'INSERT'), FALSE)
          AS authenticated_column_insert,
        COALESCE(has_any_column_privilege('authenticated', to_regclass($1), 'UPDATE'), FALSE)
          AS authenticated_column_update,
        COALESCE(has_any_column_privilege('authenticated', to_regclass($1), 'REFERENCES'), FALSE)
          AS authenticated_column_references,
        COALESCE(has_table_privilege('anon', to_regclass($1), 'SELECT'), FALSE)
          AS anon_select,
        COALESCE(has_table_privilege('anon', to_regclass($1), 'INSERT'), FALSE)
          AS anon_insert,
        COALESCE(has_table_privilege('anon', to_regclass($1), 'UPDATE'), FALSE)
          AS anon_update,
        COALESCE(has_table_privilege('anon', to_regclass($1), 'DELETE'), FALSE)
          AS anon_delete,
        COALESCE(has_table_privilege('anon', to_regclass($1), 'TRUNCATE'), FALSE)
          AS anon_truncate,
        COALESCE(has_table_privilege('anon', to_regclass($1), 'REFERENCES'), FALSE)
          AS anon_references,
        COALESCE(has_table_privilege('anon', to_regclass($1), 'TRIGGER'), FALSE)
          AS anon_trigger,
        COALESCE(has_any_column_privilege('anon', to_regclass($1), 'SELECT'), FALSE)
          AS anon_column_select,
        COALESCE(has_any_column_privilege('anon', to_regclass($1), 'INSERT'), FALSE)
          AS anon_column_insert,
        COALESCE(has_any_column_privilege('anon', to_regclass($1), 'UPDATE'), FALSE)
          AS anon_column_update
        ,
        COALESCE(has_any_column_privilege('anon', to_regclass($1), 'REFERENCES'), FALSE)
          AS anon_column_references
    `, [relation]);
    const row = result.rows[0];
    const publicRelation = relation.startsWith('public.');
    const unsafeDml = row?.authenticated_insert
      || row?.authenticated_update
      || row?.authenticated_delete
      || row?.authenticated_truncate
      || row?.authenticated_references
      || row?.authenticated_trigger
      || row?.authenticated_column_insert
      || row?.authenticated_column_update
      || row?.authenticated_column_references;
    const unsafeAnon = row?.anon_select
      || row?.anon_insert
      || row?.anon_update
      || row?.anon_delete
      || row?.anon_truncate
      || row?.anon_references
      || row?.anon_trigger
      || row?.anon_column_select
      || row?.anon_column_insert
      || row?.anon_column_update
      || row?.anon_column_references;
    if (
      !row?.exists
      || !['r', 'p'].includes(row.table_kind || '')
      || unsafeDml
      || unsafeAnon
      || (publicRelation && (!row.rls_enabled || !row.authenticated_select))
      || (!publicRelation && (row.authenticated_select || row.authenticated_column_select))
    ) {
      throw new Error(`Daily Allocation v2 relation/ACL contract failed: ${relation}`);
    }
  }

  for (const signature of REQUIRED_V2_PROCEDURES) {
    const result = await client.query<ProcedureContractRow>(`
      SELECT
        to_regprocedure($1) IS NOT NULL AS exists,
        COALESCE((
          SELECT prosecdef
          FROM pg_proc
          WHERE oid = to_regprocedure($1)
        ), FALSE) AS security_definer,
        COALESCE(has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE'), FALSE)
          AS authenticated_execute,
        COALESCE(has_function_privilege('service_role', to_regprocedure($1), 'EXECUTE'), FALSE)
          AS service_role_execute,
        COALESCE(has_function_privilege('anon', to_regprocedure($1), 'EXECUTE'), FALSE)
          AS anon_execute
    `, [signature]);
    const row = result.rows[0];
    if (
      !row?.exists
      || !row.security_definer
      || !row.authenticated_execute
      || !row.service_role_execute
      || row.anon_execute
    ) {
      throw new Error(`Daily Allocation v2 procedure contract failed: ${signature}`);
    }
  }

  const writerGuard = await client.query<ExistsRow>(
    "SELECT to_regprocedure('private.require_daily_allocation_v2_writer()') IS NOT NULL AS exists"
  );
  if (!writerGuard.rows[0]?.exists) {
    throw new Error('Daily Allocation v2 writer guard is missing.');
  }

}

async function executeSqlArtifact(client: DatabaseClient, path: string): Promise<void> {
  try {
    await client.query(readRepositorySql(path));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function findSmokePrincipals(client: DatabaseClient): Promise<{
  managerId: string;
  deniedId: string;
}> {
  const result = await client.query<PrincipalRow>(`
    SELECT
      profiles.id::text,
      public.user_module_access_level(
        profiles.id,
        profiles.role_id,
        profiles.team_id,
        'daily-allocation'
      ) AS access_level
    FROM public.profiles profiles
    INNER JOIN auth.users users ON users.id = profiles.id
    WHERE profiles.is_placeholder = FALSE
    ORDER BY access_level DESC, profiles.id
  `);
  const managerId = result.rows.find((row) => row.access_level >= 4)?.id;
  const deniedId = result.rows.find((row) => row.access_level === 0)?.id;
  if (!managerId || !deniedId) {
    throw new Error('Daily Allocation smoke principals for Level 4+ and Level 0 were not found.');
  }
  return { managerId, deniedId };
}

async function withAuthenticatedRole<T>(
  client: DatabaseClient,
  userId: string,
  operation: () => Promise<T>
): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(
      "SELECT set_config('request.jwt.claim.sub', $1, TRUE)",
      [userId]
    );
    const result = await operation();
    await client.query('ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function runSmokeChecks(client: DatabaseClient): Promise<void> {
  const { managerId, deniedId } = await findSmokePrincipals(client);
  await withAuthenticatedRole(client, managerId, async () => {
    const runtime = await client.query<RuntimeRow>(
      'SELECT board_enabled, writes_enabled, NOW() AS updated_at FROM public.get_daily_allocation_v2_runtime()'
    );
    if (
      runtime.rowCount !== 1
      || !runtime.rows[0].board_enabled
      || !runtime.rows[0].writes_enabled
    ) {
      throw new Error('Authorized runtime smoke did not return true/true.');
    }
    await client.query('SELECT COUNT(*) FROM public.daily_allocation_plan_days');
    await client.query('SELECT COUNT(*) FROM public.daily_allocation_visits');
  });

  let deniedMessage = '';
  try {
    await withAuthenticatedRole(client, deniedId, async () => {
      await client.query('SELECT * FROM public.get_daily_allocation_v2_runtime()');
    });
  } catch (error) {
    deniedMessage = error instanceof Error ? error.message : String(error);
  }
  if (!/Daily allocation access required/iu.test(deniedMessage)) {
    throw new Error('Level-0 runtime smoke was not denied by the permission boundary.');
  }

  let mutationMessage = '';
  try {
    await withAuthenticatedRole(client, managerId, async () => {
      await client.query(
        'SELECT public.delete_daily_allocation_visit_v2($1::uuid, 1, 1)',
        [NONEXISTENT_VISIT_ID]
      );
    });
  } catch (error) {
    mutationMessage = error instanceof Error ? error.message : String(error);
  }
  if (!/Visit not found/iu.test(mutationMessage) || /V2_DISABLED/iu.test(mutationMessage)) {
    throw new Error('Non-mutating writer smoke did not reach the enabled RPC path.');
  }
}

function createSmokeController(
  connectionString: string,
  controlClient: DatabaseClient
): {
  run(): Promise<void>;
  cancel(): Promise<void>;
} {
  let smokeClient: DatabaseClient | null = null;
  let smokePromise: Promise<void> | null = null;
  let backendPid: number | null = null;

  return {
    async run(): Promise<void> {
      if (smokePromise) {
        throw new Error('Daily Allocation smoke is already running.');
      }
      smokeClient = await createClient(connectionString);
      const pidResult = await smokeClient.query<BackendPidRow>(
        'SELECT pg_backend_pid() AS backend_pid'
      );
      backendPid = pidResult.rows[0]?.backend_pid ?? null;
      smokePromise = runSmokeChecks(smokeClient);
      try {
        await smokePromise;
      } finally {
        await endClientBounded(smokeClient).catch(() => undefined);
        smokeClient = null;
        smokePromise = null;
        backendPid = null;
      }
    },
    async cancel(): Promise<void> {
      if (backendPid) {
        const cancelQuery = controlClient.query(
          'SELECT pg_cancel_backend($1)',
          [backendPid]
        ).catch(() => undefined);
        await settlesWithin(cancelQuery, SMOKE_CANCEL_TIMEOUT_MS);
      }
      const activeSmoke = smokePromise?.catch(() => undefined);
      if (activeSmoke && !await settlesWithin(activeSmoke, SMOKE_CANCEL_TIMEOUT_MS)) {
        if (smokeClient) destroyClientConnection(smokeClient);
        await settlesWithin(activeSmoke, SMOKE_CANCEL_TIMEOUT_MS);
      }
      if (smokeClient) {
        await endClientBounded(smokeClient).catch(() => undefined);
        smokeClient = null;
      }
      smokePromise = null;
      backendPid = null;
    },
  };
}

async function runPreflight(
  client: DatabaseClient,
  rehearseDisable: boolean
): Promise<RolloutSnapshot> {
  await verifyMigrationLedger(client);
  await verifyObjectAndGrantContract(client);
  const before = await captureSnapshot(client);
  assertRuntimeState(
    before.runtime,
    { boardEnabled: false, writesEnabled: false },
    'preflight'
  );

  if (!rehearseDisable) return before;

  await executeSqlArtifact(client, DAILY_ALLOCATION_V2_DISABLE);
  const after = await captureSnapshot(client);
  assertRuntimeState(
    after.runtime,
    { boardEnabled: false, writesEnabled: false },
    'disable rehearsal'
  );
  assertProtectedStatePreserved(before, after, 'disable rehearsal');
  if (before.runtime.updatedAt !== after.runtime.updatedAt) {
    throw new Error('Idempotent disable rehearsal changed the runtime timestamp.');
  }
  return after;
}

function printSnapshot(label: string, snapshot: RolloutSnapshot): void {
  console.log(`${label}:`);
  console.log(
    `- runtime: board=${snapshot.runtime.boardEnabled}, writes=${snapshot.runtime.writesEnabled}, updated=${snapshot.runtime.updatedAt}`
  );
  console.log(`- permission fingerprint: ${snapshot.permissionFingerprint}`);
  console.log(`- v1 fingerprint: ${snapshot.v1Fingerprint}`);
  console.log(`- v2 content fingerprint: ${snapshot.v2ContentFingerprint}`);
  console.log(`- v2 counts: ${JSON.stringify(snapshot.v2Counts)}`);
}

function parseArguments(args: string[]): {
  command: RolloutCommand;
  expectedCommit?: string;
} {
  const command = args[0] as RolloutCommand | undefined;
  if (!command || !['status', 'preflight', 'activate', 'disable'].includes(command)) {
    throw new Error(
      'Usage: tsx scripts/manage-daily-allocation-v2-rollout.ts <status|preflight|activate|disable> [--expected-commit <sha>]'
    );
  }
  const commitIndex = args.indexOf('--expected-commit');
  return {
    command,
    expectedCommit: commitIndex >= 0 ? args[commitIndex + 1] : undefined,
  };
}

export class RolloutInterruptedError extends Error {
  readonly exitCode: number;

  constructor(signal: NodeJS.Signals, cause?: unknown) {
    super(
      `Daily Allocation activation interrupted by ${signal}; runtime disable was requested.`,
      cause === undefined ? undefined : { cause }
    );
    this.name = 'RolloutInterruptedError';
    this.exitCode = signal === 'SIGINT' ? 130 : 143;
  }
}

export async function runInterruptibleActivation(
  adapter: ActivationAdapter,
  smokeTimeoutMs = SMOKE_TIMEOUT_MS
): Promise<RolloutSnapshot> {
  let interruptionSignal: NodeJS.Signals | null = null;
  const signalHandler = (signal: NodeJS.Signals) => {
    interruptionSignal = signal;
    void adapter.cancelSmoke().catch(() => undefined);
  };
  process.once('SIGINT', signalHandler);
  process.once('SIGTERM', signalHandler);

  const interruptAwareAdapter: ActivationAdapter = {
    ...adapter,
    shouldAbort: () =>
      interruptionSignal !== null || adapter.shouldAbort?.() === true,
  };

  try {
    const result = await activateWithAutomaticDisable(
      interruptAwareAdapter,
      smokeTimeoutMs
    );
    if (interruptionSignal) {
      await adapter.executeDisable();
      const disabled = await adapter.captureSnapshot();
      assertRuntimeState(
        disabled.runtime,
        { boardEnabled: false, writesEnabled: false },
        `${interruptionSignal} disable`
      );
      throw new RolloutInterruptedError(interruptionSignal);
    }
    return result;
  } catch (error) {
    if (interruptionSignal && !(error instanceof RolloutInterruptedError)) {
      throw new RolloutInterruptedError(interruptionSignal, error);
    }
    throw error;
  } finally {
    process.removeListener('SIGINT', signalHandler);
    process.removeListener('SIGTERM', signalHandler);
  }
}

async function main(): Promise<void> {
  const { command, expectedCommit } = parseArguments(process.argv.slice(2));
  const connectionString = requireDailyAllocationProductionTarget(
    process.env.POSTGRES_URL_NON_POOLING
  );
  if (command === 'activate') {
    requireExpectedCommit(expectedCommit);
  }

  const client = await createClient(connectionString);
  let lockAcquired = false;
  try {
    if (command === 'status') {
      await verifyMigrationLedger(client);
      await verifyObjectAndGrantContract(client);
      printSnapshot('Daily Allocation v2 status', await captureSnapshot(client));
      return;
    }

    await acquireRolloutLock(client);
    lockAcquired = true;

    if (command === 'preflight') {
      printSnapshot(
        'Daily Allocation v2 preflight passed',
        await runPreflight(client, true)
      );
      return;
    }

    if (command === 'disable') {
      await executeSqlArtifact(client, DAILY_ALLOCATION_V2_DISABLE);
      const after = await captureSnapshot(client);
      assertRuntimeState(
        after.runtime,
        { boardEnabled: false, writesEnabled: false },
        'disable'
      );
      printSnapshot('Daily Allocation v2 disabled', after);
      return;
    }

    const preflight = await runPreflight(client, true);
    printSnapshot('Daily Allocation v2 activation preflight passed', preflight);
    const smokeController = createSmokeController(connectionString, client);
    const result = await runInterruptibleActivation({
      captureSnapshot: () => captureSnapshot(client),
      executeActivation: () =>
        executeSqlArtifact(client, DAILY_ALLOCATION_V2_ACTIVATION),
      executeDisable: () =>
        executeSqlArtifact(client, DAILY_ALLOCATION_V2_DISABLE),
      runSmokeChecks: () => smokeController.run(),
      cancelSmoke: () => smokeController.cancel(),
    });
    printSnapshot('Daily Allocation v2 activation passed', result);
  } finally {
    if (lockAcquired) {
      await releaseRolloutLock(client).catch(() => undefined);
    }
    await client.end();
  }
}

const invokedScript = process.argv[1]?.replace(/\\/gu, '/');
if (invokedScript?.endsWith('/scripts/manage-daily-allocation-v2-rollout.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(error instanceof RolloutInterruptedError ? error.exitCode : 1);
  });
}
