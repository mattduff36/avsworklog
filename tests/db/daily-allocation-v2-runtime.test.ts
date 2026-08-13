import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DA2_ACTORS,
  DA2_PGLITE_BASE_PATH,
  DA2_V2_MIGRATION_PATH,
  applyDailyAllocationV2Migration,
  createDailyAllocationV2Pglite,
  enableDailyAllocationV2,
  hashDailyAllocationV1Content,
  withAuthenticatedRole,
  type DailyAllocationV1ContentHash,
} from './daily-allocation-v2-pglite-harness';
import type { PGlite } from '@electric-sql/pglite';

const START = '2026-08-14 09:00:00+01';
const END = '2026-08-14 12:00:00+01';
const MOVE_START = '2026-08-17 09:00:00+01';
const MOVE_END = '2026-08-17 12:00:00+01';
const ADJACENT_END = '2026-08-14 09:30:00+01';
const INVALID = '2026-08-14 09:17:00+01';
const DST_START = '2026-03-29 09:00:00+01';
const DST_END = '2026-03-29 09:30:00+01';

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  throw new Error(`Expected JSON object, received ${typeof value}`);
}

describe('DA2 isolated PGlite runtime', () => {
  let pg: PGlite;
  let v1Before: DailyAllocationV1ContentHash;
  let sourcePlanId = '';
  let targetPlanId = '';
  let visitId = '';

  beforeAll(async () => {
    pg = await createDailyAllocationV2Pglite();
    v1Before = await hashDailyAllocationV1Content(pg);
    await applyDailyAllocationV2Migration(pg);
    await applyDailyAllocationV2Migration(pg);
  }, 120_000);

  afterAll(async () => {
    await pg?.close();
  });

  it('applies the additive migration twice without changing v1 row counts or content hashes', async () => {
    const after = await hashDailyAllocationV1Content(pg);
    expect(after).toEqual(v1Before);
    expect(after.labour_count).toBeGreaterThan(0);
    expect(after.plant_count).toBeGreaterThan(0);
  });

  it('defaults the runtime gate closed and withholds private-table access from authenticated', async () => {
    const runtime = await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query<{ board_enabled: boolean; writes_enabled: boolean }>(
        'SELECT * FROM public.get_daily_allocation_v2_runtime()'
      )
    );
    expect(runtime.rows[0]).toEqual({ board_enabled: false, writes_enabled: false });

    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.query('SELECT board_enabled FROM private.daily_allocation_v2_runtime')
      )
    ).rejects.toThrow();
  });

  it('keeps v1 labour draft writes working and blocks convert while the gate is closed', async () => {
    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.query(`SELECT public.convert_daily_allocation_plan_day_v2('2026-08-14', 'team-1')`)
      )
    ).rejects.toThrow(/V2_DISABLED/);

    const inserted = await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query<{ id: string }>(`
        INSERT INTO public.daily_labour_allocation_drafts (
          work_date, profile_id, job_source_type, job_source_id, job_code, site_address, start_time
        ) VALUES (
          '2026-08-11',
          '${DA2_ACTORS.employeeB}'::uuid,
          'project_number',
          '${DA2_ACTORS.jobA}'::uuid,
          '60001-MD',
          '12 Site Road, Town',
          '08:00'
        )
        RETURNING id::text
      `)
    );
    expect(inserted.rows[0].id).toBeTruthy();
  });

  it('denies authenticated direct v2 table writes and snapshot_version=2 publication inserts', async () => {
    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.exec(`
          INSERT INTO public.daily_allocation_plan_days (work_date, team_id, converted_by)
          VALUES ('2026-08-14', 'team-1', '${DA2_ACTORS.manager}');
        `)
      )
    ).rejects.toThrow();

    await enableDailyAllocationV2(pg);
    await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () => {
      const converted = await pg.query<{ convert_daily_allocation_plan_day_v2: string }>(
        `SELECT public.convert_daily_allocation_plan_day_v2('2026-08-14', 'team-1')`
      );
      sourcePlanId = converted.rows[0].convert_daily_allocation_plan_day_v2;
    });

    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.exec(`
          INSERT INTO public.daily_allocation_publications (
            work_date, revision_no, idempotency_key, published_by, snapshot_version, plan_day_id
          ) VALUES (
            '2026-08-14', 1, 'direct-v2', '${DA2_ACTORS.manager}', 2, '${sourcePlanId}'
          );
        `)
      )
    ).rejects.toThrow(/row-level security|V2 publication|snapshot_version|policy/i);
  });

  it('allows authorized RPC writes after the gate is enabled', async () => {
    const created = await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query<{ upsert_daily_allocation_visit_v2: unknown }>(`
        SELECT public.upsert_daily_allocation_visit_v2(
          NULL,
          '${sourcePlanId}'::uuid,
          1,
          1,
          'project_number',
          '${DA2_ACTORS.jobA}'::uuid,
          '60001-MD',
          TIMESTAMPTZ '${START}',
          TIMESTAMPTZ '${END}',
          NULL,
          NULL,
          NULL
        ) AS upsert_daily_allocation_visit_v2
      `)
    );
    visitId = String(asRecord(created.rows[0].upsert_daily_allocation_visit_v2).visit_id);
    expect(visitId).toMatch(/^[0-9a-f-]{36}$/i);

    await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () => {
      await pg.query(`
        SELECT public.assign_daily_allocation_labour_v2(
          '${visitId}'::uuid,
          '${DA2_ACTORS.employeeA}'::uuid,
          2,
          NULL, NULL, NULL, NULL
        )
      `);
      await pg.query(`
        SELECT public.assign_daily_allocation_plant_v2(
          '${visitId}'::uuid,
          3,
          'registered',
          '${DA2_ACTORS.plant}'::uuid,
          NULL, NULL, NULL, NULL
        )
      `);
    });
  });

  it('rejects 09:17 and accepts adjacent 09:00/09:30 London bounds, including DST', async () => {
    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.query(`
          SELECT public.upsert_daily_allocation_visit_v2(
            '${visitId}'::uuid,
            '${sourcePlanId}'::uuid,
            4,
            1,
            'project_number',
            '${DA2_ACTORS.jobA}'::uuid,
            '60001-MD',
            TIMESTAMPTZ '${INVALID}',
            TIMESTAMPTZ '${END}',
            NULL, NULL, NULL
          )
        `)
      )
    ).rejects.toThrow(/Invalid visit interval/i);

    const valid = await pg.query<{ ok: boolean }>(`
      SELECT private.daily_allocation_interval_is_valid(
        '2026-08-14',
        TIMESTAMPTZ '${START}',
        TIMESTAMPTZ '${ADJACENT_END}'
      ) AS ok
    `);
    expect(valid.rows[0].ok).toBe(true);

    const dst = await pg.query<{ ok: boolean }>(`
      SELECT private.daily_allocation_interval_is_valid(
        '2026-03-29',
        TIMESTAMPTZ '${DST_START}',
        TIMESTAMPTZ '${DST_END}'
      ) AS ok
    `);
    expect(dst.rows[0].ok).toBe(true);
  });

  it('raises stale plan/entity versions and labour exclusion conflicts', async () => {
    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.query(`
          SELECT public.upsert_daily_allocation_visit_v2(
            '${visitId}'::uuid,
            '${sourcePlanId}'::uuid,
            1,
            1,
            'project_number',
            '${DA2_ACTORS.jobA}'::uuid,
            '60001-MD',
            TIMESTAMPTZ '${START}',
            TIMESTAMPTZ '${END}',
            NULL, NULL, NULL
          )
        `)
      )
    ).rejects.toThrow(/STALE_PLAN_VERSION/);

    const overlap = await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query<{ upsert_daily_allocation_visit_v2: unknown }>(`
        SELECT public.upsert_daily_allocation_visit_v2(
          NULL,
          '${sourcePlanId}'::uuid,
          4,
          1,
          'project_number',
          '${DA2_ACTORS.jobB}'::uuid,
          '60002-MD',
          TIMESTAMPTZ '${START}',
          TIMESTAMPTZ '${END}',
          NULL, NULL, NULL
        ) AS upsert_daily_allocation_visit_v2
      `)
    );
    const overlapVisitId = String(asRecord(overlap.rows[0].upsert_daily_allocation_visit_v2).visit_id);
    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.query(`
          SELECT public.assign_daily_allocation_labour_v2(
            '${overlapVisitId}'::uuid,
            '${DA2_ACTORS.employeeA}'::uuid,
            5,
            NULL, NULL, NULL, NULL
          )
        `)
      )
    ).rejects.toThrow(/23P01|exclusion|overlap/i);
  });

  it('requires current conflict-bound overrides and evaluates every applicable absence', async () => {
    const planResult = await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query<{ convert_daily_allocation_plan_day_v2: string }>(
        `SELECT public.convert_daily_allocation_plan_day_v2('2026-08-19', 'team-1')`
      )
    );
    const planId = planResult.rows[0].convert_daily_allocation_plan_day_v2;
    const created = await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query<{ upsert_daily_allocation_visit_v2: unknown }>(`
        SELECT public.upsert_daily_allocation_visit_v2(
          NULL,
          '${planId}'::uuid,
          1,
          1,
          'project_number',
          '${DA2_ACTORS.jobA}'::uuid,
          '60001-MD',
          TIMESTAMPTZ '2026-08-19 09:00:00+01',
          TIMESTAMPTZ '2026-08-19 12:00:00+01',
          NULL, NULL, NULL
        ) AS upsert_daily_allocation_visit_v2
      `)
    );
    const createdRow = asRecord(created.rows[0].upsert_daily_allocation_visit_v2);
    const conflictVisitId = String(createdRow.visit_id);

    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.query(`
          SELECT public.create_daily_allocation_conflict_override_v2(
            '${planId}'::uuid,
            2,
            'pending_absence',
            'No warning exists',
            '${conflictVisitId}'::uuid,
            '${DA2_ACTORS.employeeB}'::uuid
          )
        `)
      )
    ).rejects.toThrow(/CONFLICT_NOT_PRESENT/);

    await pg.exec(`
      INSERT INTO public.absences (
        id, profile_id, reason_id, date, end_date, is_half_day, half_day_session,
        status, created_at, updated_at
      ) VALUES (
        'a1111111-1111-4111-8111-111111111111',
        '${DA2_ACTORS.employeeB}'::uuid,
        '77777777-7777-4777-8777-777777777777',
        '2026-08-19',
        '2026-08-19',
        FALSE,
        NULL,
        'pending',
        '2026-08-13 08:00:00+00',
        '2026-08-13 08:00:00+00'
      );
    `);

    const firstOverride = await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query<{ create_daily_allocation_conflict_override_v2: string }>(`
        SELECT public.create_daily_allocation_conflict_override_v2(
          '${planId}'::uuid,
          2,
          'pending_absence',
          'Manager confirmed pending absence',
          '${conflictVisitId}'::uuid,
          '${DA2_ACTORS.employeeB}'::uuid
        )
      `)
    );

    await pg.exec(`
      INSERT INTO public.absences (
        id, profile_id, reason_id, date, end_date, is_half_day, half_day_session,
        status, created_at, updated_at
      ) VALUES (
        'a2222222-2222-4222-8222-222222222222',
        '${DA2_ACTORS.employeeB}'::uuid,
        '77777777-7777-4777-8777-777777777777',
        '2026-08-19',
        '2026-08-19',
        TRUE,
        'AM',
        'pending',
        '2026-08-13 09:00:00+00',
        '2026-08-13 09:00:00+00'
      );
    `);

    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.query(`
          SELECT public.assign_daily_allocation_labour_v2(
            '${conflictVisitId}'::uuid,
            '${DA2_ACTORS.employeeB}'::uuid,
            3,
            NULL, NULL, NULL,
            '${firstOverride.rows[0].create_daily_allocation_conflict_override_v2}'::uuid
          )
        `)
      )
    ).rejects.toThrow(/HARD_CONFLICT/);

    const refreshedOverride = await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query<{ create_daily_allocation_conflict_override_v2: string }>(`
        SELECT public.create_daily_allocation_conflict_override_v2(
          '${planId}'::uuid,
          3,
          'pending_absence',
          'Manager reconfirmed all pending absences',
          '${conflictVisitId}'::uuid,
          '${DA2_ACTORS.employeeB}'::uuid
        )
      `)
    );

    await pg.exec(`
      UPDATE public.absences
      SET updated_at = '2026-08-13 10:00:00+00'
      WHERE id = 'a1111111-1111-4111-8111-111111111111';
    `);
    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.query(`
          SELECT public.assign_daily_allocation_labour_v2(
            '${conflictVisitId}'::uuid,
            '${DA2_ACTORS.employeeB}'::uuid,
            4,
            NULL, NULL, NULL,
            '${refreshedOverride.rows[0].create_daily_allocation_conflict_override_v2}'::uuid
          )
        `)
      )
    ).rejects.toThrow(/HARD_CONFLICT/);

    await pg.exec(`
      DELETE FROM public.absences
      WHERE id IN (
        'a1111111-1111-4111-8111-111111111111',
        'a2222222-2222-4222-8222-222222222222'
      );
      INSERT INTO public.absences (
        id, profile_id, reason_id, date, end_date, is_half_day, half_day_session,
        status, created_at, updated_at
      ) VALUES
      (
        'a3333333-3333-4333-8333-333333333333',
        '${DA2_ACTORS.employeeB}'::uuid,
        '77777777-7777-4777-8777-777777777777',
        '2026-08-19', '2026-08-19', TRUE, 'AM', 'approved',
        '2026-08-13 08:00:00+00', '2026-08-13 08:00:00+00'
      ),
      (
        'a4444444-4444-4444-8444-444444444444',
        '${DA2_ACTORS.employeeB}'::uuid,
        '77777777-7777-4777-8777-777777777777',
        '2026-08-19', '2026-08-19', TRUE, 'PM', 'approved',
        '2026-08-13 09:00:00+00', '2026-08-13 09:00:00+00'
      );
    `);

    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.query(`
          SELECT public.assign_daily_allocation_labour_v2(
            '${conflictVisitId}'::uuid,
            '${DA2_ACTORS.employeeB}'::uuid,
            4,
            NULL, NULL, NULL, NULL
          )
        `)
      )
    ).rejects.toThrow(/HARD_CONFLICT/);
  });

  it('invalidates an off-shift override when the effective shift row changes', async () => {
    const planResult = await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query<{ convert_daily_allocation_plan_day_v2: string }>(
        `SELECT public.convert_daily_allocation_plan_day_v2('2026-08-22', 'team-1')`
      )
    );
    const planId = planResult.rows[0].convert_daily_allocation_plan_day_v2;
    const created = await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query<{ upsert_daily_allocation_visit_v2: unknown }>(`
        SELECT public.upsert_daily_allocation_visit_v2(
          NULL,
          '${planId}'::uuid,
          1,
          1,
          'project_number',
          '${DA2_ACTORS.jobA}'::uuid,
          '60001-MD',
          TIMESTAMPTZ '2026-08-22 09:00:00+01',
          TIMESTAMPTZ '2026-08-22 12:00:00+01',
          NULL, NULL, NULL
        ) AS upsert_daily_allocation_visit_v2
      `)
    );
    const visit = asRecord(created.rows[0].upsert_daily_allocation_visit_v2);
    const override = await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query<{ create_daily_allocation_conflict_override_v2: string }>(`
        SELECT public.create_daily_allocation_conflict_override_v2(
          '${planId}'::uuid,
          2,
          'off_shift',
          'Weekend attendance confirmed',
          '${String(visit.visit_id)}'::uuid,
          '${DA2_ACTORS.employeeB}'::uuid
        )
      `)
    );

    await pg.exec(`
      INSERT INTO public.employee_work_shifts (
        profile_id, saturday_am, saturday_pm, updated_at
      ) VALUES (
        '${DA2_ACTORS.employeeB}'::uuid,
        FALSE,
        FALSE,
        '2026-08-13 11:00:00+00'
      );
    `);

    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.query(`
          SELECT public.assign_daily_allocation_labour_v2(
            '${String(visit.visit_id)}'::uuid,
            '${DA2_ACTORS.employeeB}'::uuid,
            3,
            NULL, NULL, NULL,
            '${override.rows[0].create_daily_allocation_conflict_override_v2}'::uuid
          )
        `)
      )
    ).rejects.toThrow(/HARD_CONFLICT/);
  });

  it('moves a visit with labour and plant to another date and transitions plant claims', async () => {
    await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () => {
      const converted = await pg.query<{ convert_daily_allocation_plan_day_v2: string }>(
        `SELECT public.convert_daily_allocation_plan_day_v2('2026-08-17', 'team-1')`
      );
      targetPlanId = converted.rows[0].convert_daily_allocation_plan_day_v2;
    });

    const beforeClaims = await pg.query<{ work_date: string; ref_count: number; job_code: string }>(`
      SELECT work_date::text, ref_count, job_code
      FROM private.daily_allocation_plant_day_jobs
      WHERE plant_id = '${DA2_ACTORS.plant}'::uuid
      ORDER BY work_date
    `);
    expect(beforeClaims.rows.some((row) => row.work_date === '2026-08-14')).toBe(true);

    const sourceVersion = await pg.query<{ plan_version: number }>(
      `SELECT plan_version FROM public.daily_allocation_plan_days WHERE id = '${sourcePlanId}'::uuid`
    );
    const targetVersion = await pg.query<{ plan_version: number }>(
      `SELECT plan_version FROM public.daily_allocation_plan_days WHERE id = '${targetPlanId}'::uuid`
    );
    const visitVersion = await pg.query<{ row_version: number }>(
      `SELECT row_version FROM public.daily_allocation_visits WHERE id = '${visitId}'::uuid`
    );

    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.query(`
          SELECT public.move_daily_allocation_visit_v2(
            '${visitId}'::uuid,
            '${targetPlanId}'::uuid,
            ${sourceVersion.rows[0].plan_version + 9},
            ${targetVersion.rows[0].plan_version},
            ${visitVersion.rows[0].row_version},
            TIMESTAMPTZ '${MOVE_START}',
            TIMESTAMPTZ '${MOVE_END}'
          )
        `)
      )
    ).rejects.toThrow(/STALE_PLAN_VERSION/);

    const moved = await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query<{ move_daily_allocation_visit_v2: unknown }>(`
        SELECT public.move_daily_allocation_visit_v2(
          '${visitId}'::uuid,
          '${targetPlanId}'::uuid,
          ${sourceVersion.rows[0].plan_version},
          ${targetVersion.rows[0].plan_version},
          ${visitVersion.rows[0].row_version},
          TIMESTAMPTZ '${MOVE_START}',
          TIMESTAMPTZ '${MOVE_END}'
        ) AS move_daily_allocation_visit_v2
      `)
    );
    const movedRow = asRecord(moved.rows[0].move_daily_allocation_visit_v2);
    expect(movedRow.source_plan_version).toBe(sourceVersion.rows[0].plan_version + 1);
    expect(movedRow.target_plan_version).toBe(targetVersion.rows[0].plan_version + 1);

    const afterClaims = await pg.query<{ work_date: string; ref_count: number }>(`
      SELECT work_date::text, ref_count
      FROM private.daily_allocation_plant_day_jobs
      WHERE plant_id = '${DA2_ACTORS.plant}'::uuid
        AND ref_count > 0
      ORDER BY work_date
    `);
    expect(afterClaims.rows.map((row) => row.work_date)).toEqual(['2026-08-17']);
    expect(afterClaims.rows[0].ref_count).toBe(1);

    const labour = await pg.query<{ work_date: string }>(`
      SELECT work_date::text FROM public.daily_allocation_visit_labour WHERE visit_id = '${visitId}'::uuid
    `);
    expect(labour.rows[0].work_date).toBe('2026-08-17');
  });

  it('transitions same-plan plant job claims and rejects a conflicting second job', async () => {
    const planVersion = await pg.query<{ plan_version: number }>(
      `SELECT plan_version FROM public.daily_allocation_plan_days WHERE id = '${targetPlanId}'::uuid`
    );
    const visitVersion = await pg.query<{ row_version: number }>(
      `SELECT row_version FROM public.daily_allocation_visits WHERE id = '${visitId}'::uuid`
    );

    await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query(`
        SELECT public.upsert_daily_allocation_visit_v2(
          '${visitId}'::uuid,
          '${targetPlanId}'::uuid,
          ${planVersion.rows[0].plan_version},
          ${visitVersion.rows[0].row_version},
          'project_number',
          '${DA2_ACTORS.jobB}'::uuid,
          '60002-MD',
          TIMESTAMPTZ '${MOVE_START}',
          TIMESTAMPTZ '${MOVE_END}',
          NULL, NULL, NULL
        )
      `)
    );

    const claim = await pg.query<{ job_code: string; ref_count: number }>(`
      SELECT job_code, ref_count
      FROM private.daily_allocation_plant_day_jobs
      WHERE plant_id = '${DA2_ACTORS.plant}'::uuid
        AND work_date = '2026-08-17'
        AND ref_count > 0
    `);
    expect(claim.rows[0]).toMatchObject({ job_code: '60002-MD', ref_count: 1 });

    const otherVisit = await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query<{ upsert_daily_allocation_visit_v2: unknown }>(`
        SELECT public.upsert_daily_allocation_visit_v2(
          NULL,
          '${targetPlanId}'::uuid,
          (SELECT plan_version FROM public.daily_allocation_plan_days WHERE id = '${targetPlanId}'::uuid),
          1,
          'project_number',
          '${DA2_ACTORS.jobA}'::uuid,
          '60001-MD',
          TIMESTAMPTZ '2026-08-17 13:00:00+01',
          TIMESTAMPTZ '2026-08-17 16:00:00+01',
          NULL, NULL, NULL
        ) AS upsert_daily_allocation_visit_v2
      `)
    );
    const otherVisitRow = asRecord(otherVisit.rows[0].upsert_daily_allocation_visit_v2);

    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.query(`
          SELECT public.assign_daily_allocation_plant_v2(
            '${String(otherVisitRow.visit_id)}'::uuid,
            ${Number(otherVisitRow.plan_version)},
            'registered',
            '${DA2_ACTORS.plant}'::uuid,
            NULL, NULL, NULL, NULL
          )
        `)
      )
    ).rejects.toThrow(/PLANT_JOB_CONFLICT/);
  });

  it('rolls publish back atomically, then publishes once per employee with immutable snapshots', async () => {
    const plan = await pg.query<{ id: string; plan_version: number }>(`
      SELECT id::text, plan_version
      FROM public.daily_allocation_plan_days
      WHERE id = '${targetPlanId}'::uuid
    `);

    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.query(`
          SELECT public.publish_daily_allocation_plan_v2(
            '${plan.rows[0].id}'::uuid,
            ${plan.rows[0].plan_version},
            'pub-unallocated',
            FALSE
          )
        `)
      )
    ).rejects.toThrow(/CONFIRM_UNALLOCATED_REQUIRED/);

    const afterFail = await pg.query<{
      publications: number;
      snapshots: number;
      messages: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM public.daily_allocation_publications WHERE plan_day_id = '${plan.rows[0].id}'::uuid) AS publications,
        (SELECT COUNT(*)::int FROM public.daily_allocation_published_visits) AS snapshots,
        (SELECT COUNT(*)::int FROM public.messages WHERE created_via = 'daily_allocation_publish_v2') AS messages
    `);
    expect(afterFail.rows[0]).toEqual({ publications: 0, snapshots: 0, messages: 0 });

    const published = await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query<{ publish_daily_allocation_plan_v2: string }>(`
        SELECT public.publish_daily_allocation_plan_v2(
          '${plan.rows[0].id}'::uuid,
          ${plan.rows[0].plan_version},
          'pub-ok',
          TRUE
        ) AS publish_daily_allocation_plan_v2
      `)
    );
    const publicationId = published.rows[0].publish_daily_allocation_plan_v2;

    const fingerprint = await pg.query<{
      snapshot_fingerprint: string;
      persisted_fingerprint: string;
    }>(`
      SELECT
        publications.snapshot_fingerprint,
        private.daily_allocation_v2_persisted_fingerprint(publications.id) AS persisted_fingerprint
      FROM public.daily_allocation_publications publications
      WHERE publications.id = '${publicationId}'::uuid
    `);
    expect(fingerprint.rows[0].snapshot_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint.rows[0].persisted_fingerprint).toBe(
      fingerprint.rows[0].snapshot_fingerprint
    );

    const retry = await withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
      pg.query<{ publish_daily_allocation_plan_v2: string }>(`
        SELECT public.publish_daily_allocation_plan_v2(
          '${plan.rows[0].id}'::uuid,
          ${plan.rows[0].plan_version},
          'pub-ok',
          TRUE
        ) AS publish_daily_allocation_plan_v2
      `)
    );
    expect(retry.rows[0].publish_daily_allocation_plan_v2).toBe(publicationId);

    const notifications = await pg.query<{ profile_id: string }>(`
      SELECT profile_id::text
      FROM public.daily_allocation_publication_notifications
      WHERE publication_id = '${publicationId}'::uuid
      ORDER BY profile_id
    `);
    expect(notifications.rows.map((row) => row.profile_id).sort()).toEqual([
      DA2_ACTORS.manager,
      DA2_ACTORS.employeeA,
      DA2_ACTORS.employeeB,
    ].sort());

    const messages = await pg.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count
      FROM public.messages
      WHERE daily_allocation_publication_id = '${publicationId}'::uuid
        AND created_via = 'daily_allocation_publish_v2'
    `);
    expect(messages.rows[0].count).toBe(3);

    await expect(
      pg.exec(`
        UPDATE public.daily_allocation_publications
        SET snapshot_fingerprint = 'tamper'
        WHERE id = '${publicationId}'::uuid;
      `)
    ).rejects.toThrow(/cannot be changed/i);

    await expect(
      withAuthenticatedRole(pg, DA2_ACTORS.manager, async () =>
        pg.query(`
          SELECT public.publish_daily_allocation_plan_v2(
            '${plan.rows[0].id}'::uuid,
            ${plan.rows[0].plan_version},
            'pub-other',
            TRUE
          )
        `)
      )
    ).rejects.toThrow(/STALE_PLAN_VERSION/);
  });
});

