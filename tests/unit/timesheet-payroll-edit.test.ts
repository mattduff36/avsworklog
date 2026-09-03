import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdjustableTimesheetEntryInput } from '@/lib/server/timesheet-adjust';
import { persistTimesheetEntries } from '@/lib/server/timesheet-adjust';
import { insertPayrollSnapshotForLockedTimesheet } from '@/lib/server/timesheet-payroll';
import {
  TimesheetPayrollEditError,
  applyTimesheetPayrollEdit,
} from '@/lib/server/timesheet-payroll-edit';
import {
  TIMESHEET_PAYROLL_EDIT_PAY_IMPACT_MISMATCH_CODE,
  TIMESHEET_PAYROLL_EDIT_STALE_CODE,
  TIMESHEET_PAYROLL_EDIT_IDEMPOTENCY_CONFLICT_CODE,
} from '@/lib/utils/timesheet-gates';

vi.mock('@/lib/server/timesheet-adjust', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/timesheet-adjust')>();
  return {
    ...actual,
    persistTimesheetEntries: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/lib/server/timesheet-payroll', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/timesheet-payroll')>();
  return {
    ...actual,
    insertPayrollSnapshotForLockedTimesheet: vi.fn(),
  };
});

const TIMESHEET_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const EMPLOYEE_ID = '66666666-6666-4666-8666-666666666666';
const MANAGER_ID = '77777777-7777-4777-8777-777777777777';
const IDEMPOTENCY_ID = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT_ID = '44444444-4444-4444-8444-444444444444';
const NEW_SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';
const UPDATED_AT = '2026-08-09T10:00:00.000Z';

const currentPayEntry = {
  day_of_week: 1,
  time_started: '08:00:00',
  time_finished: '16:00:00',
  daily_total: 8,
  operator_travel_hours: 0,
  did_not_work: false,
  night_shift: false,
  bank_holiday: false,
  subsistence_payment_required: false,
};

const costingEntry: AdjustableTimesheetEntryInput = {
  ...currentPayEntry,
  job_number: 'D9999',
  remarks: 'Corrected job',
};

const payEntry: AdjustableTimesheetEntryInput = {
  ...currentPayEntry,
  time_finished: '18:00:00',
  daily_total: 10,
  job_number: 'D7328',
};

class EditClient {
  readonly statements: Array<{ sql: string; values?: unknown[] }> = [];

  constructor(
    private readonly options: {
      status: string;
      snapshotId?: string | null;
      managerApprovedBy?: string | null;
      updatedAt?: string;
      existingEdit?: {
        timesheet_id: string;
        actor_id: string;
        request_fingerprint: string;
        after_status: string;
        pay_impact: boolean;
        before_hash: string;
        after_hash: string;
        after_snapshot_id: string | null;
      };
    }
  ) {}

  async connect(): Promise<void> {}
  async end(): Promise<void> {}

  async query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[] }> {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.statements.push({ sql, values });
    if (sql.includes('FROM public.timesheet_payroll_edits')) {
      if (this.options.existingEdit) {
        return { rows: [this.options.existingEdit] as Row[] };
      }
      return { rows: [] };
    }
    if (sql.includes('FOR UPDATE')) {
      return {
        rows: [{
          id: TIMESHEET_ID,
          user_id: EMPLOYEE_ID,
          week_ending: '2026-08-09',
          status: this.options.status,
          team_id: null,
          current_payroll_snapshot_id: this.options.snapshotId !== undefined ? this.options.snapshotId : SNAPSHOT_ID,
          updated_at: this.options.updatedAt ?? UPDATED_AT,
          manager_approved_by: this.options.managerApprovedBy ?? MANAGER_ID,
          payroll_received_by: ACTOR_ID,
        }] as Row[],
      };
    }
    if (sql.includes('FROM public.timesheet_entries')) {
      return { rows: [currentPayEntry] as Row[] };
    }
    if (sql.includes('FROM public.timesheet_payroll_snapshots')) {
      return {
        rows: [{
          basic_minutes: 480,
          overtime_minutes: 0,
          double_time_minutes: 0,
          subsistence_days: 0,
        }] as Row[],
      };
    }
    if (sql.includes('SELECT team_id FROM public.profiles')) {
      return { rows: [{ team_id: 'transport' }] as Row[] };
    }
    if (sql.includes('FROM public.payroll_rollout_activations')) {
      return { rows: [{ applies: true }] as Row[] };
    }
    if (sql.includes('UPDATE public.timesheets')) {
      return { rows: [{ id: TIMESHEET_ID }] as Row[] };
    }
    if (sql.includes('INSERT INTO public.messages')) {
      return { rows: [{ id: 'message-1' }] as Row[] };
    }
    return { rows: [] };
  }
}

