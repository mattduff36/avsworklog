import { describe, expect, it } from 'vitest';
import {
  TimesheetGateConflictError,
  applyTimesheetManagerApproved,
  applyTimesheetReject,
  type TimesheetGatePgClient,
} from '@/lib/server/timesheet-gate-mutations';

const TIMESHEET_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const EMPLOYEE_ID = '66666666-6666-4666-8666-666666666666';

class GateClient implements TimesheetGatePgClient {
  readonly statements: Array<{ sql: string; values?: unknown[] }> = [];

  constructor(private readonly status: string) {}

  async connect(): Promise<void> {}
  async end(): Promise<void> {}

  async query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[] }> {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.statements.push({ sql, values });
    if (sql.includes('FOR UPDATE')) {
      return {
        rows: [{
          id: TIMESHEET_ID,
          status: this.status,
          updated_at: '2026-08-09T10:00:00.000Z',
          payroll_received_by: ACTOR_ID,
          manager_approved_by: null,
          user_id: EMPLOYEE_ID,
          week_ending: '2026-08-09',
        }] as Row[],
      };
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

// Candidate-bound supporting evidence for ws_303cb13a69947b08 Manager Approved lock.
describe('timesheet gate mutations', () => {
  it('TS-GATE-004 returns conflict and writes nothing on expected_status mismatch', async () => {
    const processClient = new GateClient('approved');
    await expect(
      applyTimesheetManagerApproved({
        timesheetId: TIMESHEET_ID,
        actorId: ACTOR_ID,
        expectedStatus: 'submitted',
        createClient: () => processClient,
      })
    ).rejects.toBeInstanceOf(TimesheetGateConflictError);
    expect(processClient.statements.some((item) => item.sql.includes('UPDATE public.timesheets'))).toBe(false);

    const rejectClient = new GateClient('approved');
    await expect(
      applyTimesheetReject({
        timesheetId: TIMESHEET_ID,
        actorId: ACTOR_ID,
        comments: 'Please fix Friday',
        expectedStatus: 'submitted',
        createClient: () => rejectClient,
      })
    ).rejects.toBeInstanceOf(TimesheetGateConflictError);
    expect(rejectClient.statements.some((item) => item.sql.includes('UPDATE public.timesheets'))).toBe(false);
  });

  it('FD-VERIFY-TS-GATE-004 keeps stale expected_status fail-closed on the process-lock candidate', async () => {
    const processClient = new GateClient('approved');
    await expect(
      applyTimesheetManagerApproved({
        timesheetId: TIMESHEET_ID,
        actorId: ACTOR_ID,
        expectedStatus: 'submitted',
        createClient: () => processClient,
      })
    ).rejects.toBeInstanceOf(TimesheetGateConflictError);
    expect(processClient.statements.some((item) => item.sql.includes('UPDATE public.timesheets'))).toBe(false);
  });

  it('TS-GATE-003 clears both gates and the snapshot pointer on reject', async () => {
    const client = new GateClient('approved');
    const result = await applyTimesheetReject({
      timesheetId: TIMESHEET_ID,
      actorId: ACTOR_ID,
      comments: 'Please fix Friday',
      expectedStatus: 'approved',
      createClient: () => client,
    });
    expect(result.previousStatus).toBe('approved');
    const update = client.statements.find((item) => item.sql.includes('UPDATE public.timesheets'));
    expect(update?.sql).toContain('payroll_received_at = NULL');
    expect(update?.sql).toContain('manager_approved_at = NULL');
    expect(update?.sql).toContain('current_payroll_snapshot_id = NULL');
    expect(client.statements.some((item) => item.sql.includes('INSERT INTO public.messages'))).toBe(true);
  });
});
