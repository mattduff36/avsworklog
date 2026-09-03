import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  approveTimesheetWithPayrollSnapshot,
  type PayrollPgClient,
  type PayrollPgClientFactory,
} from '@/lib/server/timesheet-payroll';

vi.mock('@/lib/utils/bank-holidays', () => ({
  fetchUKBankHolidays: async () => new Set<string>(['2026-08-31']),
}));

const TIMESHEET_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const IDEMPOTENCY_ID = '33333333-3333-4333-8333-333333333333';
const SNAPSHOT_ID = '44444444-4444-4444-8444-444444444444';
const PREVIOUS_SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';

class ApprovalClient implements PayrollPgClient {
  readonly statements: Array<{ sql: string; values?: unknown[] }> = [];

  constructor(
    private readonly options: {
      legacy?: boolean;
      existingSnapshot?: boolean;
      status?: string;
      revision?: number;
      currentSnapshotId?: string | null;
      failBeginWithSerialization?: boolean;
    } = {}
  ) {}

  async connect(): Promise<void> {}
  async end(): Promise<void> {}

  async query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[] }> {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.statements.push({ sql, values });
    if (sql.startsWith('BEGIN') && this.options.failBeginWithSerialization) {
      const error = new Error('serialization failure') as Error & { code: string };
      error.code = '40001';
      throw error;
    }
    if (sql.includes('WHERE idempotency_key = $1')) {
      return {
        rows: (this.options.existingSnapshot ? [{
          id: SNAPSHOT_ID,
          timesheet_id: TIMESHEET_ID,
          revision: 1,
          source_evidence: { breakdown: null },
        }] : []) as Row[],
      };
    }
    if (sql.includes('SELECT status FROM public.timesheets WHERE id = $1')) {
      return { rows: [{ status: this.options.status || 'submitted' }] as Row[] };
    }
    if (sql.includes('FOR UPDATE OF timesheet')) {
      return {
        rows: [{
          id: TIMESHEET_ID,
          user_id: '66666666-6666-4666-8666-666666666666',
          week_ending: '2026-08-09',
          status: this.options.status || 'submitted',
          team_id: 'transport',
          current_payroll_snapshot_id: this.options.currentSnapshotId || null,
        }] as Row[],
      };
    }
    if (
      sql.includes('FROM public.timesheet_payroll_snapshots') &&
      sql.includes('WHERE id = $1') &&
      sql.includes('AND timesheet_id = $2')
    ) {
      if (!this.options.currentSnapshotId) {
        return { rows: [] };
      }
      return {
        rows: [{
          id: this.options.currentSnapshotId,
          revision: this.options.revision || 1,
        }] as Row[],
      };
    }
    if (sql.includes('FROM public.payroll_rollout_activations')) {
      return { rows: [{ applies: !this.options.legacy }] as Row[] };
    }
    if (sql.includes('FROM chosen') && sql.includes('rule_version_id')) {
      return {
        rows: [{
          rule_set_id: '77777777-7777-4777-8777-777777777777',
          rule_key: 'plant',
          rule_name: 'Plant',
          rule_version_id: '88888888-8888-4888-8888-888888888888',
          break_threshold_minutes: 360,
          break_deduction_minutes: 30,
          bank_holiday_treatment: 'double_time',
          night_shift_treatment: 'double_time',
          operator_travel_enabled: true,
          ipr_units_per_worked_day: 0.2,
          ipr_weekly_cap: 1,
          assignment_source: 'team',
          assignment_source_id: 'transport',
        }] as Row[],
      };
    }
    if (sql.includes('FROM public.payroll_rule_day_bands')) {
      return {
        rows: Array.from({ length: 7 }, (_, index) => ({
          day_of_week: index + 1,
          treatment: index === 6 ? 'double_time' : index === 5 ? 'overtime' : 'basic',
          up_to_minutes: index < 4 ? 480 : index === 4 ? 420 : null,
          remainder_treatment: index < 5 ? 'overtime' : null,
        })) as Row[],
      };
    }
    if (sql.includes('FROM public.timesheet_entries')) {
      return {
        rows: [{
          day_of_week: 1,
          time_started: '07:30:00',
          time_finished: '18:00:00',
          daily_total: 10,
          operator_travel_hours: 1,
          did_not_work: false,
          night_shift: false,
          bank_holiday: false,
          subsistence_payment_required: true,
        }] as Row[],
      };
    }
    if (sql.includes('FROM public.absences absence')) return { rows: [] };
    if (sql.includes('FROM public.employee_work_shifts')) return { rows: [] };
    if (sql.includes('next_revision')) {
      return { rows: [{ next_revision: this.options.revision || 1 }] as Row[] };
    }
    if (sql.includes('INSERT INTO public.timesheet_payroll_snapshots')) {
      return { rows: [{ id: SNAPSHOT_ID }] as Row[] };
    }
    return { rows: [] };
  }
}