function baseInput(overrides: Partial<Parameters<typeof applyTimesheetPayrollEdit>[0]> = {}) {
  return {
    timesheetId: TIMESHEET_ID,
    actorId: ACTOR_ID,
    reason: 'Corrected hours',
    idempotencyKey: IDEMPOTENCY_ID,
    expectedStatus: 'processed',
    expectedUpdatedAt: UPDATED_AT,
    expectedSnapshotId: SNAPSHOT_ID,
    clientPayImpact: false,
    entries: [costingEntry],
    ...overrides,
  };
}

describe('applyTimesheetPayrollEdit', () => {
  beforeEach(() => {
    vi.mocked(persistTimesheetEntries).mockClear();
    vi.mocked(persistTimesheetEntries).mockResolvedValue(undefined);
    vi.mocked(insertPayrollSnapshotForLockedTimesheet).mockReset();
    vi.mocked(insertPayrollSnapshotForLockedTimesheet).mockResolvedValue({
      snapshotId: NEW_SNAPSHOT_ID,
      revision: 2,
      breakdown: {
        basicMinutes: 480,
        overtimeMinutes: 120,
        doubleTimeMinutes: 0,
        subsistenceDays: 0,
      },
    } as never);
  });

  it('TS-GATE-004 returns 409 and writes nothing when expected_status mismatches', async () => {
    const client = new EditClient({ status: 'processed' });
    await expect(
      applyTimesheetPayrollEdit({
        ...baseInput({ expectedStatus: 'approved' }),
        createClient: () => client,
      })
    ).rejects.toMatchObject({
      code: TIMESHEET_PAYROLL_EDIT_STALE_CODE,
    } satisfies Partial<TimesheetPayrollEditError>);
    expect(persistTimesheetEntries).not.toHaveBeenCalled();
    expect(client.statements.some((item) => item.sql.includes('UPDATE public.timesheets'))).toBe(false);
    expect(client.statements.some((item) => item.sql.includes('COMMIT'))).toBe(false);
  });

  it('TS-EDIT-001 keeps status, gates and snapshot id for job-number-only edits', async () => {
    const client = new EditClient({ status: 'processed' });
    const result = await applyTimesheetPayrollEdit({
      ...baseInput(),
      createClient: () => client,
    });
    expect(result).toMatchObject({
      status: 'processed',
      payImpact: false,
      snapshotId: SNAPSHOT_ID,
    });
    expect(insertPayrollSnapshotForLockedTimesheet).not.toHaveBeenCalled();
    const header = client.statements.find((item) => item.sql.includes('UPDATE public.timesheets'));
    expect(header?.values).toEqual([
      TIMESHEET_ID,
      'processed',
      SNAPSHOT_ID,
      false,
      'processed',
      UPDATED_AT,
    ]);
  });

  it('TS-EDIT-002 rebuilds the snapshot and clears Manager Approved when pay changes on Complete', async () => {
    const client = new EditClient({ status: 'processed' });
    const result = await applyTimesheetPayrollEdit({
      ...baseInput({
        clientPayImpact: true,
        entries: [payEntry],
      }),
      createClient: () => client,
    });
    expect(result.status).toBe('approved');
    expect(result.payImpact).toBe(true);
    expect(result.snapshotId).toBe(NEW_SNAPSHOT_ID);
    expect(insertPayrollSnapshotForLockedTimesheet).toHaveBeenCalled();
    const header = client.statements.find((item) => item.sql.includes('UPDATE public.timesheets'));
    expect(header?.values?.[1]).toBe('approved');
    expect(header?.values?.[2]).toBe(NEW_SNAPSHOT_ID);
    expect(header?.values?.[3]).toBe(true);
    expect(client.statements.some((item) => item.sql.includes('INSERT INTO public.timesheet_payroll_edits'))).toBe(true);
  });

  it('TS-EDIT-003 demotes manager-only weeks to submitted when pay changes', async () => {
    const client = new EditClient({ status: 'manager_approved', snapshotId: null });
    const result = await applyTimesheetPayrollEdit({
      ...baseInput({
        expectedStatus: 'manager_approved',
        expectedSnapshotId: null,
        clientPayImpact: true,
        entries: [payEntry],
      }),
      createClient: () => client,
    });
    expect(result.status).toBe('submitted');
    expect(result.payImpact).toBe(true);
    expect(insertPayrollSnapshotForLockedTimesheet).not.toHaveBeenCalled();
  });

  it('TS-EDIT-004 rejects a client pay_impact false that disagrees with the hash', async () => {
    const client = new EditClient({ status: 'processed' });
    await expect(
      applyTimesheetPayrollEdit({
        ...baseInput({
          clientPayImpact: false,
          entries: [payEntry],
        }),
        createClient: () => client,
      })
    ).rejects.toMatchObject({
      code: TIMESHEET_PAYROLL_EDIT_PAY_IMPACT_MISMATCH_CODE,
    });
    expect(persistTimesheetEntries).not.toHaveBeenCalled();
    expect(client.statements.some((item) => item.sql.includes('UPDATE public.timesheets'))).toBe(false);
  });

  it('TS-EDIT-005 rolls back entry writes when snapshot rebuild fails', async () => {
    vi.mocked(insertPayrollSnapshotForLockedTimesheet).mockRejectedValue(
      new Error('snapshot rebuild failed')
    );
    const client = new EditClient({ status: 'processed' });
    await expect(
      applyTimesheetPayrollEdit({
        ...baseInput({
          clientPayImpact: true,
          entries: [payEntry],
        }),
        createClient: () => client,
      })
    ).rejects.toThrow('snapshot rebuild failed');
    expect(persistTimesheetEntries).toHaveBeenCalled();
    expect(client.statements.some((item) => item.sql.includes('COMMIT'))).toBe(false);
    expect(client.statements.some((item) => item.sql.includes('ROLLBACK'))).toBe(true);
    expect(client.statements.some((item) => item.sql.includes('UPDATE public.timesheets'))).toBe(false);
  });

  it('TS-ARCH-HASH-001 keeps gates for a seven-day job-only payload against sparse rows', async () => {
    const client = new EditClient({ status: 'processed' });
    const result = await applyTimesheetPayrollEdit({
      ...baseInput({
        entries: [
          costingEntry,
          { day_of_week: 2 },
          { day_of_week: 3 },
          { day_of_week: 4 },
          { day_of_week: 5 },
          { day_of_week: 6 },
          { day_of_week: 7 },
        ],
      }),
      createClient: () => client,
    });
    expect(result.payImpact).toBe(false);
    expect(result.status).toBe('processed');
    expect(result.snapshotId).toBe(SNAPSHOT_ID);
  });

  it('TS-ARCH-CAS-001 rejects a snapshot pointer mismatch without writes', async () => {
    const client = new EditClient({ status: 'processed' });
    await expect(
      applyTimesheetPayrollEdit({
        ...baseInput({ expectedSnapshotId: NEW_SNAPSHOT_ID }),
        createClient: () => client,
      })
    ).rejects.toMatchObject({ code: TIMESHEET_PAYROLL_EDIT_STALE_CODE });
    expect(persistTimesheetEntries).not.toHaveBeenCalled();
  });

  it('TS-ARCH-CAS-002 rejects empty snapshot ids before any write', async () => {
    const client = new EditClient({ status: 'processed' });
    await expect(
      applyTimesheetPayrollEdit({
        ...baseInput({ expectedSnapshotId: '' }),
        createClient: () => client,
      })
    ).rejects.toMatchObject({ code: TIMESHEET_PAYROLL_EDIT_STALE_CODE });
    expect(persistTimesheetEntries).not.toHaveBeenCalled();
  });

  it('TS-ARCH-IDEM-001 rejects reused idempotency keys for a different payload', async () => {
    const client = new EditClient({
      status: 'processed',
      existingEdit: {
        timesheet_id: TIMESHEET_ID,
        actor_id: ACTOR_ID,
        request_fingerprint: 'not-this-request',
        after_status: 'processed',
        pay_impact: false,
        before_hash: 'a',
        after_hash: 'b',
        after_snapshot_id: SNAPSHOT_ID,
      },
    });
    await expect(
      applyTimesheetPayrollEdit({
        ...baseInput(),
        createClient: () => client,
      })
    ).rejects.toMatchObject({ code: TIMESHEET_PAYROLL_EDIT_IDEMPOTENCY_CONFLICT_CODE });
    expect(persistTimesheetEntries).not.toHaveBeenCalled();
  });
});
