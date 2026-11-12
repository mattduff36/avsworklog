import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stripOuterMigrationTransaction } from '../../scripts/finalise-migrations';
import {
  DATABASE_COMMENT_PREFIX,
  DB_NAME,
  DB_USER,
  FRESHNESS_SQL,
  PROJECT_NAME_HASH_LENGTH,
  PROJECT_NAME_PREFIX,
  PROVENANCE_ENV_KEYS,
  STATE_VERSION,
  findFreshnessViolations,
  isInheritedDatabaseUrlKey,
  validateLocalTestDatabaseUrl,
} from '../../scripts/local-test-postgres';
import {
  DA2_ACTORS,
  DA2_PGLITE_BASE_PATH,
  DA2_V2_MIGRATION_PATH,
} from './daily-allocation-v2-pglite-harness';

const GRANT_MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260814155048_daily_allocation_v2_rpc_only_grants.sql'
);
const SAFETY_MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260912_daily_allocation_idempotent_mutations_and_guided_conversion.sql'
);
const SESSION_MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260930_daily_allocation_sessions.sql'
);

function productionFunction(file: string, name: string): string {
  const sql = readFileSync(resolve(process.cwd(), 'supabase', 'migrations', file), 'utf8').replace(/\r\n/g, '\n');
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  const end = sql.indexOf('\n$$;', start);
  if (start < 0 || end < 0) throw new Error(`Missing production function ${name}`);
  return sql.slice(start, end + 4);
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  if (typeof value === 'string') return JSON.parse(value) as JsonObject;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonObject;
  throw new Error(`Expected a JSON object, received ${typeof value}`);
}

