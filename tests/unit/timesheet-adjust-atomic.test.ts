import { describe, expect, it } from 'vitest';
import {
  applyTimesheetAdjustmentMutation,
  type AdjustPgClient,
} from '@/lib/server/timesheet-adjust';

class RecordingClient implements AdjustPgClient {
  readonly statements: string[] = [];
  failAfterDelete = false;
  lockedStatus: 'approved' | 'adjusted' | 'processed' = 'approved';

  async connect(): Promise<void> {}

  async query<Row = Record<string, unknown>>(
    text: string
  ): Promise<{ rows: Row[] }> {
    this.statements.push(text.trim());
    if (text.includes('FOR UPDATE')) {
      return {
        rows: [{ id: '11111111-1111-4111-8111-111111111111', status: this.lockedStatus } as Row],
      };
    }
    if (this.failAfterDelete && text.includes('INSERT INTO public.timesheet_entries')) {
      throw new Error('simulated insert failure');
    }
    if (text.includes("AND status IN ('approved', 'adjusted')")) {
      if (this.lockedStatus !== 'approved' && this.lockedStatus !== 'adjusted') {
        return { rows: [] };
      }
      return { rows: [{ id: '11111111-1111-4111-8111-111111111111' } as Row] };
    }
    if (text.includes('RETURNING id::text')) {
      return { rows: [{ id: 'entry-1' } as Row] };
    }
    return { rows: [] };
  }

  async end(): Promise<void> {}
}

describe('timesheet adjustment atomicity', () => {
  it('PAY-ADJUST-ATOMICITY-001 commits demote and entry rewrite together', async () => {
    const client = new RecordingClient();
    await applyTimesheetAdjustmentMutation({
      timesheetId: '11111111-1111-4111-8111-111111111111',
      actorId: '22222222-2222-4222-8222-222222222222',
      comments: 'Corrected hours',
      notifyManagerIds: [],
      entries: [
        {
          day_of_week: 1,
          time_started: '08:00',
          time_finished: '16:00',
          daily_total: 8,
          job_numbers: ['JOB-1'],
        },
      ],
      createClient: () => client,
    });

    expect(client.statements[0]).toContain('BEGIN');
    expect(client.statements.some((sql) => sql.includes("status = 'adjusted'"))).toBe(true);
    expect(client.statements.some((sql) => sql.includes('DELETE FROM public.timesheet_entries'))).toBe(true);
    expect(client.statements.some((sql) => sql.includes('INSERT INTO public.timesheet_entries'))).toBe(true);
    expect(client.statements.some((sql) => sql.includes('INSERT INTO public.timesheet_entry_job_codes'))).toBe(true);
    expect(client.statements.at(-1)).toContain('COMMIT');
    expect(client.statements.some((sql) => sql.includes('ROLLBACK'))).toBe(false);
  });

  it('PAY-ADJUST-ATOMICITY-001 rolls back when entry rewrite fails', async () => {
    const client = new RecordingClient();
    client.failAfterDelete = true;

    await expect(
      applyTimesheetAdjustmentMutation({
        timesheetId: '11111111-1111-4111-8111-111111111111',
        actorId: '22222222-2222-4222-8222-222222222222',
        comments: 'Corrected hours',
        notifyManagerIds: [],
        entries: [
          {
            day_of_week: 1,
            time_started: '08:00',
            time_finished: '16:00',
            daily_total: 8,
            job_numbers: ['JOB-1'],
          },
        ],
        createClient: () => client,
      })
    ).rejects.toThrow(/simulated insert failure/);

    expect(client.statements.some((sql) => sql.includes('BEGIN'))).toBe(true);
    expect(client.statements.some((sql) => sql.includes('ROLLBACK'))).toBe(true);
    expect(client.statements.some((sql) => sql.includes('COMMIT'))).toBe(false);
  });

  it('PAY-ADJUST-STATE-RACE-001 rejects concurrent non-adjustable status', async () => {
    const client = new RecordingClient();
    client.lockedStatus = 'processed';

    await expect(
      applyTimesheetAdjustmentMutation({
        timesheetId: '11111111-1111-4111-8111-111111111111',
        actorId: '22222222-2222-4222-8222-222222222222',
        comments: 'Stale adjust',
        notifyManagerIds: [],
        entries: [
          {
            day_of_week: 1,
            time_started: '08:00',
            time_finished: '16:00',
            daily_total: 8,
          },
        ],
        createClient: () => client,
      })
    ).rejects.toThrow(/Only approved or already-adjusted/);

    expect(client.statements.some((sql) => sql.includes('FOR UPDATE'))).toBe(true);
    expect(client.statements.some((sql) => sql.includes('ROLLBACK'))).toBe(true);
    expect(client.statements.some((sql) => sql.includes('DELETE FROM public.timesheet_entries'))).toBe(false);
    expect(client.statements.some((sql) => sql.includes('COMMIT'))).toBe(false);
  });
});
