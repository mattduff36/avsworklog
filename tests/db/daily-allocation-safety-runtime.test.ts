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

const SAFETY_MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260912_daily_allocation_idempotent_mutations_and_guided_conversion.sql'
);
const GRANT_MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260814155048_daily_allocation_v2_rpc_only_grants.sql'
);
const TEAM_TWO = 'team-2';
const MANAGER_TWO = '12121212-1212-4121-8121-121212121212';
const PLANT_TWO = '67676767-6767-4676-8676-676767676767';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  if (typeof value === 'string') return JSON.parse(value) as JsonObject;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }
  throw new Error(`Expected a JSON object, received ${typeof value}`);
}

function asArray(value: unknown): JsonObject[] {
  if (typeof value === 'string') return JSON.parse(value) as JsonObject[];
  if (Array.isArray(value)) return value as JsonObject[];
  throw new Error(`Expected a JSON array, received ${typeof value}`);
}

async function waitUntilBlockedBy(
  watcher: Client,
  blockedPid: number,
  blockerPid: number,
  label: string
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await watcher.query<{ blocked: boolean }>(
      'SELECT $1::int = ANY (pg_blocking_pids($2::int)) AS blocked',
      [blockerPid, blockedPid]
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  throw new Error(`${label}: expected backend ${blockedPid} to block behind ${blockerPid}`);
}

const describeSafety = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeSafety('Daily Allocation disposable PostgreSQL safety verification', () => {
  const connectionString = process.env.TEST_DATABASE_URL || '';
  const clients: Client[] = [];
  let setup: Client;
  let first: Client;
  let second: Client;
  let third: Client;

  function requireRunnerProvenance(): void {
    if (!connectionString) {
      throw new Error(
        'DAFP-PG-RUNNER-001: use the canonical disposable PostgreSQL one-shot; skipping is forbidden'
      );
    }
    const marker = process.env[PROVENANCE_ENV_KEYS.marker];
    const projectName = process.env[PROVENANCE_ENV_KEYS.project];
    const portText = process.env[PROVENANCE_ENV_KEYS.port];
    if (!marker || !projectName || !portText || !/^[0-9]+$/u.test(portText)) {
      throw new Error('DAFP-PG-RUNNER-001: canonical runner provenance is required');
    }
    const leakedKeys = Object.keys(process.env).filter(
      (key) => key !== 'TEST_DATABASE_URL' && isInheritedDatabaseUrlKey(key)
    );
    if (leakedKeys.length > 0) {
      throw new Error(
        `DAFP-PG-RUNNER-001: inherited database variables reappeared: ${leakedKeys.join(', ')}`
      );
    }
    validateLocalTestDatabaseUrl(connectionString, Number.parseInt(portText, 10));
    const match = new RegExp(
      `^${DATABASE_COMMENT_PREFIX}:v${STATE_VERSION}:([0-9a-f]{64}):([0-9a-f]{64})$`,
      'u'
    ).exec(marker);
    if (
      !match ||
      projectName !== `${PROJECT_NAME_PREFIX}${match[1].slice(0, PROJECT_NAME_HASH_LENGTH)}`
    ) {
      throw new Error('DAFP-PG-RUNNER-001: runner marker and project provenance disagree');
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

  async function authenticate(client: Client, actorId: string = DA2_ACTORS.manager): Promise<void> {
    await client.query('RESET ROLE');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [actorId]);
    await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: actorId }),
    ]);
    await client.query('SET ROLE authenticated');
  }

  async function asOwner(client: Client): Promise<void> {
    await client.query('RESET ROLE');
    await client.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }

  async function asOwnerActor(client: Client, actorId: string = DA2_ACTORS.manager): Promise<void> {
    await client.query('RESET ROLE');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [actorId]);
    await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: actorId }),
    ]);
  }

  async function setFlags(enabled: boolean): Promise<void> {
    await asOwner(setup);
    await setup.query(
      `UPDATE private.daily_allocation_v2_runtime
       SET board_enabled = $1, writes_enabled = $1, updated_at = NOW()
       WHERE singleton = TRUE`,
      [enabled]
    );
  }

  async function conversionSource(
    client: Client,
    workDate: string,
    teamId: string
  ): Promise<JsonObject> {
    const result = await client.query<{ source: unknown }>(
      'SELECT public.get_daily_allocation_conversion_source_v2($1::date, $2::text) AS source',
      [workDate, teamId]
    );
    return asObject(result.rows[0]?.source);
  }

  async function convertEmptyPlan(
    client: Client,
    workDate: string,
    teamId: string,
    requestId = randomUUID()
  ): Promise<JsonObject> {
    const source = await conversionSource(client, workDate, teamId);
    const result = await client.query<{ converted: unknown }>(
      `SELECT public.convert_daily_allocation_plan_day_v2(
         $1::uuid, $2::date, $3::text, $4::text,
         '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
       ) AS converted`,
      [requestId, workDate, teamId, source.source_fingerprint]
    );
    return asObject(result.rows[0]?.converted);
  }

  async function createVisit(input: {
    client: Client;
    planId: string;
    expectedPlanVersion: number;
    jobId: string;
    workDate: string;
    startHour: number;
    requestId?: string;
    visitId?: string | null;
    expectedRowVersion?: number;
  }): Promise<JsonObject> {
    const startsAt = `${input.workDate} ${String(input.startHour).padStart(2, '0')}:00:00+00`;
    const endsAt = `${input.workDate} ${String(input.startHour + 1).padStart(2, '0')}:00:00+00`;
    const result = await input.client.query<{ result: unknown }>(
      `SELECT public.upsert_daily_allocation_visit_v2(
         $1::uuid, $2::uuid, $3::uuid, $4::integer, $5::integer,
         'project_number'::text, $6::uuid, NULL::text,
         $7::timestamptz, $8::timestamptz,
         NULL::text, NULL::text, NULL::text
       ) AS result`,
      [
        input.requestId ?? randomUUID(),
        input.visitId ?? null,
        input.planId,
        input.expectedPlanVersion,
        input.expectedRowVersion ?? 1,
        input.jobId,
        startsAt,
        endsAt,
      ]
    );
    return asObject(result.rows[0]?.result);
  }

  async function v1Snapshot(workDate: string, teamId: string): Promise<JsonObject> {
    await asOwner(setup);
    const result = await setup.query<{ snapshot: unknown }>(
      `SELECT jsonb_build_object(
         'labour', COALESCE((
           SELECT jsonb_agg(to_jsonb(drafts) ORDER BY drafts.id)
           FROM public.daily_labour_allocation_drafts drafts
           JOIN public.profiles profiles ON profiles.id = drafts.profile_id
           WHERE drafts.work_date = $1::date AND profiles.team_id = $2
         ), '[]'::jsonb),
         'plant', COALESCE((
           SELECT jsonb_agg(to_jsonb(drafts) ORDER BY drafts.id)
           FROM public.daily_plant_allocation_drafts drafts
           WHERE drafts.work_date = $1::date AND drafts.owner_team_id = $2
         ), '[]'::jsonb)
       ) AS snapshot`,
      [workDate, teamId]
    );
    return asObject(result.rows[0]?.snapshot);
  }

  async function mutationSnapshot(planId: string): Promise<JsonObject> {
    await asOwner(setup);
    const result = await setup.query<{ snapshot: unknown }>(
      `SELECT jsonb_build_object(
         'plan', (SELECT to_jsonb(plan_days) FROM public.daily_allocation_plan_days plan_days
                  WHERE plan_days.id = $1::uuid),
         'visits', COALESCE((SELECT jsonb_agg(to_jsonb(visits) ORDER BY visits.id)
                             FROM public.daily_allocation_visits visits
                             WHERE visits.plan_day_id = $1::uuid), '[]'::jsonb),
         'labour', COALESCE((SELECT jsonb_agg(to_jsonb(labour) ORDER BY labour.id)
                             FROM public.daily_allocation_visit_labour labour
                             WHERE labour.plan_day_id = $1::uuid), '[]'::jsonb),
         'plant', COALESCE((SELECT jsonb_agg(to_jsonb(plant) ORDER BY plant.id)
                            FROM public.daily_allocation_visit_plant plant
                            WHERE plant.plan_day_id = $1::uuid), '[]'::jsonb)
       ) AS snapshot`,
      [planId]
    );
    return asObject(result.rows[0]?.snapshot);
  }

  beforeAll(async () => {
    requireRunnerProvenance();
    setup = await connect();
    first = await connect();
    second = await connect();
    third = await connect();

    const [identity, marker, schemas, relations, functions, extensions, fixtureRoles] =
      await Promise.all([
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
    expect(
      findFreshnessViolations({
        schemas: schemas.rows.map((row) => row.name),
        relations: relations.rows.map((row) => ({
          schema: row.schema_name,
          name: row.name,
        })),
        functions: functions.rows.map((row) => ({
          schema: row.schema_name,
          name: row.name,
        })),
        extensions: extensions.rows.map((row) => row.name),
      })
    ).toEqual([]);

    await setup.query(readFileSync(DA2_PGLITE_BASE_PATH, 'utf8'));
    await setup.query(readFileSync(DA2_V2_MIGRATION_PATH, 'utf8'));
    await setup.query(readFileSync(GRANT_MIGRATION_PATH, 'utf8'));
    await setup.query(
      stripOuterMigrationTransaction(readFileSync(SAFETY_MIGRATION_PATH, 'utf8'))
    );
    await setup.query(
      `INSERT INTO public.org_teams (id, name) VALUES ($1, 'Utilities')
       ON CONFLICT (id) DO NOTHING`,
      [TEAM_TWO]
    );
    await setup.query(
      `INSERT INTO public.profiles (id, full_name, employee_id, team_id, is_placeholder)
       VALUES ($1::uuid, 'Manager Two', 'MGR200', $2, FALSE)
       ON CONFLICT (id) DO NOTHING`,
      [MANAGER_TWO, TEAM_TWO]
    );
    await setup.query(
      `INSERT INTO private.test_actor_module_level (profile_id, daily_allocation_level)
       VALUES ($1::uuid, 4)
       ON CONFLICT (profile_id) DO UPDATE
       SET daily_allocation_level = EXCLUDED.daily_allocation_level`,
      [MANAGER_TWO]
    );
    await setup.query(
      `INSERT INTO public.plant (id, name, owner_team_id)
       VALUES ($1::uuid, 'Excavator 2', 'team-1')
       ON CONFLICT (id) DO NOTHING`,
      [PLANT_TWO]
    );
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled(clients.map((client) => client.end()));
  });

  it('DAFP-FLAG-001: closed flags reject every v2 write and replay while v1 remains usable', async () => {
    await authenticate(first);
    const closedCalls = [
      `SELECT public.convert_daily_allocation_plan_day_v2(
         '${randomUUID()}'::uuid, '2100-01-01'::date, 'team-1', repeat('0', 64),
         '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
      `SELECT public.upsert_daily_allocation_visit_v2(
         '${randomUUID()}'::uuid, NULL::uuid, '${randomUUID()}'::uuid, 1, 1,
         'project_number', '${DA2_ACTORS.jobA}'::uuid, NULL,
         '2100-01-01 09:00+00'::timestamptz, '2100-01-01 10:00+00'::timestamptz,
         NULL, NULL, NULL)`,
      `SELECT public.move_daily_allocation_visit_v2(
         '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, '${randomUUID()}'::uuid,
         1, 1, 1, '2100-01-01 09:00+00'::timestamptz,
         '2100-01-01 10:00+00'::timestamptz)`,
      `SELECT public.delete_daily_allocation_visit_v2(
         '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, 1, 1)`,
      `SELECT public.assign_daily_allocation_labour_v2(
         '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, '${DA2_ACTORS.employeeA}'::uuid,
         1, NULL, NULL, NULL, NULL, NULL)`,
      `SELECT public.unassign_daily_allocation_labour_v2(
         '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, 1, 1)`,
      `SELECT public.assign_daily_allocation_plant_v2(
         '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, 1, NULL, 'registered',
         '${DA2_ACTORS.plant}'::uuid, NULL, NULL, NULL, NULL)`,
      `SELECT public.unassign_daily_allocation_plant_v2(
         '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, 1, 1)`,
      `SELECT public.create_daily_allocation_conflict_override_v2(
         '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, 1, 'off_shift',
         'evidence', NULL, '${DA2_ACTORS.employeeA}'::uuid)`,
      `SELECT public.publish_daily_allocation_plan_v2(
         '${randomUUID()}'::uuid, '${randomUUID()}'::uuid, 1, 'closed', TRUE)`,
    ];
    for (const sql of closedCalls) {
      await expect(first.query(sql)).rejects.toThrow(/V2_DISABLED/);
    }

    const v1Id = randomUUID();
    await first.query(
      `INSERT INTO public.daily_labour_allocation_drafts (
         id, work_date, profile_id, job_source_type, job_source_id, job_code, site_address,
         start_time, row_version
       ) VALUES (
         $1::uuid, '2100-01-02', $2::uuid, 'project_number', $3::uuid,
         'ignored-by-canonicalization', 'ignored', '08:00', 1
       )`,
      [v1Id, DA2_ACTORS.employeeA, DA2_ACTORS.jobA]
    );

    await setFlags(true);
    await authenticate(first);
    const plan = await convertEmptyPlan(first, '2100-01-03', 'team-1');
    const replayRequest = randomUUID();
    const firstResult = await createVisit({
      client: first,
      planId: String(plan.plan_day_id),
      expectedPlanVersion: 1,
      jobId: DA2_ACTORS.jobA,
      workDate: '2100-01-03',
      startHour: 9,
      requestId: replayRequest,
    });
    await setFlags(false);
    await authenticate(first);
    await expect(
      createVisit({
        client: first,
        planId: String(plan.plan_day_id),
        expectedPlanVersion: 1,
        jobId: DA2_ACTORS.jobA,
        workDate: '2100-01-03',
        startHour: 9,
        requestId: replayRequest,
      })
    ).rejects.toThrow(/V2_DISABLED/);
    await setFlags(true);
    expect(firstResult.visit_id).toBeTruthy();
  }, 45_000);

  it('DAFP-DB-002: stale, incomplete, and invalid conversion preserve exact v1 source rows', async () => {
    const workDate = '2026-08-10';
    await authenticate(first);
    const source = await conversionSource(first, workDate, 'team-1');
    const labour = asArray(source.labour_drafts);
    const plant = asArray(source.plant_drafts);
    expect(labour).toHaveLength(1);
    expect(plant).toHaveLength(1);
    const visitId = randomUUID();
    const visits = [
      {
        visit_id: visitId,
        job_source_type: 'project_number',
        job_source_id: DA2_ACTORS.jobA,
        starts_at: `${workDate}T09:00:00Z`,
        ends_at: `${workDate}T10:00:00Z`,
      },
    ];
    const validLabour = [
      {
        draft_id: labour[0].id,
        row_version: labour[0].row_version,
        disposition: 'visit',
        visit_id: visitId,
      },
    ];
    const validPlant = [
      {
        draft_id: plant[0].id,
        row_version: plant[0].row_version,
        disposition: 'visit',
        visit_id: visitId,
      },
    ];
    const before = await v1Snapshot(workDate, 'team-1');

    const attempt = (requestId: string, fingerprint: string, labourInput: unknown) =>
      first.query(
        `SELECT public.convert_daily_allocation_plan_day_v2(
           $1::uuid, $2::date, 'team-1', $3,
           $4::jsonb, $5::jsonb, $6::jsonb
         )`,
        [
          requestId,
          workDate,
          fingerprint,
          JSON.stringify(visits),
          JSON.stringify(labourInput),
          JSON.stringify(validPlant),
        ]
      );

    await expect(
      attempt(randomUUID(), '0'.repeat(64), validLabour)
    ).rejects.toThrow(/SOURCE_FINGERPRINT_MISMATCH/);
    expect(await v1Snapshot(workDate, 'team-1')).toEqual(before);

    await authenticate(first);
    await expect(attempt(randomUUID(), String(source.source_fingerprint), [])).rejects.toThrow(
      /CONVERSION_LABOUR_SOURCE_MISMATCH/
    );
    expect(await v1Snapshot(workDate, 'team-1')).toEqual(before);

    await authenticate(first);
    await expect(
      attempt(randomUUID(), String(source.source_fingerprint), [
        { ...validLabour[0], disposition: 'invalid' },
      ])
    ).rejects.toThrow(/CONVERSION_DISPOSITION_REQUIRED/);
    expect(await v1Snapshot(workDate, 'team-1')).toEqual(before);

    await asOwner(setup);
    const state = await setup.query<{ plans: number; requests: number }>(
      `SELECT
         (SELECT count(*)::int FROM public.daily_allocation_plan_days
          WHERE work_date = $1::date AND team_id = 'team-1') AS plans,
         (SELECT count(*)::int FROM private.daily_allocation_mutation_requests
          WHERE action = 'convert' AND result->>'work_date' = $1::text) AS requests`,
      [workDate]
    );
    expect(state.rows[0]).toEqual({ plans: 0, requests: 0 });
  }, 45_000);

  it('DAFP-DB-001: complete conversion returns authoritative IDs and versions', async () => {
    const workDate = '2100-01-12';
    const labourDraftId = randomUUID();
    const plantDraftId = randomUUID();
    const visitId = randomUUID();
    await setFlags(true);
    await asOwnerActor(setup);
    await setup.query(
      `INSERT INTO public.daily_labour_allocation_drafts (
         id, work_date, profile_id, job_source_type, job_source_id, job_code,
         site_address, start_time, row_version
       ) VALUES (
         $1::uuid, $2::date, $3::uuid, 'project_number', $4::uuid,
         '60001-MD', '12 Site Road, Town', '08:00', 1
       )`,
      [labourDraftId, workDate, DA2_ACTORS.employeeA, DA2_ACTORS.jobA]
    );
    await setup.query(
      `INSERT INTO public.daily_plant_allocation_drafts (
         id, work_date, plant_kind, plant_id, owner_team_id, job_source_type,
         job_source_id, job_code, site_address, row_version
       ) VALUES (
         $1::uuid, $2::date, 'registered', $3::uuid, 'team-1',
         'project_number', $4::uuid, '60001-MD', '12 Site Road, Town', 1
       )`,
      [plantDraftId, workDate, DA2_ACTORS.plant, DA2_ACTORS.jobA]
    );
    const before = await v1Snapshot(workDate, 'team-1');
    await authenticate(first);
    const source = await conversionSource(first, workDate, 'team-1');
    const converted = await first.query<{ result: unknown }>(
      `SELECT public.convert_daily_allocation_plan_day_v2(
         $1::uuid, $2::date, 'team-1', $3,
         $4::jsonb, $5::jsonb, $6::jsonb
       ) AS result`,
      [
        randomUUID(),
        workDate,
        source.source_fingerprint,
        JSON.stringify([{
          visit_id: visitId,
          job_source_type: 'project_number',
          job_source_id: DA2_ACTORS.jobA,
          starts_at: `${workDate}T08:00:00+00:00`,
          ends_at: `${workDate}T16:00:00+00:00`,
        }]),
        JSON.stringify([{
          draft_id: labourDraftId,
          row_version: 1,
          disposition: 'visit',
          visit_id: visitId,
        }]),
        JSON.stringify([{
          draft_id: plantDraftId,
          row_version: 1,
          disposition: 'visit',
          visit_id: visitId,
        }]),
      ]
    );
    const result = asObject(converted.rows[0]?.result);
    const visits = asArray(result.visits);
    const labour = asArray(result.labour_assignments);
    const plant = asArray(result.plant_assignments);
    expect(result.plan_day_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.plan_version).toBe(1);
    expect(result.team_id).toBe('team-1');
    expect(result.work_date).toBe(workDate);
    expect(visits).toHaveLength(1);
    expect(visits[0].id).toBe(visitId);
    expect(visits[0].row_version).toBe(1);
    expect(labour).toHaveLength(1);
    expect(labour[0].visit_id).toBe(visitId);
    expect(labour[0].row_version).toBe(1);
    expect(plant).toHaveLength(1);
    expect(plant[0].visit_id).toBe(visitId);
    expect(plant[0].row_version).toBe(1);
    expect(await v1Snapshot(workDate, 'team-1')).toEqual(before);
  }, 45_000);

  it('explicit unallocated dispositions accept JSON null without inferring visits', async () => {
    const workDate = '2026-08-10';
    await authenticate(first);
    const source = await conversionSource(first, workDate, 'team-1');
    const before = await v1Snapshot(workDate, 'team-1');
    const labour = asArray(source.labour_drafts);
    const plant = asArray(source.plant_drafts);
    const converted = await first.query<{ result: Record<string, unknown> }>(
      `SELECT public.convert_daily_allocation_plan_day_v2(
         $1::uuid, $2::date, 'team-1', $3,
         '[]'::jsonb, $4::jsonb, $5::jsonb
       ) AS result`,
      [
        randomUUID(),
        workDate,
        source.source_fingerprint,
        JSON.stringify([{
          draft_id: labour[0].id,
          row_version: labour[0].row_version,
          disposition: 'unallocated',
          visit_id: null,
        }]),
        JSON.stringify([{
          draft_id: plant[0].id,
          row_version: plant[0].row_version,
          disposition: 'unallocated',
          visit_id: null,
        }]),
      ]
    );
    expect(asArray(converted.rows[0]?.result.visits)).toEqual([]);
    expect(asArray(converted.rows[0]?.result.labour_assignments)).toEqual([]);
    expect(asArray(converted.rows[0]?.result.plant_assignments)).toEqual([]);
    expect(await v1Snapshot(workDate, 'team-1')).toEqual(before);
  }, 45_000);

  it('DAFP-DB-003: conversion holds the shared team/date lock against labour and plant v1 writes', async () => {
    const cases = [
      {
        date: '2100-01-10',
        insert: (client: Client) =>
          client.query(
            `INSERT INTO public.daily_labour_allocation_drafts (
               id, work_date, profile_id, job_source_type, job_source_id, job_code,
               site_address, start_time
             ) VALUES ($1::uuid, $2::date, $3::uuid, 'project_number', $4::uuid,
               '60001-MD', '12 Site Road, Town', '08:00')`,
            [randomUUID(), '2100-01-10', DA2_ACTORS.employeeA, DA2_ACTORS.jobA]
          ),
        countSql:
          `SELECT count(*)::int AS count FROM public.daily_labour_allocation_drafts
           WHERE work_date = '2100-01-10'`,
      },
      {
        date: '2100-01-11',
        insert: (client: Client) =>
          client.query(
            `INSERT INTO public.daily_plant_allocation_drafts (
               id, work_date, plant_kind, plant_id, owner_team_id, job_source_type,
               job_source_id, job_code, site_address
             ) VALUES ($1::uuid, $2::date, 'registered', $3::uuid, 'team-1',
               'project_number', $4::uuid, '60001-MD', '12 Site Road, Town')`,
            [randomUUID(), '2100-01-11', DA2_ACTORS.plant, DA2_ACTORS.jobA]
          ),
        countSql:
          `SELECT count(*)::int AS count FROM public.daily_plant_allocation_drafts
           WHERE work_date = '2100-01-11'`,
      },
    ];

    for (const testCase of cases) {
      await authenticate(first);
      await authenticate(second);
      const source = await conversionSource(first, testCase.date, 'team-1');
      await first.query('BEGIN');
      const converted = await first.query(
        `SELECT public.convert_daily_allocation_plan_day_v2(
           $1::uuid, $2::date, 'team-1', $3,
           '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
         )`,
        [randomUUID(), testCase.date, source.source_fingerprint]
      );
      expect(converted.rowCount).toBe(1);
      const [blocker, blocked] = await Promise.all([
        first.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'),
        second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'),
      ]);
      const writer = testCase.insert(second);
      await waitUntilBlockedBy(
        third,
        blocked.rows[0].pid,
        blocker.rows[0].pid,
        `DAFP-DB-003 ${testCase.date}`
      );
      await first.query('COMMIT');
      await expect(writer).rejects.toThrow(/V1_WRITES_DISABLED/);
      await asOwner(setup);
      const count = await setup.query<{ count: number }>(testCase.countSql);
      expect(count.rows[0]?.count).toBe(0);
    }
  }, 45_000);

  it('DAFP-IDEM-001: ambiguous replay is singular and returns the stored result', async () => {
    await authenticate(first);
    const plan = await convertEmptyPlan(first, '2100-01-20', 'team-1');
    const planId = String(plan.plan_day_id);
    const requestId = randomUUID();
    const call = () =>
      createVisit({
        client: first,
        planId,
        expectedPlanVersion: 1,
        jobId: DA2_ACTORS.jobA,
        workDate: '2100-01-20',
        startHour: 9,
        requestId,
      });

    const ambiguousResult = await call();
    const replayedResult = await call();
    expect(replayedResult).toEqual(ambiguousResult);

    await asOwner(setup);
    const state = await setup.query<{ requests: number; visits: number; plan_version: number }>(
      `SELECT
         (SELECT count(*)::int FROM private.daily_allocation_mutation_requests
          WHERE request_id = $1::uuid) AS requests,
         (SELECT count(*)::int FROM public.daily_allocation_visits
          WHERE plan_day_id = $2::uuid) AS visits,
         (SELECT plan_version FROM public.daily_allocation_plan_days
          WHERE id = $2::uuid) AS plan_version`,
      [requestId, planId]
    );
    expect(state.rows[0]).toEqual({ requests: 1, visits: 1, plan_version: 2 });
  }, 30_000);

  it('DAFP-IDEM-002: changed actor, action, payload, or version reuse is rejected', async () => {
    await authenticate(first);
    const plan = await convertEmptyPlan(first, '2100-01-28', 'team-1');
    const planId = String(plan.plan_day_id);
    const requestId = randomUUID();
    await createVisit({
      client: first,
      planId,
      expectedPlanVersion: 1,
      jobId: DA2_ACTORS.jobA,
      workDate: '2100-01-28',
      startHour: 9,
      requestId,
    });

    await expect(
      createVisit({
        client: first,
        planId,
        expectedPlanVersion: 2,
        jobId: DA2_ACTORS.jobA,
        workDate: '2100-01-28',
        startHour: 9,
        requestId,
      })
    ).rejects.toThrow(/REQUEST_ID_REUSED/);

    await expect(
      first.query(
        `SELECT public.delete_daily_allocation_visit_v2($1::uuid, $2::uuid, 2, 1)`,
        [requestId, randomUUID()]
      )
    ).rejects.toThrow(/REQUEST_ID_REUSED/);

    await authenticate(second, MANAGER_TWO);
    await expect(
      createVisit({
        client: second,
        planId,
        expectedPlanVersion: 1,
        jobId: DA2_ACTORS.jobA,
        workDate: '2100-01-28',
        startHour: 9,
        requestId,
      })
    ).rejects.toThrow(/REQUEST_ID_REUSED/);
  }, 30_000);

  it('DAFP-CAS-001: stale plan, visit, labour, and plant versions fail atomically', async () => {
    await authenticate(first);
    const plan = await convertEmptyPlan(first, '2100-01-21', 'team-1');
    const planId = String(plan.plan_day_id);
    const visit = await createVisit({
      client: first,
      planId,
      expectedPlanVersion: 1,
      jobId: DA2_ACTORS.jobA,
      workDate: '2100-01-21',
      startHour: 9,
    });
    const visitId = String(visit.visit_id);
    const labour = await first.query<{ result: unknown }>(
      `SELECT public.assign_daily_allocation_labour_v2(
         $1::uuid, $2::uuid, $3::uuid, 2, NULL, NULL, NULL, NULL, NULL
       ) AS result`,
      [randomUUID(), visitId, DA2_ACTORS.employeeA]
    );
    const labourResult = asObject(labour.rows[0]?.result);
    const plant = await first.query<{ result: unknown }>(
      `SELECT public.assign_daily_allocation_plant_v2(
         $1::uuid, $2::uuid, 3, NULL, 'registered', $3::uuid, NULL, NULL, NULL, NULL
       ) AS result`,
      [randomUUID(), visitId, PLANT_TWO]
    );
    const plantResult = asObject(plant.rows[0]?.result);
    const before = await mutationSnapshot(planId);

    await authenticate(first);
    await expect(
      createVisit({
        client: first,
        planId,
        expectedPlanVersion: 3,
        jobId: DA2_ACTORS.jobA,
        workDate: '2100-01-21',
        startHour: 10,
        visitId,
        expectedRowVersion: 1,
      })
    ).rejects.toThrow(/STALE_PLAN_VERSION/);
    expect(await mutationSnapshot(planId)).toEqual(before);

    await authenticate(first);
    await expect(
      createVisit({
        client: first,
        planId,
        expectedPlanVersion: 4,
        jobId: DA2_ACTORS.jobA,
        workDate: '2100-01-21',
        startHour: 10,
        visitId,
        expectedRowVersion: 99,
      })
    ).rejects.toThrow(/STALE_ENTITY_VERSION/);
    expect(await mutationSnapshot(planId)).toEqual(before);

    await authenticate(first);
    await expect(
      first.query(
        `SELECT public.assign_daily_allocation_labour_v2(
           $1::uuid, $2::uuid, $3::uuid, 4, 99, 'changed', NULL, NULL, NULL
         )`,
        [randomUUID(), visitId, DA2_ACTORS.employeeA]
      )
    ).rejects.toThrow(/STALE_ENTITY_VERSION/);
    expect(await mutationSnapshot(planId)).toEqual(before);

    const labourAssignment = asObject(labourResult.assignment);
    await authenticate(first);
    await expect(
      first.query(
        `SELECT public.unassign_daily_allocation_labour_v2(
           $1::uuid, $2::uuid, 4, NULL
         )`,
        [randomUUID(), labourAssignment.id]
      )
    ).rejects.toThrow(/STALE_ENTITY_VERSION/);
    expect(await mutationSnapshot(planId)).toEqual(before);

    const plantAssignment = asObject(plantResult.assignment);
    await authenticate(first);
    await expect(
      first.query(
        `SELECT public.unassign_daily_allocation_plant_v2(
           $1::uuid, $2::uuid, 4, 99
         )`,
        [randomUUID(), plantAssignment.id]
      )
    ).rejects.toThrow(/STALE_ENTITY_VERSION/);
    expect(await mutationSnapshot(planId)).toEqual(before);
    await expect(
      first.query(
        `SELECT public.unassign_daily_allocation_plant_v2(
           $1::uuid, $2::uuid, 4, NULL
         )`,
        [randomUUID(), plantAssignment.id]
      )
    ).rejects.toThrow(/STALE_ENTITY_VERSION/);
    expect(await mutationSnapshot(planId)).toEqual(before);
    await authenticate(first);
    await expect(
      first.query(
        `SELECT public.assign_daily_allocation_plant_v2(
           $1::uuid, $2::uuid, 4, 99, 'registered', $3::uuid, NULL, NULL, NULL, 'changed'
         )`,
        [randomUUID(), visitId, PLANT_TWO]
      )
    ).rejects.toThrow(/STALE_ENTITY_VERSION/);
    expect(await mutationSnapshot(planId)).toEqual(before);
    await authenticate(first);
    const plantUpdate = await first.query<{ result: unknown }>(
      `SELECT public.assign_daily_allocation_plant_v2(
         $1::uuid, $2::uuid, 4, 1, 'registered', $3::uuid, NULL, NULL, NULL, 'updated notes'
       ) AS result`,
      [randomUUID(), visitId, PLANT_TWO]
    );
    expect(asObject(asObject(plantUpdate.rows[0]?.result).assignment).row_version).toBe(2);
    expect(asObject(asObject(plantUpdate.rows[0]?.result).assignment).notes).toBe('updated notes');
    expect(labourAssignment.row_version).toBe(1);
  }, 45_000);

  it('DAFP-LOCK-001: ordered plan/resource/job locking terminates without deadlock or lost update', async () => {
    await authenticate(first);
    const plan = await convertEmptyPlan(first, '2100-01-22', 'team-1');
    const planId = String(plan.plan_day_id);
    const firstVisit = await createVisit({
      client: first,
      planId,
      expectedPlanVersion: 1,
      jobId: DA2_ACTORS.jobA,
      workDate: '2100-01-22',
      startHour: 9,
    });
    const secondVisit = await createVisit({
      client: first,
      planId,
      expectedPlanVersion: 2,
      jobId: DA2_ACTORS.jobA,
      workDate: '2100-01-22',
      startHour: 11,
    });
    await first.query(
      `SELECT public.assign_daily_allocation_plant_v2(
         $1::uuid, $2::uuid, 3, NULL, 'registered', $3::uuid, NULL, NULL, NULL, NULL
       )`,
      [randomUUID(), firstVisit.visit_id, DA2_ACTORS.plant]
    );
    await first.query(
      `SELECT public.assign_daily_allocation_plant_v2(
         $1::uuid, $2::uuid, 4, NULL, 'registered', $3::uuid, NULL, NULL, NULL, NULL
       )`,
      [randomUUID(), secondVisit.visit_id, PLANT_TWO]
    );

    await authenticate(first);
    await authenticate(second);
    const expectedVersion = 5;
    const settled = await Promise.race([
      Promise.allSettled([
        createVisit({
          client: first,
          planId,
          expectedPlanVersion: expectedVersion,
          jobId: DA2_ACTORS.jobB,
          workDate: '2100-01-22',
          startHour: 9,
          visitId: String(firstVisit.visit_id),
          expectedRowVersion: 1,
        }),
        createVisit({
          client: second,
          planId,
          expectedPlanVersion: expectedVersion,
          jobId: DA2_ACTORS.jobB,
          workDate: '2100-01-22',
          startHour: 11,
          visitId: String(secondVisit.visit_id),
          expectedRowVersion: 1,
        }),
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DAFP-LOCK-001 timed out')), 15_000)
      ),
    ]);
    const fulfilled = settled.filter((result) => result.status === 'fulfilled');
    const rejected = settled.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
      /STALE_PLAN_VERSION/
    );

    await asOwner(setup);
    const state = await setup.query<{
      plan_version: number;
      job_a: number;
      job_b: number;
      request_count: number;
    }>(
      `SELECT
         plan_days.plan_version,
         count(*) FILTER (WHERE visits.job_source_id = $2::uuid)::int AS job_a,
         count(*) FILTER (WHERE visits.job_source_id = $3::uuid)::int AS job_b,
         (SELECT count(*)::int FROM private.daily_allocation_mutation_requests requests
          WHERE requests.action = 'visit_upsert'
            AND (requests.result->>'plan_day_id')::uuid = $1::uuid) AS request_count
       FROM public.daily_allocation_plan_days plan_days
       JOIN public.daily_allocation_visits visits ON visits.plan_day_id = plan_days.id
       WHERE plan_days.id = $1::uuid
       GROUP BY plan_days.plan_version`,
      [planId, DA2_ACTORS.jobA, DA2_ACTORS.jobB]
    );
    expect(state.rows[0]).toEqual({
      plan_version: 6,
      job_a: 1,
      job_b: 1,
      request_count: 3,
    });
  }, 45_000);

  it('DAFP-PLANT-001: same-job reuse succeeds and concurrent distinct-job claims fail', async () => {
    await authenticate(first);
    const samePlan = await convertEmptyPlan(first, '2100-01-23', 'team-1');
    const samePlanId = String(samePlan.plan_day_id);
    const visitOne = await createVisit({
      client: first,
      planId: samePlanId,
      expectedPlanVersion: 1,
      jobId: DA2_ACTORS.jobA,
      workDate: '2100-01-23',
      startHour: 9,
    });
    const visitTwo = await createVisit({
      client: first,
      planId: samePlanId,
      expectedPlanVersion: 2,
      jobId: DA2_ACTORS.jobA,
      workDate: '2100-01-23',
      startHour: 11,
    });
    await first.query(
      `SELECT public.assign_daily_allocation_plant_v2(
         $1::uuid, $2::uuid, 3, NULL, 'registered', $3::uuid, NULL, NULL, NULL, NULL
       )`,
      [randomUUID(), visitOne.visit_id, DA2_ACTORS.plant]
    );
    await first.query(
      `SELECT public.assign_daily_allocation_plant_v2(
         $1::uuid, $2::uuid, 4, NULL, 'registered', $3::uuid, NULL, NULL, NULL, NULL
       )`,
      [randomUUID(), visitTwo.visit_id, DA2_ACTORS.plant]
    );
    await asOwner(setup);
    const sameClaim = await setup.query<{ ref_count: number }>(
      `SELECT ref_count FROM private.daily_allocation_plant_day_jobs
       WHERE work_date = '2100-01-23' AND plant_kind = 'registered'
         AND plant_id = $1::uuid`,
      [DA2_ACTORS.plant]
    );
    expect(sameClaim.rows[0]?.ref_count).toBe(2);

    const raceClaim = async (kind: 'registered' | 'hired', workDate: string) => {
      await authenticate(first);
      await authenticate(second, MANAGER_TWO);
      const [teamOnePlan, teamTwoPlan] = await Promise.all([
        convertEmptyPlan(first, workDate, 'team-1'),
        convertEmptyPlan(second, workDate, TEAM_TWO),
      ]);
      const [teamOneVisit, teamTwoVisit] = await Promise.all([
        createVisit({
          client: first,
          planId: String(teamOnePlan.plan_day_id),
          expectedPlanVersion: 1,
          jobId: DA2_ACTORS.jobA,
          workDate,
          startHour: 9,
        }),
        createVisit({
          client: second,
          planId: String(teamTwoPlan.plan_day_id),
          expectedPlanVersion: 1,
          jobId: DA2_ACTORS.jobB,
          workDate,
          startHour: 11,
        }),
      ]);
      const args =
        kind === 'registered'
          ? [kind, DA2_ACTORS.plant, null, null, null]
          : [kind, null, 'H-100', 'Hired excavator', 'Hire Co'];
      const assign = (client: Client, visitId: string) =>
        client.query(
          `SELECT public.assign_daily_allocation_plant_v2(
             $1::uuid, $2::uuid, 2, NULL, $3::text, $4::uuid,
             $5::text, $6::text, $7::text, NULL::text
           )`,
          [randomUUID(), visitId, ...args]
        );
      const settled = await Promise.race([
        Promise.allSettled([
          assign(first, String(teamOneVisit.visit_id)),
          assign(second, String(teamTwoVisit.visit_id)),
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`DAFP-PLANT-001 ${kind} timed out`)), 15_000)
        ),
      ]);
      expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = settled.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0].reason)).toMatch(/PLANT_JOB_CONFLICT/);
    };

    await raceClaim('registered', '2100-01-24');
    await raceClaim('hired', '2100-01-25');
  }, 60_000);

  it('DAFP-AUTH-001: manager writes succeed and employee/anon paths are denied', async () => {
    await authenticate(first, DA2_ACTORS.employeeA);
    await expect(convertEmptyPlan(first, '2100-01-26', 'team-1')).rejects.toThrow(
      /Manager-level daily allocation access is required|Not allowed/
    );
    await authenticate(first);
    const plan = await convertEmptyPlan(first, '2100-01-26', 'team-1');
    expect(plan.plan_day_id).toBeTruthy();
    await authenticate(second, DA2_ACTORS.employeeA);
    await expect(
      createVisit({
        client: second,
        planId: String(plan.plan_day_id),
        expectedPlanVersion: 1,
        jobId: DA2_ACTORS.jobA,
        workDate: '2100-01-26',
        startHour: 9,
      })
    ).rejects.toThrow(/Manager-level daily allocation access is required|Not allowed/);
    await asOwner(setup);
    const anonDenied = await setup.query<{ allowed: boolean }>(
      `SELECT has_table_privilege('authenticated', 'private.daily_allocation_mutation_requests', 'SELECT') AS allowed`
    );
    expect(anonDenied.rows[0]?.allowed).toBe(false);
  }, 30_000);

  it('DAFP-PUB-001: published snapshots and recipients stay immutable', async () => {
    await authenticate(first);
    const plan = await convertEmptyPlan(first, '2100-01-27', 'team-1');
    const visit = await createVisit({
      client: first,
      planId: String(plan.plan_day_id),
      expectedPlanVersion: 1,
      jobId: DA2_ACTORS.jobA,
      workDate: '2100-01-27',
      startHour: 9,
    });
    await first.query(
      `SELECT public.assign_daily_allocation_labour_v2(
         $1::uuid, $2::uuid, $3::uuid, 2, NULL, NULL, NULL, NULL, NULL
       )`,
      [randomUUID(), visit.visit_id, DA2_ACTORS.employeeA]
    );
    const published = await first.query<{ result: unknown }>(
      `SELECT public.publish_daily_allocation_plan_v2(
         $1::uuid, $2::uuid, 3, $3::text, TRUE
       ) AS result`,
      [randomUUID(), plan.plan_day_id, `pub-2100-01-27-${randomUUID()}`]
    );
    const publicationId = String(asObject(published.rows[0]?.result).publication_id);
    expect(publicationId).toMatch(/^[0-9a-f-]{36}$/i);
    await authenticate(first);
    await expect(
      first.query(
        `UPDATE public.daily_allocation_publications
         SET revision_no = 99 WHERE id = $1::uuid`,
        [publicationId]
      )
    ).rejects.toThrow();
    await expect(
      first.query(
        `UPDATE public.daily_allocation_published_labour
         SET notes = 'tampered' WHERE publication_id = $1::uuid`,
        [publicationId]
      )
    ).rejects.toThrow();
    await expect(
      first.query(
        `UPDATE public.daily_allocation_publication_notifications
         SET user_id = $2::uuid WHERE publication_id = $1::uuid`,
        [publicationId, DA2_ACTORS.employeeB]
      )
    ).rejects.toThrow();
    await asOwner(setup);
    const frozen = await setup.query<{ revision_no: number; labour_notes: string | null }>(
      `SELECT publications.revision_no, labour.notes AS labour_notes
       FROM public.daily_allocation_publications publications
       LEFT JOIN public.daily_allocation_published_labour labour
         ON labour.publication_id = publications.id
       WHERE publications.id = $1::uuid`,
      [publicationId]
    );
    expect(frozen.rows[0]?.revision_no).toBe(1);
    expect(frozen.rows[0]?.labour_notes).not.toBe('tampered');
  }, 45_000);
});