describe('transactional payroll approval', () => {
  it('PAY-ROLLOUT-001 retains the legacy path before cutover', async () => {
    const client = new ApprovalClient({ legacy: true });
    const result = await approveTimesheetWithPayrollSnapshot({
      timesheetId: TIMESHEET_ID,
      actorId: ACTOR_ID,
      idempotencyKey: IDEMPOTENCY_ID,
    }, () => client);
    expect(result.legacy).toBe(true);
    expect(result.snapshotId).toBeNull();
    expect(client.statements.some((item) => item.sql.includes('INSERT INTO public.timesheet_payroll_snapshots'))).toBe(false);
  });

  it('PAY-REAPPROVAL-001 appends revision two and supersedes the previous snapshot', async () => {
    const client = new ApprovalClient({
      status: 'adjusted',
      revision: 2,
      currentSnapshotId: PREVIOUS_SNAPSHOT_ID,
    });
    const result = await approveTimesheetWithPayrollSnapshot({
      timesheetId: TIMESHEET_ID,
      actorId: ACTOR_ID,
      idempotencyKey: IDEMPOTENCY_ID,
    }, () => client);
    expect(result.revision).toBe(2);
    expect(result.breakdown?.basicMinutes).toBe(480);
    expect(result.breakdown?.overtimeMinutes).toBe(120);
    const insert = client.statements.find((item) =>
      item.sql.includes('INSERT INTO public.timesheet_payroll_snapshots')
    );
    expect(insert?.values?.[2]).toBe(PREVIOUS_SNAPSHOT_ID);
  });

  it('PAY-CONCURRENCY-001 retries serialization failure without changing the idempotency key', async () => {
    const clients = [
      new ApprovalClient({ failBeginWithSerialization: true }),
      new ApprovalClient({ legacy: true }),
    ];
    let index = 0;
    const factory: PayrollPgClientFactory = () => clients[index++];
    const result = await approveTimesheetWithPayrollSnapshot({
      timesheetId: TIMESHEET_ID,
      actorId: ACTOR_ID,
      idempotencyKey: IDEMPOTENCY_ID,
    }, factory);
    expect(result.legacy).toBe(true);
    expect(index).toBe(2);
  });

  it('PAY-SNAPSHOT-001 returns an existing immutable snapshot for an idempotent retry', async () => {
    const client = new ApprovalClient({ existingSnapshot: true });
    const result = await approveTimesheetWithPayrollSnapshot({
      timesheetId: TIMESHEET_ID,
      actorId: ACTOR_ID,
      idempotencyKey: IDEMPOTENCY_ID,
    }, () => client);
    expect(result.snapshotId).toBe(SNAPSHOT_ID);
    expect(client.statements.some((item) => item.sql.includes('FOR UPDATE'))).toBe(false);
  });

  it('PAY-APPROVAL-IDEMPOTENT-001 returns current approved snapshot state without writes', async () => {
    const client = new ApprovalClient({
      status: 'approved',
      currentSnapshotId: SNAPSHOT_ID,
      revision: 3,
    });
    const result = await approveTimesheetWithPayrollSnapshot({
      timesheetId: TIMESHEET_ID,
      actorId: ACTOR_ID,
      idempotencyKey: IDEMPOTENCY_ID,
    }, () => client);
    expect(result).toEqual({
      timesheetId: TIMESHEET_ID,
      status: 'approved',
      legacy: false,
      snapshotId: SNAPSHOT_ID,
      revision: 3,
      breakdown: null,
    });
    expect(client.statements.some((item) => item.sql.includes('INSERT INTO'))).toBe(false);
    expect(client.statements.some((item) => item.sql.includes('UPDATE public.'))).toBe(false);
  });

  it('PAY-APPROVAL-IDEMPOTENT-LEGACY-001 returns legacy approved state without writes', async () => {
    const client = new ApprovalClient({
      status: 'approved',
      currentSnapshotId: null,
    });
    const result = await approveTimesheetWithPayrollSnapshot({
      timesheetId: TIMESHEET_ID,
      actorId: ACTOR_ID,
      idempotencyKey: IDEMPOTENCY_ID,
    }, () => client);
    expect(result).toEqual({
      timesheetId: TIMESHEET_ID,
      status: 'approved',
      legacy: true,
      snapshotId: null,
      revision: null,
      breakdown: null,
    });
    expect(client.statements.some((item) => item.sql.includes('INSERT INTO'))).toBe(false);
    expect(client.statements.some((item) => item.sql.includes('UPDATE public.'))).toBe(false);
  });

  it('TS-GATE-004 rejects expected_status mismatch without writes', async () => {
    const client = new ApprovalClient({ status: 'submitted' });
    await expect(
      approveTimesheetWithPayrollSnapshot({
        timesheetId: TIMESHEET_ID,
        actorId: ACTOR_ID,
        idempotencyKey: IDEMPOTENCY_ID,
        expectedStatus: 'approved',
      }, () => client)
    ).rejects.toThrow('Timesheet status changed before it could be marked Payroll Received.');
    expect(client.statements.some((item) => item.sql.includes('INSERT INTO'))).toBe(false);
    expect(client.statements.some((item) => item.sql.includes('UPDATE public.'))).toBe(false);
  });

  it('PAY-APPROVAL-STATE-GUARD-002 rejects rejected and draft without writes, and is idempotent for processed', async () => {
    for (const status of ['rejected', 'draft'] as const) {
      const client = new ApprovalClient({ status });
      await expect(
        approveTimesheetWithPayrollSnapshot({
          timesheetId: TIMESHEET_ID,
          actorId: ACTOR_ID,
          idempotencyKey: IDEMPOTENCY_ID,
        }, () => client)
      ).rejects.toThrow(`Timesheet cannot be marked Payroll Received from status "${status}".`);
      expect(client.statements.some((item) => item.sql.includes('INSERT INTO'))).toBe(false);
      expect(client.statements.some((item) => item.sql.includes('UPDATE public.'))).toBe(false);
    }

    const processedClient = new ApprovalClient({
      status: 'processed',
      currentSnapshotId: SNAPSHOT_ID,
      revision: 1,
    });
    const result = await approveTimesheetWithPayrollSnapshot({
      timesheetId: TIMESHEET_ID,
      actorId: ACTOR_ID,
      idempotencyKey: IDEMPOTENCY_ID,
    }, () => processedClient);
    expect(result.status).toBe('processed');
    expect(processedClient.statements.some((item) => item.sql.includes('INSERT INTO'))).toBe(false);
  });

  it('PAY-APPROVAL-GUARD-001 and PAY-RLS-IMMUTABLE-001 are enforced by migration guards', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260805_squires_payroll_rules.sql'),
      'utf8'
    );
    expect(sql).toContain('Post-cutover approval requires a payroll snapshot');
    expect(sql).toContain("NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'");
    expect(sql).toContain('Reapproval must append a snapshot revision');
    expect(sql).toContain('reject_payroll_snapshot_update_delete');
    expect(sql).toContain('reject_payroll_snapshot_day_update_delete');
    expect(sql).toContain('Payroll snapshots scoped read');
    expect(sql).toContain('payroll_is_full_admin()');
    expect(sql).not.toContain('OR (SELECT public.effective_is_manager_admin())');
    expect(sql).toContain('reject_approved_timesheet_entry_mutation');
    expect(sql).toContain('Approved timesheet entries are immutable');
    expect(readFileSync(resolve(process.cwd(), 'app/api/timesheets/[id]/payroll/route.ts'), 'utf8')).toContain(
      'canCurrentActorAuthoriseTimesheetTarget'
    );
  });
});
