import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  confirmBankHolidayWork,
  TimesheetBankHolidayWorkError,
  type BankHolidayWorkPgClient,
} from '@/lib/server/timesheet-bank-holiday-work';
import {
  applyTimesheetSubmit,
  TimesheetSubmitBodySchema,
  type TimesheetSubmitBody,
  type TimesheetSubmitPgClient,
} from '@/lib/server/timesheet-submit';
import {
  getUnconfirmedBankHolidayDates,
  isBankHolidayConfirmPhrase,
} from '@/lib/utils/timesheet-bank-holiday-work';
import { resolveBankHolidayWorkRecipientIds } from '@/lib/server/timesheet-bank-holiday-work-notification';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const TIMESHEET_ID = '22222222-2222-4222-8222-222222222222';
const ABSENCE_ID = '33333333-3333-4333-8333-333333333333';
const WEEK_ENDING = '2026-09-06';
const BANK_HOLIDAY_DATE = '2026-08-31';
const SIGNATURE = `data:image/png;base64,${'A'.repeat(40)}`;

function sevenEntries(): TimesheetSubmitBody['entries'] {
  return Array.from({ length: 7 }, (_, index) => ({
    day_of_week: index + 1,
    time_started: index === 6 ? null : '08:00',
    time_finished: index === 6 ? null : '16:00',
    did_not_work: index === 6,
    daily_total: index === 6 ? 0 : 8,
    remarks: index === 6 ? 'Did Not Work' : null,
    job_numbers: index === 6 ? [] : ['JOB-1'],
  }));
}

function submitBody(overrides: Partial<TimesheetSubmitBody> = {}): TimesheetSubmitBody {
  return TimesheetSubmitBodySchema.parse({
    userId: OWNER_ID,
    weekEnding: WEEK_ENDING,
    timesheetType: 'civils',
    templateVersion: 1,
    signatureData: SIGNATURE,
    entries: sevenEntries(),
    ...overrides,
  });
}

class ConfirmClient implements BankHolidayWorkPgClient {
  readonly statements: string[] = [];
  trialEnabled = true;
  status = 'draft';
  absences: Array<{
    id: string;
    date: string;
    end_date: string | null;
    is_half_day: boolean | null;
    is_bank_holiday: boolean | null;
    status: string;
    reason_name: string;
  }> = [
    {
      id: ABSENCE_ID,
      date: BANK_HOLIDAY_DATE,
      end_date: BANK_HOLIDAY_DATE,
      is_half_day: false,
      is_bank_holiday: true,
      status: 'approved',
      reason_name: 'Annual Leave',
    },
  ];
  insertedDates: string[] = [];

  async connect(): Promise<void> {}
  async end(): Promise<void> {}

  async query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[] }> {
    const sql = text.trim();
    this.statements.push(sql);
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('ROLLBACK')) return { rows: [] };
    if (sql.includes('FROM public.timesheet_module_settings')) {
      return { rows: [{ bank_holiday_self_override_enabled: this.trialEnabled } as Row] };
    }
    if (sql.includes('FROM public.timesheets') && sql.includes('FOR UPDATE')) {
      return {
        rows: [
          {
            id: TIMESHEET_ID,
            user_id: OWNER_ID,
            week_ending: WEEK_ENDING,
            status: this.status,
          } as Row,
        ],
      };
    }
    if (sql.includes('FROM public.absences')) {
      return { rows: this.absences as Row[] };
    }
    if (sql.includes('UPDATE public.absences')) {
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO public.timesheet_bank_holiday_work_confirmations')) {
      this.insertedDates.push(String(values?.[1] || ''));
      return { rows: [] };
    }
    if (sql.includes('FROM public.timesheet_bank_holiday_work_confirmations')) {
      return { rows: this.insertedDates.map((work_date) => ({ work_date }) as Row) };
    }
    return { rows: [] };
  }
}

class SubmitClient implements TimesheetSubmitPgClient {
  readonly statements: string[] = [];
  trialEnabled = true;
  absences: ConfirmClient['absences'] = [];
  confirmedDates: string[] = [];

  async connect(): Promise<void> {}
  async end(): Promise<void> {}

  async query<Row = Record<string, unknown>>(text: string): Promise<{ rows: Row[] }> {
    const sql = text.trim();
    this.statements.push(sql);
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql.includes('ROLLBACK')) return { rows: [] };
    if (sql.includes('FROM public.timesheet_module_settings')) {
      return { rows: [{ bank_holiday_self_override_enabled: this.trialEnabled } as Row] };
    }
    if (sql.includes('FOR UPDATE') && sql.includes('week_ending')) {
      return {
        rows: [
          {
            id: TIMESHEET_ID,
            user_id: OWNER_ID,
            week_ending: WEEK_ENDING,
            status: 'draft',
            payroll_received_at: null,
            manager_approved_at: null,
            current_payroll_snapshot_id: null,
          } as Row,
        ],
      };
    }
    if (sql.includes('COUNT(*)')) {
      return { rows: [{ count: 7 } as Row] };
    }
    if (sql.includes('UPDATE public.timesheets') && sql.includes('timesheet_type')) {
      return { rows: [{ id: TIMESHEET_ID } as Row] };
    }
    if (sql.includes('FROM public.absences')) {
      return { rows: this.absences as Row[] };
    }
    if (sql.includes('FROM public.timesheet_bank_holiday_work_confirmations')) {
      return { rows: this.confirmedDates.map((work_date) => ({ work_date }) as Row) };
    }
    if (sql.includes('INSERT INTO public.timesheet_entries')) {
      return { rows: [{ id: 'entry-1' } as Row] };
    }
    if (sql.includes('signature_data = $2')) {
      return { rows: [{ id: TIMESHEET_ID } as Row] };
    }
    return { rows: [] };
  }
}

