import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  CONTRACTOR_TRANSITION_IDS as IDS,
  applyContractorTransitionMigration,
  createContractorTransitionPgliteBase,
  setContractorTransitionAuthRole,
} from '../db/contractor-role-transition-pglite-harness';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(days: number): string {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function currentFinancialYearStartYear(): number {
  const now = new Date();
  return now.getUTCMonth() < 3 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
}

function closedYearDate(): string {
  return `${currentFinancialYearStartYear() - 1}-06-01`;
}

async function seedBase(pg: PGlite): Promise<void> {
  await pg.query(
    `INSERT INTO public.roles (id, name, display_name)
     VALUES ($1, 'employee', 'Employee'), ($2, 'contractor', 'Contractor')`,
    [IDS.employeeRole, IDS.contractorRole]
  );
  await pg.query(
    `INSERT INTO public.profiles (
       id, role_id, full_name, annual_holiday_allowance_days
     ) VALUES ($1, $2, 'Transition User', 28)`,
    [IDS.profile, IDS.employeeRole]
  );
  await pg.query(
    `INSERT INTO public.absence_reasons (id, name)
     VALUES ($1, 'Annual Leave'), ($2, 'Unpaid Leave')`,
    [IDS.annualLeave, IDS.unpaidLeave]
  );
  await pg.query(
    `INSERT INTO public.absence_bulk_batches (id) VALUES ($1)`,
    [IDS.bulkBatch]
  );
  await pg.query(
    `INSERT INTO public.absence_allowance_carryovers (
       profile_id, financial_year_start_year, carried_days
     ) VALUES ($1, $2, 4.5)`,
    [IDS.profile, currentFinancialYearStartYear()]
  );
  await pg.query(
    `INSERT INTO public.user_module_permissions (user_id, module_name, access_level)
     VALUES ($1, 'absence', 2), ($1, 'timesheets', 1)`,
    [IDS.profile]
  );
}

async function runTransition(pg: PGlite) {
  return pg.query<{ transition_profile_to_contractor: Record<string, unknown> }>(
    `SELECT public.transition_profile_to_contractor($1, $2, $3)`,
    [IDS.profile, IDS.employeeRole, IDS.contractorRole]
  );
}

describe('Contractor role transition PGlite', () => {
  let pg: PGlite | null = null;

  beforeEach(async () => {
    pg = await createContractorTransitionPgliteBase();
    await seedBase(pg);
    await applyContractorTransitionMigration(pg);
  });

  afterEach(async () => {
    await pg?.close();
    pg = null;
  });

  it('atomically converts the profile and removes only safe future automation', async () => {
    if (!pg) throw new Error('PGlite not initialized');
    const futureDate = addDays(30);
    await pg.query(
      `INSERT INTO public.absences (
         id, profile_id, date, reason_id, status, is_bank_holiday, auto_generated, bulk_batch_id
       ) VALUES
         ('71111111-1111-4111-8111-111111111111', $1, $2, $3, 'approved', true, true, NULL),
         ('72222222-2222-4222-8222-222222222222', $1, $2, $3, 'approved', false, false, $4),
         ('73333333-3333-4333-8333-333333333333', $1, $5, $3, 'processed', false, false, NULL),
         ('74444444-4444-4444-8444-444444444444', $1, $2, $6, 'approved', false, false, NULL)`,
      [IDS.profile, futureDate, IDS.annualLeave, IDS.bulkBatch, closedYearDate(), IDS.unpaidLeave]
    );

    await setContractorTransitionAuthRole(pg, 'service_role');
    const result = await runTransition(pg);
    expect(result.rows[0]?.transition_profile_to_contractor).toMatchObject({
      profileId: IDS.profile,
      previousRoleId: IDS.employeeRole,
      contractorRoleId: IDS.contractorRole,
      removedAbsenceCount: 2,
      zeroedCarryoverCount: 1,
      clearedPermissionCount: 2,
    });

    const profile = await pg.query<{ role_id: string; allowance: number }>(
      `SELECT role_id::text, annual_holiday_allowance_days::float8 AS allowance
         FROM public.profiles WHERE id = $1`,
      [IDS.profile]
    );
    expect(profile.rows[0]).toEqual({ role_id: IDS.contractorRole, allowance: 0 });

    const carryover = await pg.query<{ carried_days: number }>(
      `SELECT carried_days::float8 FROM public.absence_allowance_carryovers WHERE profile_id = $1`,
      [IDS.profile]
    );
    expect(carryover.rows[0]?.carried_days).toBe(0);

    const permissions = await pg.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.user_module_permissions WHERE user_id = $1`,
      [IDS.profile]
    );
    expect(permissions.rows[0]?.count).toBe(0);

    const remaining = await pg.query<{ reason_id: string; date: string }>(
      `SELECT reason_id::text, date::text
         FROM public.absences WHERE profile_id = $1 ORDER BY date`,
      [IDS.profile]
    );
    expect(remaining.rows).toEqual([
      { reason_id: IDS.annualLeave, date: closedYearDate() },
      { reason_id: IDS.unpaidLeave, date: futureDate },
    ]);
  });

  it('rejects manual or past open-year Annual Leave without changing anything', async () => {
    if (!pg) throw new Error('PGlite not initialized');
    const futureDate = addDays(30);
    await pg.query(
      `INSERT INTO public.absences (
         id, profile_id, date, reason_id, status, is_bank_holiday, auto_generated
       ) VALUES
         ('81111111-1111-4111-8111-111111111111', $1, $2, $3, 'approved', true, true),
         ('82222222-2222-4222-8222-222222222222', $1, $2, $3, 'pending', false, false),
         ('83333333-3333-4333-8333-333333333333', $1, $4, $3, 'processed', true, true),
         ('84444444-4444-4444-8444-444444444444', $1, $5, $3, 'approved', true, true)`,
      [IDS.profile, futureDate, IDS.annualLeave, addDays(-30), addDays(0)]
    );

    await setContractorTransitionAuthRole(pg, 'service_role');
    await expect(runTransition(pg)).rejects.toThrow(/manual review/);

    const state = await pg.query<{
      role_id: string;
      allowance: number;
      absence_count: number;
      permission_count: number;
      carryover: number;
    }>(
      `SELECT
         p.role_id::text,
         p.annual_holiday_allowance_days::float8 AS allowance,
         (SELECT COUNT(*)::int FROM public.absences a WHERE a.profile_id = p.id) AS absence_count,
         (SELECT COUNT(*)::int FROM public.user_module_permissions u WHERE u.user_id = p.id) AS permission_count,
         (SELECT carried_days::float8 FROM public.absence_allowance_carryovers c WHERE c.profile_id = p.id) AS carryover
       FROM public.profiles p WHERE p.id = $1`,
      [IDS.profile]
    );
    expect(state.rows[0]).toEqual({
      role_id: IDS.employeeRole,
      allowance: 28,
      absence_count: 4,
      permission_count: 2,
      carryover: 4.5,
    });
  });

  it('treats today as historical evidence rather than future automation', async () => {
    if (!pg) throw new Error('PGlite not initialized');
    const absenceId = '85555555-5555-4555-8555-555555555555';
    await pg.query(
      `INSERT INTO public.absences (
         id, profile_id, date, reason_id, status, is_bank_holiday, auto_generated
       ) VALUES ($1, $2, $3, $4, 'approved', true, true)`,
      [absenceId, IDS.profile, addDays(0), IDS.annualLeave]
    );

    await setContractorTransitionAuthRole(pg, 'service_role');
    await expect(runTransition(pg)).rejects.toThrow(/manual review/);

    const unchanged = await pg.query<{ role_id: string; absence_count: number }>(
      `SELECT
         p.role_id::text,
         (SELECT COUNT(*)::int FROM public.absences a WHERE a.id = $2) AS absence_count
       FROM public.profiles p WHERE p.id = $1`,
      [IDS.profile, absenceId]
    );
    expect(unchanged.rows[0]).toEqual({
      role_id: IDS.employeeRole,
      absence_count: 1,
    });
  });

  it.each([
    'timesheet_entry_leave_snapshots',
    'timesheet_bank_holiday_work_confirmations',
  ])('rejects linked evidence in %s and preserves the candidate booking', async (table) => {
    if (!pg) throw new Error('PGlite not initialized');
    const absenceId = '91111111-1111-4111-8111-111111111111';
    await pg.query(
      `INSERT INTO public.absences (
         id, profile_id, date, reason_id, status, is_bank_holiday, auto_generated
       ) VALUES ($1, $2, $3, $4, 'approved', true, true)`,
      [absenceId, IDS.profile, addDays(30), IDS.annualLeave]
    );
    await pg.query(`INSERT INTO public.${table} (absence_id) VALUES ($1)`, [absenceId]);

    await setContractorTransitionAuthRole(pg, 'service_role');
    await expect(runTransition(pg)).rejects.toThrow(/timesheet evidence/);

    const absences = await pg.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.absences WHERE id = $1`,
      [absenceId]
    );
    expect(absences.rows[0]?.count).toBe(1);
  });

  it('is service-role-only and rejects a stale expected role', async () => {
    if (!pg) throw new Error('PGlite not initialized');
    const grants = await pg.query<{ service_role: boolean; authenticated: boolean; anon: boolean }>(
      `SELECT
         has_function_privilege('service_role', 'public.transition_profile_to_contractor(uuid,uuid,uuid)', 'EXECUTE') AS service_role,
         has_function_privilege('authenticated', 'public.transition_profile_to_contractor(uuid,uuid,uuid)', 'EXECUTE') AS authenticated,
         has_function_privilege('anon', 'public.transition_profile_to_contractor(uuid,uuid,uuid)', 'EXECUTE') AS anon`
    );
    expect(grants.rows[0]).toEqual({
      service_role: true,
      authenticated: false,
      anon: false,
    });

    await setContractorTransitionAuthRole(pg, 'authenticated');
    await expect(runTransition(pg)).rejects.toThrow(/service_role required/);

    await setContractorTransitionAuthRole(pg, 'service_role');
    await expect(
      pg.query(
        `UPDATE public.profiles SET role_id = $1 WHERE id = $2`,
        [IDS.contractorRole, IDS.profile]
      )
    ).rejects.toThrow(/dedicated transition/);

    await expect(
      pg.query(
        `SELECT public.transition_profile_to_contractor($1, $2, $3)`,
        [IDS.profile, IDS.contractorRole, IDS.contractorRole]
      )
    ).rejects.toThrow(/role changed/);
  });

  it('keeps Contractor identity stable when assigned roles are renamed', async () => {
    if (!pg) throw new Error('PGlite not initialized');

    await expect(
      pg.query(
        `UPDATE public.roles SET name = 'contractor' WHERE id = $1`,
        [IDS.employeeRole]
      )
    ).rejects.toThrow(/identity cannot be renamed or reassigned/);

    await expect(
      pg.query(
        `UPDATE public.roles SET name = 'external-contractor' WHERE id = $1`,
        [IDS.contractorRole]
      )
    ).rejects.toThrow(/identity cannot be renamed or reassigned/);

    await expect(
      pg.query(
        `INSERT INTO public.roles (id, name, display_name)
         VALUES ('aaaaaaaa-1111-4111-8111-111111111111', 'external-worker', 'Contractor')`
      )
    ).rejects.toThrow(/canonical Contractor role/);

    const profile = await pg.query<{ role_id: string }>(
      `SELECT role_id::text FROM public.profiles WHERE id = $1`,
      [IDS.profile]
    );
    expect(profile.rows[0]?.role_id).toBe(IDS.employeeRole);
  });
});
