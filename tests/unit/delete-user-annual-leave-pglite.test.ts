import { afterEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  DELETE_USER_LEAVE_IDS as IDS,
  applyDeleteUserLeaveMigration,
  createDeleteUserLeavePgliteBase,
  setAuthRole,
} from '../db/delete-user-annual-leave-pglite-harness';

function currentFinancialYearStartYear(now = new Date()): number {
  return now.getMonth() < 3 || (now.getMonth() === 3 && now.getDate() < 6)
    ? now.getFullYear() - 1
    : now.getFullYear();
}

function openYearDate(): string {
  return `${currentFinancialYearStartYear()}-06-01`;
}

function closedYearDate(): string {
  return `${currentFinancialYearStartYear() - 1}-06-01`;
}

async function seedSharedRows(pg: PGlite): Promise<void> {
  await pg.query(
    `INSERT INTO public.profiles (id, full_name, deleted_at, created_at, updated_at)
     VALUES
       ($1, 'Active User', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
       ($2, 'Legacy Person (Deleted User)', NULL, '2026-01-02T00:00:00Z', '2026-02-02T00:00:00Z'),
       ($3, 'Live Delete User', NULL, '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z')`,
    [IDS.active, IDS.legacyDeleted, IDS.liveDelete]
  );
  await pg.query(
    `INSERT INTO public.absence_reasons (id, name) VALUES ($1, 'Annual Leave'), ($2, 'Unpaid leave')`,
    [IDS.annualLeave, IDS.unpaidLeave]
  );
}

