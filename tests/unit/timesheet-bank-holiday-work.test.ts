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
  collectWorkingDatesFromEntries,
  getUnconfirmedBankHolidayDates,
  isBankHolidayConfirmPhrase,
  isMissingTimesheetModuleSettingsError,
  resolveBankHolidayActionReadiness,
  resolveBankHolidayConfirmGate,
  shouldReplaceTimesheetDraftEntries,
} from '@/lib/utils/timesheet-bank-holiday-work';
import {
  notifyBankHolidayWorkOnSubmit,
  resolveBankHolidayWorkRecipientIds,
} from '@/lib/server/timesheet-bank-holiday-work-notification';

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
  confirmationAbsenceId = ABSENCE_ID;

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
      const ids = Array.isArray(values?.[0]) ? values[0].map((id) => String(id)) : [];
      return {
        rows: this.absences
          .filter((absence) => absence.is_bank_holiday && (ids.length === 0 || ids.includes(absence.id)))
          .map((absence) => ({ id: absence.id }) as Row),
      };
    }
    if (sql.includes('INSERT INTO public.timesheet_bank_holiday_work_confirmations')) {
      const workDate = String(values?.[1] || '');
      if (!this.insertedDates.includes(workDate)) this.insertedDates.push(workDate);
      this.confirmationAbsenceId = String(values?.[2] || '');
      return { rows: [] };
    }
    if (sql.includes('FROM public.timesheet_bank_holiday_work_confirmations')) {
      return {
        rows: this.insertedDates.map(
          (work_date) => ({
            work_date,
            absence_id: this.confirmationAbsenceId,
          }) as Row
        ),
      };
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
      return {
        rows: this.confirmedDates.map(
          (work_date) => ({ work_date, absence_id: ABSENCE_ID }) as Row
        ),
      };
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

describe('bank holiday confirm readiness', () => {
  it('fails closed until the trial flag and off-day state are known', () => {
    expect(resolveBankHolidayConfirmGate({ trialReady: false, trialEnabled: false, offDaysReady: true })).toBe('not-ready');
    expect(resolveBankHolidayConfirmGate({ trialReady: true, trialEnabled: true, offDaysReady: false })).toBe('not-ready');
    expect(resolveBankHolidayConfirmGate({ trialReady: true, trialEnabled: false, offDaysReady: true })).toBe('disabled');
    expect(resolveBankHolidayConfirmGate({ trialReady: true, trialEnabled: true, offDaysReady: true })).toBe('required');
  });

  it('BH-READ-FAIL-CLOSED: a failed authoritative leave read cannot unlock Save or Submit', () => {
    expect(
      resolveBankHolidayActionReadiness({
        trialState: 'ready',
        trialEnabled: true,
        leaveState: 'failed',
        confirmationState: 'ready',
      })
    ).toEqual({ status: 'failed', failureSource: 'leave' });
  });

  it('BH-CONFIRM-READINESS: unresolved evidence blocks while the trial is enabled', () => {
    expect(
      resolveBankHolidayActionReadiness({
        trialState: 'ready',
        trialEnabled: true,
        leaveState: 'ready',
        confirmationState: 'loading',
      })
    ).toEqual({ status: 'loading', failureSource: null });
  });

  it('BH-CONFIRM-READ-FAIL: confirmation read failure fails closed', () => {
    expect(
      resolveBankHolidayActionReadiness({
        trialState: 'ready',
        trialEnabled: true,
        leaveState: 'ready',
        confirmationState: 'failed',
      })
    ).toEqual({ status: 'failed', failureSource: 'confirmation' });
  });

  it('legacy OFF does not require a confirmation table read after authoritative leave loads', () => {
    expect(
      resolveBankHolidayActionReadiness({
        trialState: 'ready',
        trialEnabled: false,
        leaveState: 'ready',
        confirmationState: 'failed',
      })
    ).toEqual({ status: 'ready', failureSource: null });
  });
});

describe('bank holiday confirmation draft adoption', () => {
  it('BH-DRAFT-ADOPT-001: replaces entries for a server-adopted existing draft ID', () => {
    const originalTimesheetId: string | null = null;
    const confirmationTimesheetId = TIMESHEET_ID;
    const resolvedTimesheetId = confirmationTimesheetId || originalTimesheetId || '';

    expect(
      shouldReplaceTimesheetDraftEntries({
        status: 'draft',
        resolvedTimesheetId,
      })
    ).toBe(true);
    expect(
      shouldReplaceTimesheetDraftEntries({
        status: 'submitted',
        resolvedTimesheetId,
      })
    ).toBe(false);
  });
});

describe('bank holiday persisted work-field coverage', () => {
  it('BH-WORK-FIELDS-001: travel-only Plant work is a bank-holiday working date', () => {
    expect(
      collectWorkingDatesFromEntries(WEEK_ENDING, [
        { day_of_week: 1, operator_travel_hours: 1.5 },
      ])
    ).toEqual([BANK_HOLIDAY_DATE]);
  });

  it('rejects did-not-work entries containing payable travel or subsistence', () => {
    const travelEntries = sevenEntries();
    travelEntries[0] = {
      ...travelEntries[0],
      time_started: null,
      time_finished: null,
      did_not_work: true,
      daily_total: 0,
      operator_travel_hours: 1,
    } as TimesheetSubmitBody['entries'][number];
    expect(() => submitBody({ entries: travelEntries })).toThrow(
      'Did not work entries cannot contain work hours or payment claims'
    );

    const subsistenceEntries = sevenEntries();
    subsistenceEntries[0] = {
      ...subsistenceEntries[0],
      time_started: null,
      time_finished: null,
      did_not_work: true,
      daily_total: 0,
      subsistence_payment_required: true,
    } as TimesheetSubmitBody['entries'][number];
    expect(() => submitBody({ entries: subsistenceEntries })).toThrow(
      'Did not work entries cannot contain work hours or payment claims'
    );
  });

  it('BH-PAID-LEAVE-REGRESSION-001: accepts paid-leave daily credit without work fields', () => {
    const paidLeaveEntries = sevenEntries();
    paidLeaveEntries[0] = {
      ...paidLeaveEntries[0],
      time_started: null,
      time_finished: null,
      did_not_work: true,
      daily_total: 9,
    };

    expect(() => submitBody({ entries: paidLeaveEntries })).not.toThrow();
  });
});

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
        loadUkBankHolidayDates: async () => new Set(['2026-01-01']),
      })
    ).rejects.toBeInstanceOf(TimesheetBankHolidayWorkError);
    expect(leaveClient.statements.some((sql) => sql.includes('UPDATE public.absences'))).toBe(false);
    expect(leaveClient.statements.some((sql) => sql.includes('ROLLBACK'))).toBe(true);
  });

  it('BH-TRIAL-CONFIRM-AL-001 confirms unflagged annual leave on a verified bank holiday without override', async () => {
    const client = new ConfirmClient();
    client.absences = [
      {
        id: ABSENCE_ID,
        date: '2026-08-31',
        end_date: '2026-09-04',
        is_half_day: false,
        is_bank_holiday: false,
        status: 'approved',
        reason_name: 'Annual Leave',
      },
    ];

    const result = await confirmBankHolidayWork({
      input: {
        actorId: OWNER_ID,
        targetUserId: OWNER_ID,
        weekEnding: WEEK_ENDING,
        timesheetId: TIMESHEET_ID,
        dates: [BANK_HOLIDAY_DATE],
        phrase: 'BANK HOLIDAY',
      },
      createClient: () => client,
      loadUkBankHolidayDates: async () => new Set([BANK_HOLIDAY_DATE]),
    });

    expect(result).toEqual({
      timesheetId: TIMESHEET_ID,
      confirmedDates: [BANK_HOLIDAY_DATE],
    });
    expect(client.statements.some((sql) => sql.includes('UPDATE public.absences'))).toBe(false);
    expect(client.statements.some((sql) => sql.includes('timesheet_bank_holiday_work_confirmations'))).toBe(true);
    expect(client.statements.at(-1)).toContain('COMMIT');
  });

  it('does not set override on a multi-day flagged bank-holiday booking', async () => {
    const client = new ConfirmClient();
    client.absences = [
      {
        id: ABSENCE_ID,
        date: '2026-08-31',
        end_date: '2026-09-04',
        is_half_day: false,
        is_bank_holiday: true,
        status: 'approved',
        reason_name: 'Annual Leave',
      },
    ];

    const result = await confirmBankHolidayWork({
      input: {
        actorId: OWNER_ID,
        targetUserId: OWNER_ID,
        weekEnding: WEEK_ENDING,
        timesheetId: TIMESHEET_ID,
        dates: [BANK_HOLIDAY_DATE],
        phrase: 'BANK HOLIDAY',
      },
      createClient: () => client,
      loadUkBankHolidayDates: async () => new Set([BANK_HOLIDAY_DATE]),
    });

    expect(result.confirmedDates).toEqual([BANK_HOLIDAY_DATE]);
    expect(client.statements.some((sql) => sql.includes('UPDATE public.absences'))).toBe(false);
  });

  it('rebinds stale same-date evidence to the current locked absence', async () => {
    const currentAbsenceId = '44444444-4444-4444-8444-444444444444';
    const client = new ConfirmClient();
    client.insertedDates = [BANK_HOLIDAY_DATE];
    client.confirmationAbsenceId = ABSENCE_ID;
    client.absences = [{ ...client.absences[0], id: currentAbsenceId }];

    const result = await confirmBankHolidayWork({
      input: {
        actorId: OWNER_ID,
        targetUserId: OWNER_ID,
        weekEnding: WEEK_ENDING,
        timesheetId: TIMESHEET_ID,
        dates: [BANK_HOLIDAY_DATE],
        phrase: 'BANK HOLIDAY',
      },
      createClient: () => client,
    });

    expect(result.confirmedDates).toEqual([BANK_HOLIDAY_DATE]);
    expect(client.confirmationAbsenceId).toBe(currentAbsenceId);
    expect(
      client.statements.some(
        (sql) =>
          sql.includes('ON CONFLICT (timesheet_id, work_date) DO UPDATE') &&
          sql.includes('absence_id = EXCLUDED.absence_id')
      )
    ).toBe(true);
  });

  it('treats a missing settings table as trial disabled so existing saves keep working', async () => {
    const client = new ConfirmClient();
    const originalQuery = client.query.bind(client);
    client.query = async (text, values) => {
      if (String(text).includes('timesheet_module_settings')) {
        const error = Object.assign(new Error('relation "timesheet_module_settings" does not exist'), {
          code: '42P01',
        });
        throw error;
      }
      return originalQuery(text, values);
    };

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

  it('requires confirmation for unflagged annual leave on a verified bank holiday', async () => {
    const client = new SubmitClient();
    client.absences = [
      {
        id: ABSENCE_ID,
        date: BANK_HOLIDAY_DATE,
        end_date: '2026-09-04',
        is_half_day: false,
        is_bank_holiday: false,
        status: 'approved',
        reason_name: 'Annual Leave',
      },
    ];

    await expect(
      applyTimesheetSubmit({
        body: submitBody({ timesheetId: TIMESHEET_ID }),
        createClient: () => client,
        loadUkBankHolidayDates: async () => new Set([BANK_HOLIDAY_DATE]),
      })
    ).rejects.toMatchObject({ code: 'BANK_HOLIDAY_CONFIRM_REQUIRED', status: 400 });
    expect(client.statements.some((sql) => sql.includes('INSERT INTO public.timesheet_entries'))).toBe(false);
  });

  it('rejects stale confirmation evidence for a different absence booking', async () => {
    const client = new SubmitClient();
    client.absences = [
      {
        id: '44444444-4444-4444-8444-444444444444',
        date: BANK_HOLIDAY_DATE,
        end_date: BANK_HOLIDAY_DATE,
        is_half_day: false,
        is_bank_holiday: true,
        status: 'approved',
        reason_name: 'Annual Leave',
      },
    ];
    client.confirmedDates = [BANK_HOLIDAY_DATE];

    await expect(
      applyTimesheetSubmit({
        body: submitBody({ timesheetId: TIMESHEET_ID }),
        createClient: () => client,
      })
    ).rejects.toMatchObject({ code: 'BANK_HOLIDAY_CONFIRM_REQUIRED', status: 400 });
    expect(client.statements.some((sql) => sql.includes('INSERT INTO public.timesheet_entries'))).toBe(false);
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
    expect(readRoute).toContain('isMissingTimesheetModuleSettingsError');
    expect(isMissingTimesheetModuleSettingsError({ code: 'PGRST205', message: 'timesheet_module_settings schema cache' })).toBe(true);
    expect(isMissingTimesheetModuleSettingsError({ code: '42P01', message: 'relation does not exist' })).toBe(true);
    expect(isMissingTimesheetModuleSettingsError({ code: '42501', message: 'permission denied' })).toBe(false);
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
  it('BH-E2E-08 and BH-E2E-09: recipients are managers plus Accounts and dispatch is submit-only', async () => {
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

    const detailPage = fs.readFileSync(
      path.join(process.cwd(), 'app/(dashboard)/timesheets/[id]/page.tsx'),
      'utf8'
    );
    expect(civilsSave).toContain('offDaysState: authoritativeOffDayState');
    expect(plantSave).toContain('offDaysState: authoritativeOffDayState');
    expect(detailPage).toContain('offDaysState: absenceLoadState');
    expect(detailPage).toContain("setAbsenceLoadState('failed')");
    expect(civilsSave).not.toContain('setOffDayStates(resolveTimesheetOffDayStates(weekEnding, [],');
    expect(plantSave).not.toContain('setOffDayStates(resolveTimesheetOffDayStates(weekEnding, [],');

    const insertedRecipients: Array<Record<string, unknown>> = [];
    type FakeResult = { data: unknown; error: null };
    class FakeAdminQuery {
      private selected = '';
      private operation: 'select' | 'insert' = 'select';
      private payload: unknown;

      constructor(private readonly table: string) {}

      select(columns: string) {
        this.selected = columns;
        return this;
      }
      insert(payload: unknown) {
        this.operation = 'insert';
        this.payload = payload;
        return this;
      }
      eq() {
        return this;
      }
      is() {
        return this;
      }
      ilike() {
        return this;
      }
      limit() {
        return this;
      }
      in() {
        return this;
      }
      async maybeSingle(): Promise<FakeResult> {
        const result = this.result();
        return {
          data: Array.isArray(result.data) ? result.data[0] || null : result.data,
          error: null,
        };
      }
      async single(): Promise<FakeResult> {
        return this.maybeSingle();
      }
      then(
        onFulfilled?: (value: FakeResult) => unknown,
        onRejected?: (reason: unknown) => unknown
      ): Promise<unknown> {
        return Promise.resolve(this.result()).then(onFulfilled, onRejected);
      }

      private result(): FakeResult {
        if (this.table === 'messages') {
          return {
            data: this.operation === 'insert' ? { id: 'message-1' } : [],
            error: null,
          };
        }
        if (this.table === 'timesheets') {
          return {
            data: { id: TIMESHEET_ID, user_id: 'employee-1', week_ending: WEEK_ENDING },
            error: null,
          };
        }
        if (this.table === 'timesheet_bank_holiday_work_confirmations') {
          return { data: [{ work_date: BANK_HOLIDAY_DATE }], error: null };
        }
        if (this.table === 'timesheet_entries') {
          return {
            data: [{ day_of_week: 1, operator_travel_hours: 1.5 }],
            error: null,
          };
        }
        if (this.table === 'profiles' && this.selected.includes('full_name')) {
          return {
            data: {
              id: 'employee-1',
              full_name: 'Employee One',
              team: {
                manager_1_profile_id: 'manager-1',
                manager_2_profile_id: 'manager-2',
              },
            },
            error: null,
          };
        }
        if (this.table === 'profiles') {
          return {
            data: [{ id: 'accounts-1', is_placeholder: false, is_system_account: false }],
            error: null,
          };
        }
        if (this.table === 'notification_preferences') {
          return { data: [], error: null };
        }
        if (this.table === 'message_recipients') {
          insertedRecipients.push(...(this.payload as Array<Record<string, unknown>>));
          return { data: null, error: null };
        }
        throw new Error(`Unexpected table ${this.table}`);
      }
    }
    const admin = { from: (table: string) => new FakeAdminQuery(table) };

    let draftDataAccessed = false;
    const draftResult = await notifyBankHolidayWorkOnSubmit({
      actorId: OWNER_ID,
      timesheetId: TIMESHEET_ID,
      status: 'draft',
      admin: {
        from: () => {
          draftDataAccessed = true;
          throw new Error('Draft notification must not access persistence');
        },
      } as never,
    });
    expect(draftResult).toEqual({ notified: false, reason: 'not-submitted' });
    expect(draftDataAccessed).toBe(false);

    await notifyBankHolidayWorkOnSubmit({
      actorId: OWNER_ID,
      timesheetId: TIMESHEET_ID,
      status: 'submitted',
      admin: admin as never,
    });

    expect(insertedRecipients.map((row) => row.user_id).sort()).toEqual([
      'accounts-1',
      'manager-1',
      'manager-2',
    ]);

    const modal = fs.readFileSync(
      path.join(process.cwd(), 'components/timesheets/BankHolidayWorkConfirmModal.tsx'),
      'utf8'
    );
    expect(modal).toContain('isBankHolidayConfirmPhrase');
    expect(modal).toContain('manager(s) and Payroll (Accounts team)');
  });
});