const describeSessions = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeSessions('daily allocation session enforcement on disposable PostgreSQL', () => {
  const connectionString = process.env.TEST_DATABASE_URL || '';
  const clients: Client[] = [];
  let setup: Client;
  let actor: Client;

  function requireRunnerProvenance(): void {
    const marker = process.env[PROVENANCE_ENV_KEYS.marker];
    const projectName = process.env[PROVENANCE_ENV_KEYS.project];
    const portText = process.env[PROVENANCE_ENV_KEYS.port];
    if (!marker || !projectName || !portText || !/^[0-9]+$/u.test(portText)) {
      throw new Error('LTDB-SAFE-001: disposable local PostgreSQL runner provenance is required');
    }
    const leakedKeys = Object.keys(process.env).filter(
      (key) => key !== 'TEST_DATABASE_URL' && isInheritedDatabaseUrlKey(key)
    );
    if (leakedKeys.length > 0) {
      throw new Error(`LTDB-SAFE-001: inherited database variables reappeared: ${leakedKeys.join(', ')}`);
    }
    validateLocalTestDatabaseUrl(connectionString, Number.parseInt(portText, 10));
    const match = new RegExp(
      `^${DATABASE_COMMENT_PREFIX}:v${STATE_VERSION}:([0-9a-f]{64}):([0-9a-f]{64})$`,
      'u'
    ).exec(marker);
    if (!match || projectName !== `${PROJECT_NAME_PREFIX}${match[1].slice(0, PROJECT_NAME_HASH_LENGTH)}`) {
      throw new Error('LTDB-SAFE-001: runner marker and project provenance disagree');
    }
  }

  async function connect(): Promise<Client> {
    const client = new Client({ connectionString, ssl: false });
    await client.connect();
    await client.query(`SET statement_timeout = '12s'`);
    await client.query(`SET lock_timeout = '10s'`);
    clients.push(client);
    return client;
  }

  async function authenticate(client: Client): Promise<void> {
    await client.query('RESET ROLE');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [DA2_ACTORS.manager]);
    await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: DA2_ACTORS.manager }),
    ]);
    await client.query('SET ROLE authenticated');
  }

  async function asOwner(client: Client): Promise<void> {
    await client.query('RESET ROLE');
  }

  beforeAll(async () => {
    requireRunnerProvenance();
    setup = await connect();
    actor = await connect();
    const [identity, marker, schemas, relations, functions, extensions, fixtureRoles] = await Promise.all([
      setup.query<{ current_database: string; current_user: string }>(FRESHNESS_SQL.identity),
      setup.query<{ comment: string | null }>(FRESHNESS_SQL.marker),
      setup.query<{ name: string }>(FRESHNESS_SQL.schemas),
      setup.query<{ schema_name: string; name: string }>(FRESHNESS_SQL.relations),
      setup.query<{ schema_name: string; name: string }>(FRESHNESS_SQL.functions),
      setup.query<{ name: string }>(FRESHNESS_SQL.extensions),
      setup.query<{ rolname: string }>(
        `SELECT rolname FROM pg_roles
         WHERE rolname IN ('anon', 'authenticated', 'service_role')
         ORDER BY rolname`
      ),
    ]);
    expect(identity.rows[0]).toEqual({ current_database: DB_NAME, current_user: DB_USER });
    expect(marker.rows[0]?.comment).toBe(process.env[PROVENANCE_ENV_KEYS.marker]);
    expect(fixtureRoles.rows).toEqual([]);
    expect(findFreshnessViolations({
      schemas: schemas.rows.map((row) => row.name),
      relations: relations.rows.map((row) => ({ schema: row.schema_name, name: row.name })),
      functions: functions.rows.map((row) => ({ schema: row.schema_name, name: row.name })),
      extensions: extensions.rows.map((row) => row.name),
    })).toEqual([]);

    await setup.query(readFileSync(DA2_PGLITE_BASE_PATH, 'utf8'));
    await setup.query(readFileSync(DA2_V2_MIGRATION_PATH, 'utf8'));
    await setup.query(readFileSync(GRANT_MIGRATION_PATH, 'utf8'));
    await setup.query(stripOuterMigrationTransaction(readFileSync(SAFETY_MIGRATION_PATH, 'utf8')));
    await setup.query('ALTER TABLE public.plant ADD COLUMN IF NOT EXISTS plant_id TEXT');
    await setup.query(stripOuterMigrationTransaction(readFileSync(SESSION_MIGRATION_PATH, 'utf8')));
    await setup.query(`
      CREATE TABLE public.customers (id UUID PRIMARY KEY, status TEXT, company_name TEXT);
      ALTER TABLE public.quotes
        ADD COLUMN customer_id UUID, ADD COLUMN base_quote_reference TEXT, ADD COLUMN quote_reference TEXT,
        ADD COLUMN subject_line TEXT, ADD COLUMN project_description TEXT, ADD COLUMN status TEXT,
        ADD COLUMN commercial_status TEXT, ADD COLUMN is_latest_version BOOLEAN,
        ADD COLUMN revision_number INTEGER, ADD COLUMN created_at TIMESTAMPTZ;
      ALTER TABLE public.legacy_quotes ADD COLUMN quote_reference TEXT;
      ALTER TABLE public.quote_project_numbers ADD COLUMN description TEXT;
      ALTER TABLE public.quote_reference_aliases ADD COLUMN source_quote_thread_id UUID;
      UPDATE public.quote_project_numbers SET status = 'open';
    `);
    await setup.query(productionFunction('20260813_daily_allocation_module.sql', 'private.allocation_site_is_valid'));
    await setup.query(stripOuterMigrationTransaction(readFileSync(resolve(
      process.cwd(), 'supabase', 'migrations', '20260903_job_catalogue_revision_fallback.sql'
    ), 'utf8')));
    await setup.query(productionFunction('20260813_daily_allocation_module.sql', 'private.apply_allocation_job_fields'));
    await setup.query(stripOuterMigrationTransaction(readFileSync(resolve(
      process.cwd(), 'supabase', 'migrations', '20261003_daily_allocation_assigned_visit.sql'
    ), 'utf8')));
    await setup.query(stripOuterMigrationTransaction(readFileSync(resolve(
      process.cwd(), 'supabase', 'migrations', '20261109_daily_allocation_draft_address.sql'
    ), 'utf8')));
    await setup.query(stripOuterMigrationTransaction(readFileSync(resolve(
      process.cwd(), 'supabase', 'migrations', '20261112_daily_allocation_publish_optional_address.sql'
    ), 'utf8')));
    await setup.query(
      `UPDATE private.daily_allocation_v2_runtime
       SET board_enabled = TRUE, writes_enabled = TRUE, updated_at = NOW()
       WHERE singleton = TRUE`
    );
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled(clients.map((client) => client.end()));
  });

  async function convertPlan(workDate: string): Promise<string> {
    await authenticate(actor);
    const source = await actor.query<{ source: unknown }>(
      'SELECT public.get_daily_allocation_conversion_source_v2($1::date, $2::text) AS source',
      [workDate, 'team-1']
    );
    const fingerprint = asObject(source.rows[0]?.source).source_fingerprint;
    const converted = await actor.query<{ converted: unknown }>(
      `SELECT public.convert_daily_allocation_plan_day_v2(
         $1::uuid, $2::date, 'team-1', $3::text, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
       ) AS converted`,
      [randomUUID(), workDate, fingerprint]
    );
    return String(asObject(converted.rows[0]?.converted).plan_day_id);
  }

  it('publishes an addressless job with one itinerary per employee, replays safely and preserves earlier snapshots', async () => {
    const jobId = randomUUID();
    const sourcePlan = await convertPlan('2026-02-02');
    await setup.query(`INSERT INTO public.quote_project_numbers (id, project_reference, status, site_address)
      VALUES ($1, '50075-LC', 'open', NULL)`, [jobId]);
    const requestId = randomUUID();
    const args = [requestId, sourcePlan, jobId];
    const createSql = `SELECT public.create_daily_allocation_assigned_visit_v2(
      $1::uuid, $2::uuid, 1, '${DA2_ACTORS.employeeA}'::uuid,
      'project_number', $3::uuid, '50075-LC',
      '2026-02-02 07:00:00+00', '2026-02-02 16:30:00+00',
      NULL, NULL, NULL, NULL, NULL
    ) AS result`;
    const created = asObject((await actor.query(createSql, args)).rows[0].result);
    expect(asObject(created.visit)).toMatchObject({ job_code: '50075-LC', site_address: '' });
    expect(asObject((await actor.query(createSql, args)).rows[0].result)).toEqual(created);
    await expect(actor.query(createSql, [randomUUID(), sourcePlan, jobId])).rejects.toThrow(/STALE_PLAN_VERSION/);

    const copySql = `SELECT public.copy_daily_allocation_plan_v2(
      $1::uuid, '2026-02-02'::date, '2026-02-03'::date, 'team-1',
      ARRAY['jobs'], $2::boolean, 2, NULL
    ) AS result`;
    const preview = asObject((await actor.query(copySql, [randomUUID(), false])).rows[0].result);
    expect(preview.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '50075-LC', detail: expect.stringContaining('Publishing is allowed') }),
    ]));
    const copied = asObject((await actor.query(copySql, [randomUUID(), true])).rows[0].result);
    expect(copied.applied).toBe(true);
    expect((await setup.query(`SELECT site_address FROM public.daily_allocation_visits
      WHERE work_date = '2026-02-03' AND job_source_id = $1`, [jobId])).rows).toEqual([{ site_address: '' }]);
    const publishSql = `SELECT public.publish_daily_allocation_plan_v2($1::uuid, $2::uuid, 2, $3::text, TRUE) AS result`;
    const publishArgs = [randomUUID(), sourcePlan, randomUUID()];
    await setup.query(`UPDATE public.quote_project_numbers SET status = 'cancelled' WHERE id = $1`, [jobId]);
    await expect(actor.query(publishSql, publishArgs)).rejects.toThrow(/JOB_NOT_FOUND/);
    await setup.query(`UPDATE public.quote_project_numbers SET status = 'open' WHERE id = $1`, [jobId]);
    const duplicateId = randomUUID();
    await setup.query(`INSERT INTO public.legacy_quotes (id, quote_reference) VALUES ($1, '50075-LC')`, [duplicateId]);
    await expect(actor.query(publishSql, publishArgs)).rejects.toThrow(/JOB_AMBIGUOUS/);
    await setup.query('DELETE FROM public.legacy_quotes WHERE id = $1', [duplicateId]);
    expect((await setup.query('SELECT COUNT(*)::integer AS count FROM public.daily_allocation_publications WHERE plan_day_id = $1', [sourcePlan])).rows[0].count).toBe(0);
    const first = asObject((await actor.query(publishSql, publishArgs)).rows[0].result);
    expect(first.publication_id).toBeTruthy();
    expect(asObject((await actor.query(publishSql, publishArgs)).rows[0].result)).toEqual(first);
    expect((await setup.query(`SELECT site_address FROM public.daily_allocation_published_visits
      WHERE publication_id = $1`, [first.publication_id])).rows).toEqual([{ site_address: '' }]);
    const notifications = await setup.query(`SELECT notifications.profile_id AS user_id, messages.body
      FROM public.daily_allocation_publication_notifications notifications
      JOIN public.messages ON messages.id = notifications.message_id
      WHERE notifications.publication_id = $1`, [first.publication_id]);
    expect(notifications.rows.length).toBeGreaterThan(0);
    expect(new Set(notifications.rows.map((row) => row.user_id)).size).toBe(notifications.rows.length);
    expect(notifications.rows.find((row) => row.user_id === DA2_ACTORS.employeeA)?.body)
      .toContain('50075-LC (Site address not provided)');
    expect((await setup.query('SELECT COUNT(*)::integer AS count FROM public.daily_allocation_publications WHERE plan_day_id = $1', [sourcePlan])).rows[0].count).toBe(1);
    await setup.query(`UPDATE public.quote_project_numbers SET site_address = '12 Canonical Site Road' WHERE id = $1`, [jobId]);
    const published = await actor.query(`SELECT public.publish_daily_allocation_plan_v2($1::uuid, $2::uuid, 3, $3::text, TRUE) AS result`,
      [randomUUID(), sourcePlan, randomUUID()]);
    const publicationId = asObject(published.rows[0].result).publication_id;
    expect(publicationId).toBeTruthy();
    expect((await setup.query(`SELECT site_address FROM public.daily_allocation_published_visits
      WHERE publication_id = $1`, [publicationId])).rows).toEqual([{ site_address: '12 Canonical Site Road' }]);
    expect((await setup.query('SELECT site_address FROM public.daily_allocation_visits WHERE id = $1', [created.visit_id])).rows[0].site_address).toBe('');
    expect((await setup.query(`SELECT site_address FROM public.daily_allocation_published_visits
      WHERE publication_id = $1`, [first.publication_id])).rows).toEqual([{ site_address: '' }]);
    await expect(actor.query(`UPDATE public.daily_allocation_published_visits SET site_address = 'Changed'
      WHERE publication_id = $1`, [first.publication_id])).rejects.toThrow();
  });

  it.each([
    { address: '', date: '2026-02-04' },
    { address: '   ', date: '2026-02-05' },
    { address: 'Unconfirmed', date: '2026-02-06' },
  ])('publishes an available job with optional address $address', async ({ address, date }) => {
    const jobId = randomUUID();
    const planId = await convertPlan(date);
    await setup.query(`INSERT INTO public.quote_project_numbers (id, project_reference, status, site_address)
      VALUES ($1, $2, 'open', $3)`, [jobId, `OPTIONAL-${date}`, address]);
    await actor.query(`SELECT public.create_daily_allocation_assigned_visit_v2(
      $1::uuid, $2::uuid, 1, $3::uuid, 'project_number', $4::uuid, NULL,
      $5::timestamptz, $6::timestamptz, NULL, NULL, NULL, NULL, NULL
    )`, [randomUUID(), planId, DA2_ACTORS.employeeA, jobId, `${date} 07:00:00+00`, `${date} 16:30:00+00`]);
    const published = asObject((await actor.query(`SELECT public.publish_daily_allocation_plan_v2(
      $1::uuid, $2::uuid, 2, $3::text, TRUE
    ) AS result`, [randomUUID(), planId, randomUUID()])).rows[0].result);
    expect(published.publication_id).toBeTruthy();
  });

  it('edits and moves unreliable-address drafts, refreshes their source and rejects inactive or ambiguous jobs', async () => {
    const jobId = randomUUID();
    const sourcePlan = await convertPlan('2026-02-09');
    const targetPlan = await convertPlan('2026-02-10');
    await setup.query(`INSERT INTO public.quote_project_numbers (id, project_reference, status, site_address)
      VALUES ($1, 'MISSING-SITE', 'open', 'Unconfirmed')`, [jobId]);
    const upsertSql = `SELECT public.upsert_daily_allocation_visit_v2(
      $1::uuid, $2::uuid, $3::uuid, $4::integer, $5::integer, 'project_number', $6::uuid, NULL,
      '2026-02-09 07:00:00+00', '2026-02-09 16:30:00+00', NULL, NULL, NULL
    ) AS result`;
    const created = asObject((await actor.query(upsertSql, [randomUUID(), null, sourcePlan, 1, 1, jobId])).rows[0].result);
    expect(asObject(created.visit).site_address).toBe('Unconfirmed');
    const edited = asObject((await actor.query(upsertSql, [randomUUID(), created.visit_id, sourcePlan, 2, 1, jobId])).rows[0].result);
    expect(asObject(edited.visit).row_version).toBe(2);
    const moveSql = `SELECT public.move_daily_allocation_visit_v2(
      $1::uuid, $2::uuid, $3::uuid, 3, 1, 2,
      '2026-02-10 07:00:00+00', '2026-02-10 16:30:00+00'
    ) AS result`;
    const moveArgs = [randomUUID(), created.visit_id, targetPlan];
    const moved = asObject((await actor.query(moveSql, moveArgs)).rows[0].result);
    expect(asObject(moved.visit)).toMatchObject({ work_date: '2026-02-10', site_address: 'Unconfirmed' });
    expect(asObject((await actor.query(moveSql, moveArgs)).rows[0].result)).toEqual(moved);
    await setup.query(`UPDATE public.quote_project_numbers SET status = 'cancelled' WHERE id = $1`, [jobId]);
    await expect(actor.query(upsertSql, [randomUUID(), null, sourcePlan, 4, 1, jobId])).rejects.toThrow(/JOB_NOT_FOUND/);
    const copySql = `SELECT public.copy_daily_allocation_plan_v2(
      $1::uuid, '2026-02-10'::date, '2026-02-11'::date, 'team-1', ARRAY['jobs'], FALSE, 2, NULL
    ) AS result`;
    const inactiveCopy = asObject((await actor.query(copySql, [randomUUID()])).rows[0].result);
    expect(inactiveCopy.additions).toEqual([]);
    expect(inactiveCopy.skips).toEqual(expect.arrayContaining([
      expect.objectContaining({ detail: expect.stringContaining('inactive') }),
    ]));
    await setup.query(`UPDATE public.quote_project_numbers SET status = 'open', site_address = '19 Repaired Site Street' WHERE id = $1`, [jobId]);
    const duplicateId = randomUUID();
    await setup.query(`INSERT INTO public.legacy_quotes (id, quote_reference) VALUES ($1, 'MISSING-SITE')`, [duplicateId]);
    await expect(actor.query(upsertSql, [randomUUID(), null, sourcePlan, 4, 1, jobId])).rejects.toThrow(/JOB_AMBIGUOUS/);
    const ambiguousCopy = asObject((await actor.query(copySql, [randomUUID()])).rows[0].result);
    expect(ambiguousCopy.additions).toEqual([]);
    await setup.query('DELETE FROM public.legacy_quotes WHERE id = $1', [duplicateId]);
    const refreshed = await actor.query(`SELECT public.move_daily_allocation_visit_v2(
      $1::uuid, $2::uuid, $3::uuid, 2, 4, 3,
      '2026-02-09 07:00:00+00', '2026-02-09 16:30:00+00'
    ) AS result`, [randomUUID(), created.visit_id, sourcePlan]);
    expect(asObject(asObject(refreshed.rows[0].result).visit).site_address).toBe('19 Repaired Site Street');
    await actor.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [DA2_ACTORS.employeeB]);
    await expect(actor.query(upsertSql, [randomUUID(), null, sourcePlan, 5, 1, jobId])).rejects.toThrow();
  });

  it('rejects a custom interval and accepts an exact morning session', async () => {
    const planId = await convertPlan('2026-01-12');
    await authenticate(actor);
    await expect(actor.query(
      `SELECT public.upsert_daily_allocation_visit_v2(
         $1::uuid, NULL::uuid, $2::uuid, 1, 1,
         'project_number', $3::uuid, NULL,
         '2026-01-12 09:00:00+00', '2026-01-12 10:00:00+00',
         NULL, NULL, NULL
       )`,
      [randomUUID(), planId, DA2_ACTORS.jobA]
    )).rejects.toThrow(/VALIDATION/);

    const created = await actor.query<{ result: unknown }>(
      `SELECT public.upsert_daily_allocation_visit_v2(
         $1::uuid, NULL::uuid, $2::uuid, 1, 1,
         'project_number', $3::uuid, NULL,
         '2026-01-12 07:00:00+00', '2026-01-12 12:00:00+00',
         NULL, NULL, NULL
       ) AS result`,
      [randomUUID(), planId, DA2_ACTORS.jobB]
    );
    expect(asObject(created.rows[0]?.result).visit_id).toBeTruthy();
  });

  it('previews a custom draft, applies one session, and rejects a stale retry', async () => {
    const planId = await convertPlan('2026-01-13');
    const visitId = randomUUID();
    await asOwner(setup);
    await setup.query('ALTER TABLE public.daily_allocation_visits DISABLE TRIGGER daily_allocation_visits_session_guard');
    await setup.query(
      `INSERT INTO public.daily_allocation_visits (
         id, plan_day_id, work_date, owner_team_id, job_source_type, job_source_id,
         job_code, site_address, starts_at, ends_at, row_version, created_by
       ) VALUES (
         $1::uuid, $2::uuid, '2026-01-13', 'team-1', 'project_number', $3::uuid,
         'JOB-CUSTOM', '1 Test Street', '2026-01-13 09:00:00+00', '2026-01-13 10:00:00+00', 1, $4::uuid
       )`,
      [visitId, planId, DA2_ACTORS.jobA, DA2_ACTORS.manager]
    );
    await setup.query('ALTER TABLE public.daily_allocation_visits ENABLE TRIGGER daily_allocation_visits_session_guard');

    await authenticate(actor);
    const preview = await actor.query<{ result: unknown }>(
      `SELECT public.normalize_daily_allocation_sessions_v2(
         $1::uuid, 'team-1', '2026-01-13'::date, 1, FALSE, '[]'::jsonb
       ) AS result`,
      [randomUUID()]
    );
    const previewBody = asObject(preview.rows[0]?.result);
    expect(previewBody.applied).toBe(false);
    expect(previewBody.visits).toEqual([
      expect.objectContaining({ visit_id: visitId, session: 'am' }),
    ]);
    const unchanged = await setup.query<{ starts_at: Date }>(
      'SELECT starts_at FROM public.daily_allocation_visits WHERE id = $1::uuid',
      [visitId]
    );
    expect(unchanged.rows[0]?.starts_at.toISOString()).toBe('2026-01-13T09:00:00.000Z');

    const applied = await actor.query<{ result: unknown }>(
      `SELECT public.normalize_daily_allocation_sessions_v2(
         $1::uuid, 'team-1', '2026-01-13'::date, 1, TRUE, '[]'::jsonb
       ) AS result`,
      [randomUUID()]
    );
    expect(asObject(applied.rows[0]?.result).applied).toBe(true);
    const updated = await setup.query<{ starts_at: Date; ends_at: Date }>(
      'SELECT starts_at, ends_at FROM public.daily_allocation_visits WHERE id = $1::uuid',
      [visitId]
    );
    expect(updated.rows[0]?.starts_at.toISOString()).toBe('2026-01-13T07:00:00.000Z');
    expect(updated.rows[0]?.ends_at.toISOString()).toBe('2026-01-13T12:00:00.000Z');

    await expect(actor.query(
      `SELECT public.normalize_daily_allocation_sessions_v2(
         $1::uuid, 'team-1', '2026-01-13'::date, 1, TRUE, '[]'::jsonb
       )`,
      [randomUUID()]
    )).rejects.toThrow(/STALE_PLAN_VERSION/);
  });

  it('keeps both visits unchanged when proposed sessions overlap', async () => {
    const planId = await convertPlan('2026-01-14');
    const firstId = randomUUID();
    const secondId = randomUUID();
    await asOwner(setup);
    await setup.query('ALTER TABLE public.daily_allocation_visits DISABLE TRIGGER daily_allocation_visits_session_guard');
    await setup.query(
      `INSERT INTO public.daily_allocation_visits (
         id, plan_day_id, work_date, owner_team_id, job_source_type, job_source_id,
         job_code, site_address, starts_at, ends_at, created_by
       ) VALUES
         ($1::uuid, $3::uuid, '2026-01-14', 'team-1', 'project_number', $4::uuid,
          'JOB-A', '1 Test Street', '2026-01-14 08:00:00+00', '2026-01-14 09:00:00+00', $6::uuid),
         ($2::uuid, $3::uuid, '2026-01-14', 'team-1', 'project_number', $5::uuid,
          'JOB-B', '2 Test Street', '2026-01-14 10:00:00+00', '2026-01-14 11:00:00+00', $6::uuid)`,
      [firstId, secondId, planId, DA2_ACTORS.jobA, DA2_ACTORS.jobB, DA2_ACTORS.manager]
    );
    await setup.query(
      `INSERT INTO public.daily_allocation_visit_labour (
         visit_id, plan_day_id, work_date, profile_id, starts_at, ends_at, created_by
       ) VALUES
         ($1::uuid, $3::uuid, '2026-01-14', $4::uuid, '2026-01-14 08:00:00+00', '2026-01-14 09:00:00+00', $4::uuid),
         ($2::uuid, $3::uuid, '2026-01-14', $4::uuid, '2026-01-14 10:00:00+00', '2026-01-14 11:00:00+00', $4::uuid)`,
      [firstId, secondId, planId, DA2_ACTORS.employeeA]
    );
    await setup.query('ALTER TABLE public.daily_allocation_visits ENABLE TRIGGER daily_allocation_visits_session_guard');

    await authenticate(actor);
    await expect(actor.query(
      `SELECT public.normalize_daily_allocation_sessions_v2(
         $1::uuid, 'team-1', '2026-01-14'::date, 1, TRUE, '[]'::jsonb
       )`,
      [randomUUID()]
    )).rejects.toThrow(/CONFLICT/);

    const rows = await setup.query<{ id: string; starts_at: Date }>(
      `SELECT id, starts_at FROM public.daily_allocation_visits
       WHERE id IN ($1::uuid, $2::uuid) ORDER BY starts_at`,
      [firstId, secondId]
    );
    expect(rows.rows.map((row) => row.starts_at.toISOString())).toEqual([
      '2026-01-14T08:00:00.000Z',
      '2026-01-14T10:00:00.000Z',
    ]);
  });

  it('swaps two custom visits between morning and afternoon without a transient overlap', async () => {
    const planId = await convertPlan('2026-01-15');
    const morningId = randomUUID();
    const afternoonId = randomUUID();
    await asOwner(setup);
    await setup.query('ALTER TABLE public.daily_allocation_visits DISABLE TRIGGER daily_allocation_visits_session_guard');
    await setup.query(
      `INSERT INTO public.daily_allocation_visits (
         id, plan_day_id, work_date, owner_team_id, job_source_type, job_source_id,
         job_code, site_address, starts_at, ends_at, created_by
       ) VALUES
         ($1::uuid, $3::uuid, '2026-01-15', 'team-1', 'project_number', $4::uuid,
          'JOB-AM', '1 Test Street', '2026-01-15 08:00:00+00', '2026-01-15 09:00:00+00', $6::uuid),
         ($2::uuid, $3::uuid, '2026-01-15', 'team-1', 'project_number', $5::uuid,
          'JOB-PM', '2 Test Street', '2026-01-15 13:00:00+00', '2026-01-15 14:00:00+00', $6::uuid)`,
      [morningId, afternoonId, planId, DA2_ACTORS.jobA, DA2_ACTORS.jobB, DA2_ACTORS.manager]
    );
    await setup.query(
      `INSERT INTO public.daily_allocation_visit_labour (
         visit_id, plan_day_id, work_date, profile_id, starts_at, ends_at, created_by
       ) VALUES
         ($1::uuid, $3::uuid, '2026-01-15', $4::uuid, '2026-01-15 08:00:00+00', '2026-01-15 09:00:00+00', $4::uuid),
         ($2::uuid, $3::uuid, '2026-01-15', $4::uuid, '2026-01-15 13:00:00+00', '2026-01-15 14:00:00+00', $4::uuid)`,
      [morningId, afternoonId, planId, DA2_ACTORS.employeeA]
    );
    await setup.query('ALTER TABLE public.daily_allocation_visits ENABLE TRIGGER daily_allocation_visits_session_guard');

    await authenticate(actor);
    await actor.query(
      `SELECT public.normalize_daily_allocation_sessions_v2(
         $1::uuid, 'team-1', '2026-01-15'::date, 1, TRUE, $2::jsonb
       )`,
      [randomUUID(), JSON.stringify([
        { visit_id: morningId, session: 'pm' },
        { visit_id: afternoonId, session: 'am' },
      ])]
    );
    const rows = await setup.query<{ id: string; starts_at: Date }>(
      'SELECT id, starts_at FROM public.daily_allocation_visits WHERE id IN ($1::uuid, $2::uuid)',
      [morningId, afternoonId]
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row.starts_at.toISOString()]));
    expect(byId.get(morningId)).toBe('2026-01-15T12:00:00.000Z');
    expect(byId.get(afternoonId)).toBe('2026-01-15T07:00:00.000Z');
  });
});