describe('delete-user annual leave PGlite', () => {
  let pg: PGlite | null = null;

  afterEach(async () => {
    if (pg) {
      await pg.close();
      pg = null;
    }
  });

  it('DEL-AL-03: executable migration proves backfill, grants, guards, and open-year cleanup', async () => {
    pg = await createDeleteUserLeavePgliteBase();
    await seedSharedRows(pg);

    const openDate = openYearDate();
    const closedDate = closedYearDate();

    await pg.query(
      `INSERT INTO public.absences (id, profile_id, date, reason_id, status) VALUES
        ('44444444-4444-4444-8444-444444444441', $1, $2, $3, 'pending'),
        ('44444444-4444-4444-8444-444444444442', $1, $2, $3, 'approved'),
        ('44444444-4444-4444-8444-444444444443', $1, $2, $3, 'processed'),
        ('44444444-4444-4444-8444-444444444444', $1, $5, $3, 'approved'),
        ('44444444-4444-4444-8444-444444444445', $1, $2, $4, 'approved')`,
      [IDS.legacyDeleted, openDate, IDS.annualLeave, IDS.unpaidLeave, closedDate]
    );
    await pg.query(
      `INSERT INTO public.absences_archive (id, profile_id, date, reason_id, status)
       VALUES ('55555555-5555-4555-8555-555555555555', $1, $2, $3, 'processed')`,
      [IDS.legacyDeleted, closedDate, IDS.annualLeave]
    );

    await applyDeleteUserLeaveMigration(pg);

    const grants = await pg.query<{
      service_role: boolean;
      authenticated: boolean;
      anon: boolean;
    }>(
      `SELECT
         has_function_privilege('service_role', 'public.delete_profile_open_year_annual_leave_bookings(uuid)', 'EXECUTE') AS service_role,
         has_function_privilege('authenticated', 'public.delete_profile_open_year_annual_leave_bookings(uuid)', 'EXECUTE') AS authenticated,
         has_function_privilege('anon', 'public.delete_profile_open_year_annual_leave_bookings(uuid)', 'EXECUTE') AS anon`
    );
    expect(grants.rows[0]).toEqual({
      service_role: true,
      authenticated: false,
      anon: false,
    });

    const tombstone = await pg.query<{ deleted_at: string }>(
      `SELECT deleted_at::text FROM public.profiles WHERE id = $1`,
      [IDS.legacyDeleted]
    );
    expect(tombstone.rows[0]?.deleted_at).toContain('2026-02-02');

    const remaining = await pg.query<{ status: string; date: string; reason_id: string }>(
      `SELECT status, date::text, reason_id::text FROM public.absences WHERE profile_id = $1 ORDER BY date, status`,
      [IDS.legacyDeleted]
    );
    expect(remaining.rows).toEqual([
      { status: 'approved', date: closedDate, reason_id: IDS.annualLeave },
      { status: 'approved', date: openDate, reason_id: IDS.unpaidLeave },
    ]);

    const archived = await pg.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.absences_archive`
    );
    expect(archived.rows[0]?.count).toBe(1);

    await pg.query(
      `INSERT INTO public.absence_reasons (id, name) VALUES ('77777777-7777-4777-8777-777777777777', ' Annual Leave ')`
    );
    await setAuthRole(pg, 'service_role');
    await expect(
      pg.query(`SELECT public.delete_profile_open_year_annual_leave_bookings($1)`, [IDS.legacyDeleted])
    ).rejects.toThrow(/missing or ambiguous/);
  });

  it('DEL-AL-06: deleted or missing profiles cannot receive new or reassigned absences', async () => {
    pg = await createDeleteUserLeavePgliteBase();
    await seedSharedRows(pg);
    await applyDeleteUserLeaveMigration(pg);

    const grants = await pg.query<{
      service_role: boolean;
      authenticated: boolean;
      anon: boolean;
    }>(
      `SELECT
         has_function_privilege('service_role', 'public.delete_profile_open_year_annual_leave_bookings(uuid)', 'EXECUTE') AS service_role,
         has_function_privilege('authenticated', 'public.delete_profile_open_year_annual_leave_bookings(uuid)', 'EXECUTE') AS authenticated,
         has_function_privilege('anon', 'public.delete_profile_open_year_annual_leave_bookings(uuid)', 'EXECUTE') AS anon`
    );
    expect(grants.rows[0]).toEqual({
      service_role: true,
      authenticated: false,
      anon: false,
    });

    const openDate = openYearDate();
    const closedDate = closedYearDate();
    await pg.query(
      `INSERT INTO public.absences (id, profile_id, date, reason_id, status) VALUES
        ('66666666-6666-4666-8666-666666666661', $1, $2, $3, 'pending'),
        ('66666666-6666-4666-8666-666666666662', $1, $2, $3, 'approved'),
        ('66666666-6666-4666-8666-666666666663', $1, $2, $3, 'processed'),
        ('66666666-6666-4666-8666-666666666664', $1, $2, $3, 'rejected'),
        ('66666666-6666-4666-8666-666666666665', $1, $2, $3, 'cancelled'),
        ('66666666-6666-4666-8666-666666666666', $1, $4, $3, 'approved'),
        ('66666666-6666-4666-8666-666666666667', $5, $2, $3, 'pending')`,
      [IDS.liveDelete, openDate, IDS.annualLeave, closedDate, IDS.active]
    );

    await setAuthRole(pg, 'authenticated');
    await expect(
      pg.query(`SELECT public.delete_profile_open_year_annual_leave_bookings($1)`, [IDS.liveDelete])
    ).rejects.toThrow(/service_role required/);

    await setAuthRole(pg, 'service_role');
    await pg.query(
      `UPDATE public.profiles SET deleted_at = '2026-09-07T10:00:00Z', full_name = 'Live Delete User (Deleted User)' WHERE id = $1`,
      [IDS.liveDelete]
    );
    const retry = await pg.query<{ deleted_at: string }>(
      `UPDATE public.profiles SET deleted_at = '2026-09-07T12:00:00Z' WHERE id = $1 RETURNING deleted_at::text`,
      [IDS.liveDelete]
    );
    expect(retry.rows[0]?.deleted_at).toMatch(/2026-09-07[ T]10:00:00/);

    const removed = await pg.query<{ delete_profile_open_year_annual_leave_bookings: number }>(
      `SELECT public.delete_profile_open_year_annual_leave_bookings($1)`,
      [IDS.liveDelete]
    );
    expect(removed.rows[0]?.delete_profile_open_year_annual_leave_bookings).toBe(5);

    const leftover = await pg.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.absences WHERE profile_id = $1`,
      [IDS.liveDelete]
    );
    expect(leftover.rows[0]?.count).toBe(1);

    await expect(
      pg.query(
        `INSERT INTO public.absences (profile_id, date, reason_id, status) VALUES ($1, $2, $3, 'pending')`,
        [IDS.liveDelete, openDate, IDS.annualLeave]
      )
    ).rejects.toThrow(/deleted profile/);

    await expect(
      pg.query(
        `UPDATE public.absences SET profile_id = $1 WHERE profile_id = $2`,
        [IDS.liveDelete, IDS.active]
      )
    ).rejects.toThrow(/deleted profile/);

    const missingProfileId = '99999999-9999-4999-8999-999999999999';
    await expect(
      pg.query(
        `INSERT INTO public.absences (profile_id, date, reason_id, status) VALUES ($1, $2, $3, 'pending')`,
        [missingProfileId, openDate, IDS.annualLeave]
      )
    ).rejects.toThrow(/missing profile/);
    await expect(
      pg.query(
        `UPDATE public.absences SET profile_id = $1 WHERE profile_id = $2`,
        [missingProfileId, IDS.active]
      )
    ).rejects.toThrow(/missing profile/);
  });
});
