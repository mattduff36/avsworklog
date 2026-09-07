import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  insertPayrollSnapshotForLockedTimesheet,
  preparePayrollSnapshotForLockedTimesheet,
} from '@/lib/server/timesheet-payroll';
import {
  TimesheetPayrollRecalculateError,
  applyTimesheetPayrollRecalculate,
} from '@/lib/server/timesheet-payroll-recalculate';
import {
  TIMESHEET_PAYROLL_EDIT_IDEMPOTENCY_CONFLICT_CODE,
  TIMESHEET_PAYROLL_EDIT_STALE_CODE,
  TIMESHEET_PAYROLL_RECALCULATE_NOSNAP_CODE,
  TIMESHEET_PAYROLL_RECALCULATE_STATUS_CODE,
} from '@/lib/utils/timesheet-gates';

vi.mock('@/lib/server/timesheet-payroll', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/timesheet-payroll')>();
  return {
    ...actual,
    preparePayrollSnapshotForLockedTimesheet: vi.fn(),
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
const CURRENT_HASH = 'civils-hash';
const NEXT_HASH = 'plant-hash';

const currentBuckets = {
  basic_minutes: 1710,
  overtime_minutes: 0,
  double_time_minutes: 0,
  operator_travel_minutes: 0,
  ipr_units: '0.0',
};

const nextBreakdown = {
  ruleSetKey: 'plant' as const,
  weekEnding: '2026-09-06',
  basicMinutes: 1440,
  overtimeMinutes: 270,
  doubleTimeMinutes: 0,
  payableMinutes: 1710,
  paidLeaveUnits: 0,
  unpaidLeaveUnits: 0,
  operatorTravelMinutes: 180,
  iprUnits: 0.6,
  subsistenceDays: 0,
  subsistenceDayNames: [],
  days: [],
};

class RecalcClient {
  readonly statements: Array<{ sql: string; values?: unknown[] }> = [];

  constructor(
    private readonly options: {
      status: string;
      snapshotId?: string | null;
      managerApprovedBy?: string | null;
      updatedAt?: string;
      currentHash?: string;
      buckets?: typeof currentBuckets;
      timestampMatches?: boolean;
      existingEdit?: {
        timesheet_id: string;
        actor_id: string;
        request_fingerprint: string;
        after_status: string;
        pay_impact: boolean;
        before_hash: string;
        after_hash: string;
        after_snapshot_id: string | null;
        notification_user_ids?: string[];
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
      return { rows: this.options.existingEdit ? [this.options.existingEdit as Row] : [] };
    }
    if (sql.includes('FOR UPDATE')) {
      return {
        rows: [{
          id: TIMESHEET_ID,
          user_id: EMPLOYEE_ID,
          week_ending: '2026-09-06',
          status: this.options.status,
          team_id: null,
          current_payroll_snapshot_id:
            this.options.snapshotId !== undefined ? this.options.snapshotId : SNAPSHOT_ID,
          updated_at: this.options.updatedAt ?? UPDATED_AT,
          manager_approved_by: this.options.managerApprovedBy ?? MANAGER_ID,
          payroll_received_by: ACTOR_ID,
        }] as Row[],
      };
    }
    if (sql.includes('updated_at = $2::timestamptz AS matches')) {
      return { rows: [{ matches: this.options.timestampMatches !== false }] as Row[] };
    }
    if (sql.includes('FROM public.timesheet_payroll_snapshots')) {
      if (!this.options.snapshotId && this.options.snapshotId !== undefined) {
        return { rows: [] };
      }
      return {
        rows: [{
          id: SNAPSHOT_ID,
          input_hash: this.options.currentHash ?? CURRENT_HASH,
          ...(this.options.buckets ?? currentBuckets),
          subsistence_days: 0,
        }] as Row[],
      };
    }
    if (sql.includes('SELECT team_id FROM public.profiles')) {
      return { rows: [{ team_id: 'civils' }] as Row[] };
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

function prepared(overrides: { inputHash?: string; breakdown?: Partial<typeof nextBreakdown> } = {}) {
  return {
    resolution: {
      rule_set_id: 'rule-plant',
      rule_version_id: 'version-plant',
      assignment_source: 'profile' as const,
      assignment_source_id: EMPLOYEE_ID,
    },
    rule: { key: 'plant', name: 'Plant' },
    days: [],
    breakdown: { ...nextBreakdown, ...overrides.breakdown },
    sourceEvidence: { engineVersion: 2 },
    inputHash: overrides.inputHash ?? NEXT_HASH,
  };
}

function baseInput(
  overrides: Partial<Parameters<typeof applyTimesheetPayrollRecalculate>[0]> = {}
) {
  return {
    timesheetId: TIMESHEET_ID,
    actorId: ACTOR_ID,
    reason: 'Apply Plant override from rollout',
    idempotencyKey: IDEMPOTENCY_ID,
    expectedStatus: 'processed',
    expectedUpdatedAt: UPDATED_AT,
    expectedSnapshotId: SNAPSHOT_ID,
    ...overrides,
  };
}

describe('payroll recalculate source contract', () => {
  it('uses prepare-then-insert and never updates snapshot totals', () => {
    const service = readFileSync(resolve(process.cwd(), 'lib/server/timesheet-payroll-recalculate.ts'), 'utf8');
    const insert = readFileSync(resolve(process.cwd(), 'lib/server/timesheet-payroll.ts'), 'utf8');
    const route = readFileSync(resolve(process.cwd(), 'app/api/timesheets/[id]/payroll-recalculate/route.ts'), 'utf8');
    expect(service).toContain('preparePayrollSnapshotForLockedTimesheet');
    expect(service).toContain('insertPayrollSnapshotForLockedTimesheet');
    expect(service).not.toContain('UPDATE public.timesheet_payroll_snapshots');
    expect(insert).toContain('export async function preparePayrollSnapshotForLockedTimesheet');
    expect(insert).toContain('INSERT INTO public.timesheet_payroll_snapshots');
    expect(route).toContain('canCurrentActorMarkTimesheetPayrollReceived');
    expect(route).toContain('canCurrentActorAuthoriseTimesheetTarget');
  });
});

describe('applyTimesheetPayrollRecalculate', () => {
  beforeEach(() => {
    vi.mocked(preparePayrollSnapshotForLockedTimesheet).mockReset();
    vi.mocked(insertPayrollSnapshotForLockedTimesheet).mockReset();
    vi.mocked(preparePayrollSnapshotForLockedTimesheet).mockResolvedValue(prepared() as never);
    vi.mocked(insertPayrollSnapshotForLockedTimesheet).mockResolvedValue({
      snapshotId: NEW_SNAPSHOT_ID,
      revision: 2,
      breakdown: nextBreakdown,
    });
  });

  it('PAY-RECALC-REVISION-001 inserts a child revision, keeps the old row, and moves the pointer', async () => {
    const client = new RecalcClient({ status: 'processed' });
    const result = await applyTimesheetPayrollRecalculate({
      ...baseInput(),
      createClient: () => client,
    });
    expect(result.snapshotId).toBe(NEW_SNAPSHOT_ID);
    expect(result.payImpact).toBe(true);
    expect(insertPayrollSnapshotForLockedTimesheet).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        prepared: expect.objectContaining({ inputHash: NEXT_HASH }),
      })
    );
    expect(client.statements.some((item) => item.sql.includes('UPDATE public.timesheet_payroll_snapshots'))).toBe(false);
    const header = client.statements.find((item) => item.sql.includes('UPDATE public.timesheets'));
    expect(header?.values?.[2]).toBe(NEW_SNAPSHOT_ID);
    expect(client.statements.some((item) => item.sql.includes('INSERT INTO public.timesheet_payroll_edits'))).toBe(true);
  });

  it('PAY-RECALC-HASH-001 leaves snapshot and header unchanged when the input hash matches', async () => {
    vi.mocked(preparePayrollSnapshotForLockedTimesheet).mockResolvedValue(
      prepared({ inputHash: CURRENT_HASH, breakdown: {
        basicMinutes: 1710,
        overtimeMinutes: 0,
        operatorTravelMinutes: 0,
        iprUnits: 0,
      } }) as never
    );
    const client = new RecalcClient({ status: 'processed' });
    const result = await applyTimesheetPayrollRecalculate({
      ...baseInput(),
      createClient: () => client,
    });
    expect(result.noop).toBe(true);
    expect(result.payImpact).toBe(false);
    expect(result.snapshotId).toBe(SNAPSHOT_ID);
    expect(insertPayrollSnapshotForLockedTimesheet).not.toHaveBeenCalled();
    expect(client.statements.some((item) => item.sql.includes('UPDATE public.timesheets'))).toBe(false);
    expect(client.statements.some((item) => item.sql.includes('INSERT INTO public.timesheet_payroll_edits'))).toBe(true);
    expect(client.statements.some((item) => item.sql.includes('INSERT INTO public.messages'))).toBe(false);
  });

  it('PAY-RECALC-MANAGER-001 demotes a processed week to approved and clears manager fields', async () => {
    const client = new RecalcClient({ status: 'processed' });
    const result = await applyTimesheetPayrollRecalculate({
      ...baseInput(),
      createClient: () => client,
    });
    expect(result.status).toBe('approved');
    const header = client.statements.find((item) => item.sql.includes('UPDATE public.timesheets'));
    expect(header?.values?.[1]).toBe('approved');
    expect(header?.values?.[3]).toBe(true);
  });

  it('PAY-RECALC-APPROVED-001 keeps an already approved week approved when buckets change', async () => {
    const client = new RecalcClient({ status: 'approved' });
    const result = await applyTimesheetPayrollRecalculate({
      ...baseInput({ expectedStatus: 'approved' }),
      createClient: () => client,
    });
    expect(result.status).toBe('approved');
    const header = client.statements.find((item) => item.sql.includes('UPDATE public.timesheets'));
    expect(header?.values?.[1]).toBe('approved');
  });

  it('PAY-RECALC-NOSNAP-001 rejects a week with no current snapshot and writes nothing', async () => {
    const client = new RecalcClient({ status: 'processed', snapshotId: null });
    await expect(
      applyTimesheetPayrollRecalculate({
        ...baseInput(),
        createClient: () => client,
      })
    ).rejects.toMatchObject({
      code: TIMESHEET_PAYROLL_RECALCULATE_NOSNAP_CODE,
    } satisfies Partial<TimesheetPayrollRecalculateError>);
    expect(preparePayrollSnapshotForLockedTimesheet).not.toHaveBeenCalled();
    expect(insertPayrollSnapshotForLockedTimesheet).not.toHaveBeenCalled();
    expect(client.statements.some((item) => item.sql.includes('UPDATE public.timesheets'))).toBe(false);
    expect(client.statements.some((item) => item.sql.includes('INSERT INTO public.timesheet_payroll_edits'))).toBe(false);
  });

  it('PAY-RECALC-STALE-001 rejects each expected-state mismatch without writes', async () => {
    const statusClient = new RecalcClient({ status: 'processed' });
    await expect(
      applyTimesheetPayrollRecalculate({
        ...baseInput({ expectedStatus: 'approved' }),
        createClient: () => statusClient,
      })
    ).rejects.toMatchObject({ code: TIMESHEET_PAYROLL_EDIT_STALE_CODE });

    const snapshotClient = new RecalcClient({ status: 'processed' });
    await expect(
      applyTimesheetPayrollRecalculate({
        ...baseInput({ expectedSnapshotId: NEW_SNAPSHOT_ID }),
        createClient: () => snapshotClient,
      })
    ).rejects.toMatchObject({ code: TIMESHEET_PAYROLL_EDIT_STALE_CODE });

    const timeClient = new RecalcClient({ status: 'processed', timestampMatches: false });
    await expect(
      applyTimesheetPayrollRecalculate({
        ...baseInput({ expectedUpdatedAt: '2026-08-09T11:00:00.000Z' }),
        createClient: () => timeClient,
      })
    ).rejects.toMatchObject({ code: TIMESHEET_PAYROLL_EDIT_STALE_CODE });

    for (const client of [statusClient, snapshotClient, timeClient]) {
      expect(preparePayrollSnapshotForLockedTimesheet).not.toHaveBeenCalled();
      expect(client.statements.some((item) => item.sql.includes('UPDATE public.timesheets'))).toBe(false);
      expect(client.statements.some((item) => item.sql.includes('INSERT INTO public.timesheet_payroll_edits'))).toBe(false);
    }

    await expect(
      applyTimesheetPayrollRecalculate({
        ...baseInput({ expectedStatus: 'manager_approved' }),
        createClient: () => new RecalcClient({ status: 'manager_approved' }),
      })
    ).rejects.toMatchObject({ code: TIMESHEET_PAYROLL_RECALCULATE_STATUS_CODE });
  });

  it('PAY-RECALC-IDEM-001 replays the same token and rejects a different fingerprint', async () => {
    const replayClient = new RecalcClient({
      status: 'processed',
      existingEdit: {
        timesheet_id: TIMESHEET_ID,
        actor_id: ACTOR_ID,
        request_fingerprint: 'will-not-match-unless-computed',
        after_status: 'approved',
        pay_impact: true,
        before_hash: CURRENT_HASH,
        after_hash: NEXT_HASH,
        after_snapshot_id: NEW_SNAPSHOT_ID,
        notification_user_ids: [MANAGER_ID],
      },
    });
    await expect(
      applyTimesheetPayrollRecalculate({
        ...baseInput(),
        createClient: () => replayClient,
      })
    ).rejects.toMatchObject({ code: TIMESHEET_PAYROLL_EDIT_IDEMPOTENCY_CONFLICT_CODE });

    const matchingFingerprint = replayClient.statements[0];
    expect(matchingFingerprint).toBeTruthy();

    const sameRequestClient = new RecalcClient({
      status: 'processed',
      existingEdit: {
        timesheet_id: TIMESHEET_ID,
        actor_id: ACTOR_ID,
        request_fingerprint: createHash('sha256')
          .update(JSON.stringify({
            timesheetId: TIMESHEET_ID,
            actorId: ACTOR_ID,
            reason: 'Apply Plant override from rollout',
            expectedStatus: 'processed',
            expectedUpdatedAt: UPDATED_AT,
            expectedSnapshotId: SNAPSHOT_ID,
          }))
          .digest('hex'),
        after_status: 'approved',
        pay_impact: true,
        before_hash: CURRENT_HASH,
        after_hash: NEXT_HASH,
        after_snapshot_id: NEW_SNAPSHOT_ID,
        notification_user_ids: [MANAGER_ID],
      },
    });
    const replay = await applyTimesheetPayrollRecalculate({
      ...baseInput(),
      createClient: () => sameRequestClient,
    });
    expect(replay.status).toBe('approved');
    expect(replay.snapshotId).toBe(NEW_SNAPSHOT_ID);
    expect(preparePayrollSnapshotForLockedTimesheet).not.toHaveBeenCalled();
  });

  it('PAY-RECALC-NOTIFY-001 notifies on a bucket change and not on a hash no-op', async () => {
    const changeClient = new RecalcClient({ status: 'processed' });
    await applyTimesheetPayrollRecalculate({
      ...baseInput(),
      createClient: () => changeClient,
    });
    expect(changeClient.statements.some((item) => item.sql.includes('INSERT INTO public.messages'))).toBe(true);

    vi.mocked(preparePayrollSnapshotForLockedTimesheet).mockResolvedValue(
      prepared({ inputHash: CURRENT_HASH, breakdown: {
        basicMinutes: 1710,
        overtimeMinutes: 0,
        operatorTravelMinutes: 0,
        iprUnits: 0,
      } }) as never
    );
    const noopClient = new RecalcClient({ status: 'processed' });
    await applyTimesheetPayrollRecalculate({
      ...baseInput({ idempotencyKey: '88888888-8888-4888-8888-888888888888' }),
      createClient: () => noopClient,
    });
    expect(noopClient.statements.some((item) => item.sql.includes('INSERT INTO public.messages'))).toBe(false);
  });
});
