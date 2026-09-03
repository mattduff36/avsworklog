import { describe, expect, it } from 'vitest';
import {
  TimesheetSubmitBodySchema,
  TimesheetSubmitError,
  applyTimesheetSubmit,
  type TimesheetSubmitBody,
  type TimesheetSubmitPgClient,
} from '@/lib/server/timesheet-submit';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const TIMESHEET_ID = '22222222-2222-4222-8222-222222222222';
const WEEK_ENDING = '2026-09-06';
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

type LockedRow = {
  id: string;
  user_id: string;
  week_ending: string;
  status: string;
  payroll_received_at: string | null;
  manager_approved_at: string | null;
  current_payroll_snapshot_id: string | null;
};

class RecordingClient implements TimesheetSubmitPgClient {
  readonly statements: string[] = [];
  hintRow: LockedRow | null = null;
  weekRows: LockedRow[] = [];
  entryCount = 0;
  persistedCount = 7;
  failOn: 'insert-entry' | 'mark-submitted' | null = null;
  private weekLockCalls = 0;
  private countCalls = 0;
  private insertedHeader = false;

  async connect(): Promise<void> {}
  async end(): Promise<void> {}

  async query<Row = Record<string, unknown>>(
    text: string
  ): Promise<{ rows: Row[] }> {
    const sql = text.trim();
    this.statements.push(sql);

    if (sql.includes('ROLLBACK')) return { rows: [] };
    if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };

    if (sql.includes('FOR UPDATE') && sql.includes('WHERE id = $1')) {
      return { rows: (this.hintRow ? [this.hintRow] : []) as Row[] };
    }
    if (sql.includes('INSERT INTO public.timesheets')) {
      this.insertedHeader = true;
      return { rows: [] };
    }
    if (sql.includes('FOR UPDATE') && sql.includes('week_ending')) {
      const queued = this.weekRows[this.weekLockCalls] ?? null;
      this.weekLockCalls += 1;
      const row = queued ?? (this.insertedHeader ? draftRow() : null);
      return { rows: (row ? [row] : []) as Row[] };
    }
    if (sql.includes('COUNT(*)')) {
      const count = this.countCalls === 0 ? this.entryCount : this.persistedCount;
      this.countCalls += 1;
      return { rows: [{ count } as Row] };
    }
    if (sql.includes("SET\n        status = 'draft'") || sql.includes("status = 'draft'")) {
      if (sql.includes("AND status = 'submitted'")) {
        return { rows: [{ id: TIMESHEET_ID } as Row] };
      }
    }
    if (sql.includes('UPDATE public.timesheets') && sql.includes('timesheet_type')) {
      return { rows: [{ id: TIMESHEET_ID } as Row] };
    }
    if (sql.includes('signature_data = $2')) {
      if (this.failOn === 'mark-submitted') {
        throw new Error('simulated submit failure');
      }
      return { rows: [{ id: TIMESHEET_ID } as Row] };
    }
    if (sql.includes('INSERT INTO public.timesheet_entries')) {
      if (this.failOn === 'insert-entry') {
        throw new Error('simulated insert failure');
      }
      return { rows: [{ id: `entry-${this.statements.length}` } as Row] };
    }
    return { rows: [] };
  }
}

function draftRow(overrides: Partial<LockedRow> = {}): LockedRow {
  return {
    id: TIMESHEET_ID,
    user_id: OWNER_ID,
    week_ending: WEEK_ENDING,
    status: 'draft',
    payroll_received_at: null,
    manager_approved_at: null,
    current_payroll_snapshot_id: null,
    ...overrides,
  };
}