describe('bank holiday self-override phrase', () => {
  it('BH-TRIAL-PHRASE-001 accepts only case-insensitive BANK HOLIDAY and mutates nothing on reject', async () => {
    expect(isBankHolidayConfirmPhrase('bank holiday')).toBe(true);
    expect(isBankHolidayConfirmPhrase(' BANK holiday ')).toBe(true);
    expect(isBankHolidayConfirmPhrase('BANKHOLIDAY')).toBe(false);

    const client = new ConfirmClient();
    await expect(
      confirmBankHolidayWork({
        input: {
          actorId: OWNER_ID,
          targetUserId: OWNER_ID,
          weekEnding: WEEK_ENDING,
          timesheetId: TIMESHEET_ID,
          dates: [BANK_HOLIDAY_DATE],
          phrase: 'please',
        },
        createClient: () => client,
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 });
    expect(client.statements).toEqual([]);
  });
});

describe('bank holiday self-override confirm', () => {
  it('BH-TRIAL-OVERRIDE-001 sets override only on matching bank-holiday absences and records dates', async () => {
    const client = new ConfirmClient();
    const result = await confirmBankHolidayWork({
      input: {
        actorId: OWNER_ID,
        targetUserId: OWNER_ID,
        weekEnding: WEEK_ENDING,
        timesheetId: TIMESHEET_ID,
        dates: [BANK_HOLIDAY_DATE],
        phrase: 'bank holiday',
      },
      createClient: () => client,
    });

    expect(result).toEqual({
      timesheetId: TIMESHEET_ID,
      confirmedDates: [BANK_HOLIDAY_DATE],
    });
    expect(client.statements.some((sql) => sql.includes('UPDATE public.absences'))).toBe(true);
    expect(client.statements.some((sql) => sql.includes('timesheet_bank_holiday_work_confirmations'))).toBe(true);
    expect(client.statements.at(-1)).toContain('COMMIT');

    const leaveClient = new ConfirmClient();
    leaveClient.absences = [
      {
        id: ABSENCE_ID,
        date: BANK_HOLIDAY_DATE,
        end_date: BANK_HOLIDAY_DATE,
        is_half_day: false,
        is_bank_holiday: false,
        status: 'approved',
        reason_name: 'Annual Leave',
      },
    ];

    await expect(
      confirmBankHolidayWork({
        input: {
          actorId: OWNER_ID,
          targetUserId: OWNER_ID,
          weekEnding: WEEK_ENDING,
          timesheetId: TIMESHEET_ID,
          dates: [BANK_HOLIDAY_DATE],
          phrase: 'BANK HOLIDAY',
        },
        createClient: () => leaveClient,
      })
    ).rejects.toBeInstanceOf(TimesheetBankHolidayWorkError);
    expect(leaveClient.statements.some((sql) => sql.includes('UPDATE public.absences'))).toBe(false);
    expect(leaveClient.statements.some((sql) => sql.includes('ROLLBACK'))).toBe(true);
  });

  it('BH-TRIAL-OFF-001 fails closed when the trial is disabled', async () => {
    const client = new ConfirmClient();
    client.trialEnabled = false;

    await expect(
      confirmBankHolidayWork({
        input: {
          actorId: OWNER_ID,
          targetUserId: OWNER_ID,
          weekEnding: WEEK_ENDING,
          timesheetId: TIMESHEET_ID,
          dates: [BANK_HOLIDAY_DATE],
          phrase: 'BANK HOLIDAY',
        },
        createClient: () => client,
      })
    ).rejects.toMatchObject({ code: 'TRIAL_DISABLED', status: 409 });
    expect(client.statements.some((sql) => sql.includes('UPDATE public.absences'))).toBe(false);
    expect(client.statements.some((sql) => sql.includes('ROLLBACK'))).toBe(true);
  });
});

describe('bank holiday submit fail-closed', () => {
  it('BH-TRIAL-SUBMIT-001 rejects unconfirmed bank-holiday hours before persist', async () => {
    const client = new SubmitClient();
    client.absences = [
      {
        id: ABSENCE_ID,
        date: BANK_HOLIDAY_DATE,
        end_date: BANK_HOLIDAY_DATE,
        is_half_day: false,
        is_bank_holiday: true,
        status: 'approved',
        reason_name: 'Annual Leave',
      },
    ];

    await expect(
      applyTimesheetSubmit({
        body: submitBody({ timesheetId: TIMESHEET_ID }),
        createClient: () => client,
      })
    ).rejects.toMatchObject({ code: 'BANK_HOLIDAY_CONFIRM_REQUIRED', status: 400 });
    expect(client).toBeInstanceOf(Object);
    expect(client.statements.some((sql) => sql.includes('INSERT INTO public.timesheet_entries'))).toBe(false);
    expect(client.statements.some((sql) => sql.includes('ROLLBACK'))).toBe(true);

    const confirmedClient = new SubmitClient();
    confirmedClient.absences = [
      {
        id: ABSENCE_ID,
        date: BANK_HOLIDAY_DATE,
        end_date: BANK_HOLIDAY_DATE,
        is_half_day: false,
        is_bank_holiday: true,
        status: 'approved',
        reason_name: 'Annual Leave',
      },
    ];
    confirmedClient.confirmedDates = [BANK_HOLIDAY_DATE];

    const result = await applyTimesheetSubmit({
      body: submitBody({ timesheetId: TIMESHEET_ID }),
      createClient: () => confirmedClient,
    });
    expect(result.status).toBe('submitted');
    expect(confirmedClient.statements.some((sql) => sql.includes('INSERT INTO public.timesheet_entries'))).toBe(true);
    expect(confirmedClient.statements.at(-1)).toContain('COMMIT');
  });
});

describe('bank holiday settings contract', () => {
  it('BH-TRIAL-SETTINGS-001 admin write is PIN-gated and employees use a read-only GET', () => {
    const writeRoute = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/settings/timesheet-module/route.ts'),
      'utf8'
    );
    const readRoute = fs.readFileSync(
      path.join(process.cwd(), 'app/api/timesheets/bank-holiday-self-override/route.ts'),
      'utf8'
    );
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260908_timesheet_bank_holiday_self_override.sql'),
      'utf8'
    );

    expect(writeRoute).toContain('requireAdminSettingsAccess');
    expect(writeRoute).toContain('saveTimesheetModuleSettings');
    expect(readRoute).toContain("canEffectiveRoleAccessModule('timesheets')");
    expect(readRoute).not.toContain('requireAdminSettingsAccess');
    expect(readRoute).not.toContain('saveTimesheetModuleSettings');
    expect(sql).toContain('bank_holiday_self_override_enabled BOOLEAN NOT NULL DEFAULT TRUE');
    expect(sql).toContain('CREATE POLICY timesheet_module_settings_select');
    expect(sql).not.toContain('CREATE POLICY timesheet_module_settings_update');
    expect(sql).not.toContain('FOR INSERT');
    expect(sql).not.toContain('FOR UPDATE');
    expect(sql).toContain('trg_enforce_absence_bank_holiday_provenance');
  });
});

