import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stripOuterMigrationTransaction } from '../../scripts/finalise-migrations';
import {
  DATABASE_COMMENT_PREFIX,
  PROJECT_NAME_HASH_LENGTH,
  PROJECT_NAME_PREFIX,
  PROVENANCE_ENV_KEYS,
  STATE_VERSION,
  isInheritedDatabaseUrlKey,
  validateLocalTestDatabaseUrl,
} from '../../scripts/local-test-postgres';
import {
  assertSubmittedBankHolidayHoursConfirmed,
  confirmBankHolidayWork,
} from '../../lib/server/timesheet-bank-holiday-work';

const describePostgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const BASE_PATH = 'tests/db/timesheet-bank-holiday-base.sql';
const MIGRATION_PATH = 'supabase/migrations/20260908_timesheet_bank_holiday_self_override.sql';
const WEEK_ENDING = '2026-09-06';
const BANK_HOLIDAY_DATE = '2026-08-31';

describePostgres('bank holiday disposable PostgreSQL runtime', () => {
  const connectionString = process.env.TEST_DATABASE_URL || '';
  const clients: Client[] = [];
  let setup: Client;
  let annualLeaveReasonId: string;

  function requireRunnerProvenance(): void {
    const marker = process.env[PROVENANCE_ENV_KEYS.marker];
    const projectName = process.env[PROVENANCE_ENV_KEYS.project];
    const portText = process.env[PROVENANCE_ENV_KEYS.port];
    if (!marker || !projectName || !portText || !/^[0-9]+$/u.test(portText)) {
      throw new Error('LTDB-SAFE-001: disposable local PostgreSQL runner provenance is required');
    }
    const leakedDatabaseKeys = Object.keys(process.env).filter(
      (key) => key !== 'TEST_DATABASE_URL' && isInheritedDatabaseUrlKey(key)
    );
    if (leakedDatabaseKeys.length > 0) {
      throw new Error(
        `LTDB-NATIVE-ENV-001: inherited database variables reappeared: ${leakedDatabaseKeys.join(', ')}`
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
      throw new Error('LTDB-SAFE-001: runner project and database marker provenance disagree');
    }
  }

  async function connect(): Promise<Client> {
    const client = new Client({ connectionString, ssl: false });
    await client.connect();
    clients.push(client);
    return client;
  }

  async function seedProfile(): Promise<string> {
    const id = randomUUID();
    await setup.query('INSERT INTO public.profiles (id, full_name) VALUES ($1, $2)', [
      id,
      `Bank Holiday Test ${id.slice(0, 8)}`,
    ]);
    return id;
  }

  async function seedAbsence(input: {
    profileId: string;
    isBankHoliday: boolean;
  }): Promise<string> {
    const id = randomUUID();
    await setup.query(
      `INSERT INTO public.absences (
         id, profile_id, reason_id, date, end_date, status, is_bank_holiday
       ) VALUES ($1, $2, $3, $4, $4, 'approved', $5)`,
      [id, input.profileId, annualLeaveReasonId, BANK_HOLIDAY_DATE, input.isBankHoliday]
    );
    return id;
  }

  async function seedTimesheet(profileId: string): Promise<string> {
    const result = await setup.query<{ id: string }>(
      `INSERT INTO public.timesheets (user_id, week_ending, status)
       VALUES ($1, $2, 'draft')
       RETURNING id::text`,
      [profileId, WEEK_ENDING]
    );
    return result.rows[0]!.id;
  }

  async function asAuthenticated<T>(
    profileId: string,
    action: () => Promise<T>
  ): Promise<T> {
    await setup.query('BEGIN');
    try {
      await setup.query('SET LOCAL ROLE authenticated');
      await setup.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [profileId]);
      return await action();
    } finally {
      await setup.query('ROLLBACK');
    }
  }

  beforeAll(async () => {
    requireRunnerProvenance();
    setup = await connect();
    await setup.query(readFileSync(resolve(process.cwd(), BASE_PATH), 'utf8'));
    await setup.query(
      stripOuterMigrationTransaction(
        readFileSync(resolve(process.cwd(), MIGRATION_PATH), 'utf8')
      )
    );
    annualLeaveReasonId = randomUUID();
    await setup.query(
      `INSERT INTO public.absence_reasons (id, name, is_paid)
       VALUES ($1, 'Annual Leave', true)`,
      [annualLeaveReasonId]
    );
  }, 60_000);

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  });

  it('BH-PG-RUNTIME-001: applies the exact migration with trial default ON and RLS enabled', async () => {
    const setting = await setup.query<{ enabled: boolean }>(
      `SELECT bank_holiday_self_override_enabled AS enabled
       FROM public.timesheet_module_settings
       WHERE id = TRUE`
    );
    expect(setting.rows).toEqual([{ enabled: true }]);

    const rls = await setup.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity
       FROM pg_class
       WHERE relname IN (
         'timesheet_module_settings',
         'timesheet_bank_holiday_work_confirmations'
       )
       ORDER BY relname`
    );
    expect(rls.rows).toEqual([
      { relname: 'timesheet_bank_holiday_work_confirmations', relrowsecurity: true },
      { relname: 'timesheet_module_settings', relrowsecurity: true },
    ]);

    const ownerId = await seedProfile();
    const otherId = await seedProfile();
    const absenceId = await seedAbsence({ profileId: ownerId, isBankHoliday: true });
    const timesheetId = await seedTimesheet(ownerId);
    await setup.query(
      `INSERT INTO public.timesheet_bank_holiday_work_confirmations (
         timesheet_id, work_date, absence_id, confirmed_by
       ) VALUES ($1, $2, $3, $4)`,
      [timesheetId, BANK_HOLIDAY_DATE, absenceId, ownerId]
    );

    const ownerRows = await asAuthenticated(ownerId, () =>
      setup.query<{ work_date: string }>(
        `SELECT work_date::text
         FROM public.timesheet_bank_holiday_work_confirmations
         WHERE timesheet_id = $1`,
        [timesheetId]
      )
    );
    expect(ownerRows.rows).toEqual([{ work_date: BANK_HOLIDAY_DATE }]);

    const otherRows = await asAuthenticated(otherId, () =>
      setup.query(
        `SELECT work_date
         FROM public.timesheet_bank_holiday_work_confirmations
         WHERE timesheet_id = $1`,
        [timesheetId]
      )
    );
    expect(otherRows.rows).toEqual([]);

    await expect(
      asAuthenticated(ownerId, () =>
        setup.query(
          `INSERT INTO public.timesheet_bank_holiday_work_confirmations (
             timesheet_id, work_date, absence_id, confirmed_by
           ) VALUES ($1, '2026-09-01', $2, $3)`,
          [timesheetId, absenceId, ownerId]
        )
      )
    ).rejects.toMatchObject({ code: '42501' });

    const deniedSettingUpdate = await asAuthenticated(ownerId, () =>
      setup.query(
        `UPDATE public.timesheet_module_settings
         SET bank_holiday_self_override_enabled = FALSE
         WHERE id = TRUE`
      )
    );
    expect(deniedSettingUpdate.rowCount).toBe(0);
    const unchangedSetting = await setup.query<{ enabled: boolean }>(
      `SELECT bank_holiday_self_override_enabled AS enabled
       FROM public.timesheet_module_settings
       WHERE id = TRUE`
    );
    expect(unchangedSetting.rows).toEqual([{ enabled: true }]);
  });

  it('BH-E2E-01 through BH-E2E-03: eligible work confirms case-insensitively and wrong text mutates nothing', async () => {
    const profileId = await seedProfile();
    const absenceId = await seedAbsence({ profileId, isBankHoliday: true });
    const timesheetId = await seedTimesheet(profileId);
    let factoryCalled = false;

    await expect(
      confirmBankHolidayWork({
        input: {
          actorId: profileId,
          targetUserId: profileId,
          weekEnding: WEEK_ENDING,
          timesheetId,
          dates: [BANK_HOLIDAY_DATE],
          phrase: 'not correct',
        },
        createClient: () => {
          factoryCalled = true;
          return new Client({ connectionString, ssl: false });
        },
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 });
    expect(factoryCalled).toBe(false);

    const confirmed = await confirmBankHolidayWork({
      input: {
        actorId: profileId,
        targetUserId: profileId,
        weekEnding: WEEK_ENDING,
        timesheetId,
        dates: [BANK_HOLIDAY_DATE],
        phrase: ' bank holiday ',
      },
      createClient: () => new Client({ connectionString, ssl: false }),
    });
    expect(confirmed).toEqual({ timesheetId, confirmedDates: [BANK_HOLIDAY_DATE] });

    const evidence = await setup.query<{
      absence_id: string;
      allow_timesheet_work_on_leave: boolean;
    }>(
      `SELECT c.absence_id::text, a.allow_timesheet_work_on_leave
       FROM public.timesheet_bank_holiday_work_confirmations c
       JOIN public.absences a ON a.id = c.absence_id
       WHERE c.timesheet_id = $1`,
      [timesheetId]
    );
    expect(evidence.rows).toEqual([
      { absence_id: absenceId, allow_timesheet_work_on_leave: true },
    ]);

    await setup.query(`UPDATE public.absences SET status = 'cancelled' WHERE id = $1`, [
      absenceId,
    ]);
    const replacementAbsenceId = await seedAbsence({ profileId, isBankHoliday: true });
    await confirmBankHolidayWork({
      input: {
        actorId: profileId,
        targetUserId: profileId,
        weekEnding: WEEK_ENDING,
        timesheetId,
        dates: [BANK_HOLIDAY_DATE],
        phrase: 'BANK HOLIDAY',
      },
      createClient: () => new Client({ connectionString, ssl: false }),
    });
    const reboundEvidence = await setup.query<{ absence_id: string }>(
      `SELECT absence_id::text
       FROM public.timesheet_bank_holiday_work_confirmations
       WHERE timesheet_id = $1`,
      [timesheetId]
    );
    expect(reboundEvidence.rows).toEqual([{ absence_id: replacementAbsenceId }]);
  });

  it('BH-E2E-04 and BH-E2E-05: ordinary annual leave stays protected and explicit trial OFF restores legacy authority', async () => {
    const profileId = await seedProfile();
    await seedAbsence({ profileId, isBankHoliday: false });
    const timesheetId = await seedTimesheet(profileId);

    await expect(
      confirmBankHolidayWork({
        input: {
          actorId: profileId,
          targetUserId: profileId,
          weekEnding: WEEK_ENDING,
          timesheetId,
          dates: [BANK_HOLIDAY_DATE],
          phrase: 'BANK HOLIDAY',
        },
        createClient: () => new Client({ connectionString, ssl: false }),
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 });

    await setup.query(
      `UPDATE public.timesheet_module_settings
       SET bank_holiday_self_override_enabled = FALSE
       WHERE id = TRUE`
    );
    await assertSubmittedBankHolidayHoursConfirmed(setup, {
      timesheetId,
      userId: profileId,
      weekEnding: WEEK_ENDING,
      entries: [{ day_of_week: 1, time_started: '08:00', time_finished: '16:00' }],
    });
    await setup.query(
      `UPDATE public.timesheet_module_settings
       SET bank_holiday_self_override_enabled = TRUE
       WHERE id = TRUE`
    );
  });

  it('BH-E2E-07: submit authority rejects absent or stale evidence and accepts current trusted evidence', async () => {
    const profileId = await seedProfile();
    await seedAbsence({ profileId, isBankHoliday: true });
    const timesheetId = await seedTimesheet(profileId);
    const entries = [{ day_of_week: 1, operator_travel_hours: 1.5 }];

    await expect(
      assertSubmittedBankHolidayHoursConfirmed(setup, {
        timesheetId,
        userId: profileId,
        weekEnding: WEEK_ENDING,
        entries,
      })
    ).rejects.toMatchObject({ code: 'BANK_HOLIDAY_CONFIRM_REQUIRED', status: 400 });

    await confirmBankHolidayWork({
      input: {
        actorId: profileId,
        targetUserId: profileId,
        weekEnding: WEEK_ENDING,
        timesheetId,
        dates: [BANK_HOLIDAY_DATE],
        phrase: 'BANK HOLIDAY',
      },
      createClient: () => new Client({ connectionString, ssl: false }),
    });

    await expect(
      assertSubmittedBankHolidayHoursConfirmed(setup, {
        timesheetId,
        userId: profileId,
        weekEnding: WEEK_ENDING,
        entries,
      })
    ).resolves.toBeUndefined();
  });
});