describe('timesheet submit persistence', () => {
  it('TS-SAVE-001 creates a new submitted header with seven entries in one transaction', async () => {
    const client = new RecordingClient();

    const result = await applyTimesheetSubmit({
      body: submitBody(),
      createClient: () => client,
    });

    expect(result).toEqual({ id: TIMESHEET_ID, status: 'submitted' });
    expect(client.statements[0]).toContain('BEGIN');
    expect(client.statements.some((sql) => sql.includes('INSERT INTO public.timesheets'))).toBe(true);
    expect(client.statements.filter((sql) => sql.includes('INSERT INTO public.timesheet_entries'))).toHaveLength(7);
    expect(client.statements.some((sql) => sql.includes('INSERT INTO public.timesheet_entry_job_codes'))).toBe(true);
    expect(client.statements.some((sql) => sql.includes("status = 'submitted'"))).toBe(true);
    expect(client.statements.some((sql) => sql.includes('app.timesheet_payroll_edit'))).toBe(false);
    expect(client.statements.at(-1)).toContain('COMMIT');
    const submittedAt = client.statements.findIndex((sql) => sql.includes('signature_data = $2'));
    const firstEntry = client.statements.findIndex((sql) => sql.includes('INSERT INTO public.timesheet_entries'));
    expect(firstEntry).toBeGreaterThan(-1);
    expect(submittedAt).toBeGreaterThan(firstEntry);
  });

  it('TS-SAVE-002 completes an empty ungated submitted orphan and refuses a complete submitted retry', async () => {
    const recover = new RecordingClient();
    recover.hintRow = draftRow({ status: 'submitted' });
    recover.entryCount = 0;

    await applyTimesheetSubmit({
      body: submitBody({ timesheetId: TIMESHEET_ID }),
      createClient: () => recover,
    });

    expect(recover.statements.some((sql) => sql.includes("AND status = 'submitted'"))).toBe(true);
    expect(recover.statements.at(-1)).toContain('COMMIT');

    const retry = new RecordingClient();
    retry.hintRow = draftRow({ status: 'submitted' });
    retry.entryCount = 7;

    await expect(
      applyTimesheetSubmit({
        body: submitBody({ timesheetId: TIMESHEET_ID }),
        createClient: () => retry,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(retry.statements.some((sql) => sql.includes('ROLLBACK'))).toBe(true);
    expect(retry.statements.some((sql) => sql.includes('COMMIT'))).toBe(false);
  });

  it('TS-SAVE-003 TEST-TS-SAVE-003 submits an existing draft or rejected sheet after replacing entries', async () => {
    const draft = new RecordingClient();
    draft.hintRow = draftRow();
    draft.entryCount = 7;

    const draftResult = await applyTimesheetSubmit({
      body: submitBody({ timesheetId: TIMESHEET_ID }),
      createClient: () => draft,
    });

    expect(draftResult.status).toBe('submitted');
    expect(draft.statements.some((sql) => sql.includes('DELETE FROM public.timesheet_entries'))).toBe(true);
    expect(draft.statements.some((sql) => sql.includes("status = 'submitted'"))).toBe(true);
    expect(draft.statements.at(-1)).toContain('COMMIT');

    const rejected = new RecordingClient();
    rejected.hintRow = draftRow({ status: 'rejected' });
    rejected.entryCount = 7;

    const rejectedResult = await applyTimesheetSubmit({
      body: submitBody({ timesheetId: TIMESHEET_ID }),
      createClient: () => rejected,
    });

    expect(rejectedResult.status).toBe('submitted');
    expect(rejected.statements.some((sql) => sql.includes("AND status = 'submitted'"))).toBe(false);
    expect(rejected.statements.some((sql) => sql.includes("status = 'submitted'"))).toBe(true);
    expect(rejected.statements.at(-1)).toContain('COMMIT');
  });

  it('TS-SAVE-005 rolls back when entry persist fails and never marks submitted', async () => {
    const client = new RecordingClient();
    client.failOn = 'insert-entry';

    await expect(
      applyTimesheetSubmit({
        body: submitBody(),
        createClient: () => client,
      })
    ).rejects.toThrow('simulated insert failure');

    expect(client.statements.some((sql) => sql.includes('ROLLBACK'))).toBe(true);
    expect(client.statements.some((sql) => sql.includes('COMMIT'))).toBe(false);
    expect(client.statements.some((sql) => sql.includes('signature_data = $2'))).toBe(false);
  });

  it('TS-SAVE-009 rejects extra fields, duplicate days, identity mismatch, and same-week conflict', async () => {
    expect(
      TimesheetSubmitBodySchema.safeParse({
        ...submitBody(),
        status: 'submitted',
      }).success
    ).toBe(false);

    const duplicateDays = sevenEntries();
    duplicateDays[1] = { ...duplicateDays[1], day_of_week: 1 };
    expect(
      TimesheetSubmitBodySchema.safeParse({
        userId: OWNER_ID,
        weekEnding: WEEK_ENDING,
        timesheetType: 'civils',
        signatureData: SIGNATURE,
        entries: duplicateDays,
      }).success
    ).toBe(false);

    const client = new RecordingClient();
    client.hintRow = draftRow({ user_id: '33333333-3333-4333-8333-333333333333' });

    await expect(
      applyTimesheetSubmit({
        body: submitBody({ timesheetId: TIMESHEET_ID }),
        createClient: () => client,
      })
    ).rejects.toBeInstanceOf(TimesheetSubmitError);

    const raced = new RecordingClient();
    raced.weekRows = [draftRow({ status: 'submitted' })];
    raced.entryCount = 7;
    await expect(
      applyTimesheetSubmit({
        body: submitBody(),
        createClient: () => raced,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(raced.statements.some((sql) => sql.includes('ROLLBACK'))).toBe(true);
    expect(raced.statements.some((sql) => sql.includes('COMMIT'))).toBe(false);
  });
});