describe('bank holiday confirmation repeat contract', () => {
  it('BH-TRIAL-REPEAT-001 skips already-confirmed dates and BH-TRIAL-REPEAT-002 prompts for a new day', () => {
    expect(
      getUnconfirmedBankHolidayDates({
        bankHolidayDates: ['2026-08-31', '2026-09-01'],
        workingDates: ['2026-08-31'],
        confirmedDates: ['2026-08-31'],
      })
    ).toEqual([]);

    expect(
      getUnconfirmedBankHolidayDates({
        bankHolidayDates: ['2026-08-31', '2026-09-01'],
        workingDates: ['2026-08-31', '2026-09-01'],
        confirmedDates: ['2026-08-31'],
      })
    ).toEqual(['2026-09-01']);
  });
});

describe('bank holiday submit notification contract', () => {
  it('BH-TRIAL-NOTIFY-001 notifies team managers plus Accounts and is submit-only', () => {
    expect(
      resolveBankHolidayWorkRecipientIds({
        employeeId: 'employee-1',
        manager1ProfileId: 'manager-1',
        manager2ProfileId: 'employee-1',
        accountsProfiles: [
          { id: 'accounts-1' },
          { id: 'employee-1' },
          { id: 'placeholder', is_placeholder: true },
          { id: 'system', is_system_account: true },
          { id: 'deleted', deleted_at: '2026-09-01T00:00:00.000Z' },
        ],
      }).sort()
    ).toEqual(['accounts-1', 'manager-1']);

    const submitRoute = fs.readFileSync(
      path.join(process.cwd(), 'app/api/timesheets/submit/route.ts'),
      'utf8'
    );
    const civilsSave = fs.readFileSync(
      path.join(process.cwd(), 'app/(dashboard)/timesheets/types/civils/CivilsTimesheet.tsx'),
      'utf8'
    );
    const plantSave = fs.readFileSync(
      path.join(process.cwd(), 'app/(dashboard)/timesheets/types/plant/PlantTimesheetV2Aligned.tsx'),
      'utf8'
    );

    expect(submitRoute).toContain('notifyBankHolidayWorkOnSubmit');
    expect(civilsSave).not.toContain('notifyBankHolidayWorkOnSubmit');
    expect(plantSave).not.toContain('notifyBankHolidayWorkOnSubmit');
    expect(civilsSave).not.toContain('Bank Holiday Warning');
  });
});