const describeConcurrency = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeConcurrency('DA2 TEST_DATABASE_URL concurrency suite', () => {
  const connectionString = process.env.TEST_DATABASE_URL || '';
  const clients: Client[] = [];
  let setupClient: Client;
  let firstClient: Client;
  let secondClient: Client;
  let planDayId = '';
  let originalBoardEnabled = false;
  let originalWritesEnabled = false;
  let runtimeCaptured = false;
  const workDate = (() => {
    const offset = Number.parseInt(randomUUID().slice(0, 8), 16) % 30_000;
    const date = new Date(Date.UTC(2100, 0, 1 + offset));
    return date.toISOString().slice(0, 10);
  })();

  function createClient(): Client {
    const url = new URL(connectionString);
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return new Client({
      connectionString,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    });
  }

  async function connectClient(): Promise<Client> {
    const client = createClient();
    await client.connect();
    clients.push(client);
    return client;
  }

  async function authenticate(client: Client): Promise<void> {
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [
      DA2_ACTORS.manager,
    ]);
    await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: DA2_ACTORS.manager }),
    ]);
    await client.query('SET ROLE authenticated');
    await client.query(`SET statement_timeout = '10s'`);
    await client.query(`SET lock_timeout = '8s'`);
  }

  beforeAll(async () => {
    setupClient = await connectClient();
    await setupClient.query(readFileSync(DA2_PGLITE_BASE_PATH, 'utf8'));
    await setupClient.query(readFileSync(DA2_V2_MIGRATION_PATH, 'utf8'));
    await setupClient.query(readFileSync(DA2_V2_MIGRATION_PATH, 'utf8'));

    const runtime = await setupClient.query<{
      board_enabled: boolean;
      writes_enabled: boolean;
    }>(`
      SELECT board_enabled, writes_enabled
      FROM private.daily_allocation_v2_runtime
      WHERE singleton = TRUE
    `);
    originalBoardEnabled = runtime.rows[0]?.board_enabled ?? false;
    originalWritesEnabled = runtime.rows[0]?.writes_enabled ?? false;
    runtimeCaptured = true;
    await setupClient.query(`
      UPDATE private.daily_allocation_v2_runtime
      SET board_enabled = TRUE, writes_enabled = TRUE, updated_at = NOW()
      WHERE singleton = TRUE
    `);

    await authenticate(setupClient);
    const converted = await setupClient.query<{ plan_day_id: string }>(
      `
        SELECT public.convert_daily_allocation_plan_day_v2($1::date, 'team-1') AS plan_day_id
      `,
      [workDate]
    );
    planDayId = converted.rows[0].plan_day_id;

    await setupClient.query(
      `
        SELECT public.upsert_daily_allocation_visit_v2(
          NULL, $1::uuid, 1, 1, 'project_number', $2::uuid, '60001-MD',
          ($3::date + TIME '09:00') AT TIME ZONE 'Europe/London',
          ($3::date + TIME '12:00') AT TIME ZONE 'Europe/London',
          NULL, NULL, NULL
        )
      `,
      [planDayId, DA2_ACTORS.jobA, workDate]
    );
    await setupClient.query(
      `
        SELECT public.upsert_daily_allocation_visit_v2(
          NULL, $1::uuid, 2, 1, 'project_number', $2::uuid, '60002-MD',
          ($3::date + TIME '10:00') AT TIME ZONE 'Europe/London',
          ($3::date + TIME '13:00') AT TIME ZONE 'Europe/London',
          NULL, NULL, NULL
        )
      `,
      [planDayId, DA2_ACTORS.jobB, workDate]
    );
    await setupClient.query('RESET ROLE');

    firstClient = await connectClient();
    secondClient = await connectClient();
    await authenticate(firstClient);
    await authenticate(secondClient);
  }, 120_000);

  afterAll(async () => {
    try {
      if (setupClient) {
        await setupClient.query('RESET ROLE').catch(() => undefined);
        if (runtimeCaptured) {
          await setupClient.query(
            `
              UPDATE private.daily_allocation_v2_runtime
              SET board_enabled = $1, writes_enabled = $2, updated_at = NOW()
              WHERE singleton = TRUE
            `,
            [originalBoardEnabled, originalWritesEnabled]
          );
        }
        if (planDayId) {
          await setupClient.query(
            'DELETE FROM public.daily_allocation_visit_labour WHERE plan_day_id = $1::uuid',
            [planDayId]
          );
          await setupClient.query(
            'DELETE FROM public.daily_allocation_conflict_overrides WHERE plan_day_id = $1::uuid',
            [planDayId]
          );
          await setupClient.query(
            'DELETE FROM public.daily_allocation_visits WHERE plan_day_id = $1::uuid',
            [planDayId]
          );
          await setupClient.query('BEGIN');
          try {
            await setupClient.query(
              'ALTER TABLE public.daily_allocation_plan_days DISABLE TRIGGER daily_allocation_plan_days_immutable_delete'
            );
            await setupClient.query(
              'DELETE FROM public.daily_allocation_plan_days WHERE id = $1::uuid',
              [planDayId]
            );
            await setupClient.query(
              'ALTER TABLE public.daily_allocation_plan_days ENABLE TRIGGER daily_allocation_plan_days_immutable_delete'
            );
            await setupClient.query('COMMIT');
          } catch (error) {
            await setupClient.query('ROLLBACK').catch(() => undefined);
            throw error;
          }
        }
      }
    } finally {
      await Promise.allSettled(clients.map((client) => client.end()));
    }
  }, 30_000);

  it('serializes simultaneous assignments of one employee without deadlock or lost update', async () => {
    const visits = await setupClient.query<{ id: string }>(
      `
        SELECT id::text
        FROM public.daily_allocation_visits
        WHERE plan_day_id = $1::uuid
        ORDER BY starts_at, id
      `,
      [planDayId]
    );
    expect(visits.rows).toHaveLength(2);

    const runAssignment = (client: Client, visitId: string) =>
      client.query(
        `
          SELECT public.assign_daily_allocation_labour_v2(
            $1::uuid, $2::uuid, 3, NULL, NULL, NULL, NULL
          )
        `,
        [visitId, DA2_ACTORS.employeeA]
      );

    const settled = await Promise.race([
      Promise.allSettled([
        runAssignment(firstClient, visits.rows[0].id),
        runAssignment(secondClient, visits.rows[1].id),
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Concurrent assignment test timed out')), 15_000)
      ),
    ]);

    const fulfilled = settled.filter((result) => result.status === 'fulfilled');
    const rejected = settled.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toMatch(/STALE_PLAN_VERSION|exclusion|overlap|23P01/i);

    const state = await setupClient.query<{ plan_version: number; assignments: number }>(
      `
        SELECT
          plan_days.plan_version,
          (
            SELECT COUNT(*)::int
            FROM public.daily_allocation_visit_labour labour
            WHERE labour.plan_day_id = plan_days.id
              AND labour.profile_id = $2::uuid
          ) AS assignments
        FROM public.daily_allocation_plan_days plan_days
        WHERE plan_days.id = $1::uuid
      `,
      [planDayId, DA2_ACTORS.employeeA]
    );
    expect(state.rows[0]).toEqual({ plan_version: 4, assignments: 1 });
  }, 30_000);
});
