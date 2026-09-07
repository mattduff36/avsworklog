import { createHash } from 'crypto';
import pg from 'pg';
import {
  insertPayrollSnapshotForLockedTimesheet,
  preparePayrollSnapshotForLockedTimesheet,
  type PayrollPgClient,
  type TimesheetPayrollLockRow,
} from '@/lib/server/timesheet-payroll';
import { insertTimesheetNotificationInTransaction } from '@/lib/server/timesheet-gate-mutations';
import {
  TIMESHEET_PAYROLL_EDIT_IDEMPOTENCY_CONFLICT_CODE,
  TIMESHEET_PAYROLL_EDIT_STALE_CODE,
  TIMESHEET_PAYROLL_RECALCULATE_NOSNAP_CODE,
  TIMESHEET_PAYROLL_RECALCULATE_STATUS_CODE,
  statusAfterClearingManagerGate,
} from '@/lib/utils/timesheet-gates';

const { Client } = pg;
const MAX_SERIALIZATION_RETRIES = 3;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class TimesheetPayrollRecalculateError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TimesheetPayrollRecalculateError';
    this.code = code;
  }
}

type RecalcPgClient = PayrollPgClient;

function createRecalcPgClient(): RecalcPgClient {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('Missing database connection string for payroll recalculate');
  }
  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  }) as RecalcPgClient;
}

export interface ApplyTimesheetPayrollRecalculateInput {
  timesheetId: string;
  actorId: string;
  reason: string;
  idempotencyKey: string;
  expectedStatus: string;
  expectedUpdatedAt: string;
  expectedSnapshotId: string;
  createClient?: () => RecalcPgClient;
}

export interface ApplyTimesheetPayrollRecalculateResult {
  status: string;
  payImpact: boolean;
  noop: boolean;
  beforeHash: string;
  afterHash: string;
  snapshotId: string;
  notificationUserIds: string[];
}

async function withSerializableRetry<T>(
  work: (client: RecalcPgClient) => Promise<T>,
  createClient: () => RecalcPgClient = createRecalcPgClient
): Promise<T> {
  let attempt = 0;
  while (attempt < MAX_SERIALIZATION_RETRIES) {
    const client = createClient();
    await client.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const code = (error as { code?: string }).code;
      attempt += 1;
      if (code !== '40001' || attempt >= MAX_SERIALIZATION_RETRIES) throw error;
    } finally {
      await client.end();
    }
  }
  throw new Error('Payroll recalculate could not be completed.');
}

function recalculateRequestFingerprint(input: ApplyTimesheetPayrollRecalculateInput): string {
  return createHash('sha256')
    .update(JSON.stringify({
      timesheetId: input.timesheetId,
      actorId: input.actorId,
      reason: input.reason.trim(),
      expectedStatus: input.expectedStatus,
      expectedUpdatedAt: input.expectedUpdatedAt,
      expectedSnapshotId: input.expectedSnapshotId,
    }))
    .digest('hex');
}

function toComparableNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function payBucketsChanged(
  current: {
    basic_minutes: string | number | null;
    overtime_minutes: string | number | null;
    double_time_minutes: string | number | null;
    operator_travel_minutes: string | number | null;
    ipr_units: string | number | null;
  },
  next: {
    basicMinutes: number;
    overtimeMinutes: number;
    doubleTimeMinutes: number;
    operatorTravelMinutes: number;
    iprUnits: number;
  }
): boolean {
  return (
    toComparableNumber(current.basic_minutes) !== next.basicMinutes
    || toComparableNumber(current.overtime_minutes) !== next.overtimeMinutes
    || toComparableNumber(current.double_time_minutes) !== next.doubleTimeMinutes
    || toComparableNumber(current.operator_travel_minutes) !== next.operatorTravelMinutes
    || toComparableNumber(current.ipr_units) !== next.iprUnits
  );
}

export async function applyTimesheetPayrollRecalculate(
  input: ApplyTimesheetPayrollRecalculateInput
): Promise<ApplyTimesheetPayrollRecalculateResult> {
  if (!UUID_PATTERN.test(input.idempotencyKey)) {
    throw new Error('A valid idempotency_key is required');
  }
  if (!input.reason.trim()) {
    throw new Error('A reason is required for payroll recalculate');
  }
  if (!input.expectedUpdatedAt.trim() || Number.isNaN(Date.parse(input.expectedUpdatedAt))) {
    throw new Error('expected_updated_at must be an ISO-8601 timestamp');
  }
  if (!UUID_PATTERN.test(input.expectedSnapshotId)) {
    throw new TimesheetPayrollRecalculateError(
      TIMESHEET_PAYROLL_EDIT_STALE_CODE,
      'expected_snapshot_id must be a UUID'
    );
  }
  if (input.expectedStatus !== 'approved' && input.expectedStatus !== 'processed') {
    throw new TimesheetPayrollRecalculateError(
      TIMESHEET_PAYROLL_RECALCULATE_STATUS_CODE,
      'Only Payroll Received or Complete timesheets can be recalculated.'
    );
  }

  return withSerializableRetry(async (client) => {
    const requestFingerprint = recalculateRequestFingerprint(input);
    const existingEdit = await client.query<{
      timesheet_id: string;
      actor_id: string;
      request_fingerprint: string;
      after_status: string;
      pay_impact: boolean;
      before_hash: string | null;
      after_hash: string | null;
      after_snapshot_id: string | null;
      notification_user_ids: string[] | null;
    }>(
      `
        SELECT
          timesheet_id::text,
          actor_id::text,
          request_fingerprint,
          after_status, pay_impact, before_hash, after_hash, after_snapshot_id::text, notification_user_ids
        FROM public.timesheet_payroll_edits
        WHERE idempotency_key = $1
      `,
      [input.idempotencyKey]
    );
    if (existingEdit.rows[0]) {
      const existing = existingEdit.rows[0];
      if (
        existing.timesheet_id !== input.timesheetId
        || existing.actor_id !== input.actorId
        || existing.request_fingerprint !== requestFingerprint
      ) {
        throw new TimesheetPayrollRecalculateError(
          TIMESHEET_PAYROLL_EDIT_IDEMPOTENCY_CONFLICT_CODE,
          'This save token was already used for a different payroll recalculate. Reload and try again.'
        );
      }
      return {
        status: existing.after_status,
        payImpact: existing.pay_impact,
        noop: existing.after_snapshot_id === input.expectedSnapshotId && existing.pay_impact === false,
        beforeHash: existing.before_hash || '',
        afterHash: existing.after_hash || '',
        snapshotId: existing.after_snapshot_id || input.expectedSnapshotId,
        notificationUserIds: existing.notification_user_ids || [],
      };
    }

    const locked = await client.query<TimesheetPayrollLockRow & {
      manager_approved_by: string | null;
      payroll_received_by: string | null;
      user_id: string;
    }>(
      `
        SELECT
          id::text,
          user_id::text,
          week_ending::text,
          status,
          NULL::text AS team_id,
          current_payroll_snapshot_id::text,
          updated_at::text,
          manager_approved_by::text,
          payroll_received_by::text
        FROM public.timesheets
        WHERE id = $1
        FOR UPDATE
      `,
      [input.timesheetId]
    );
    const timesheet = locked.rows[0];
    if (!timesheet) throw new Error('Timesheet not found');
    if (timesheet.status !== 'approved' && timesheet.status !== 'processed') {
      throw new TimesheetPayrollRecalculateError(
        TIMESHEET_PAYROLL_RECALCULATE_STATUS_CODE,
        'Only Payroll Received or Complete timesheets can be recalculated.'
      );
    }
    if (timesheet.status !== input.expectedStatus) {
      throw new TimesheetPayrollRecalculateError(
        TIMESHEET_PAYROLL_EDIT_STALE_CODE,
        'Timesheet status changed before it could be recalculated.'
      );
    }
    if (!timesheet.current_payroll_snapshot_id) {
      throw new TimesheetPayrollRecalculateError(
        TIMESHEET_PAYROLL_RECALCULATE_NOSNAP_CODE,
        'This week has no frozen payroll snapshot, so it cannot be recalculated.'
      );
    }
    if (timesheet.current_payroll_snapshot_id !== input.expectedSnapshotId) {
      throw new TimesheetPayrollRecalculateError(
        TIMESHEET_PAYROLL_EDIT_STALE_CODE,
        'Payroll snapshot changed before this recalculate could be saved.'
      );
    }
    const timestampMatch = await client.query<{ matches: boolean }>(
      `
        SELECT updated_at = $2::timestamptz AS matches
        FROM public.timesheets
        WHERE id = $1
      `,
      [timesheet.id, input.expectedUpdatedAt]
    );
    if (timestampMatch.rows[0]?.matches !== true) {
      throw new TimesheetPayrollRecalculateError(
        TIMESHEET_PAYROLL_EDIT_STALE_CODE,
        'Timesheet changed before it could be recalculated.'
      );
    }

    const currentSnapshot = await client.query<{
      id: string;
      input_hash: string;
      basic_minutes: string | number | null;
      overtime_minutes: string | number | null;
      double_time_minutes: string | number | null;
      operator_travel_minutes: string | number | null;
      ipr_units: string | number | null;
      subsistence_days: string | number | null;
    }>(
      `
        SELECT
          id::text,
          input_hash,
          basic_minutes,
          overtime_minutes,
          double_time_minutes,
          operator_travel_minutes,
          ipr_units,
          subsistence_days
        FROM public.timesheet_payroll_snapshots
        WHERE id = $1
          AND timesheet_id = $2
      `,
      [timesheet.current_payroll_snapshot_id, timesheet.id]
    );
    const snapshot = currentSnapshot.rows[0];
    if (!snapshot) {
      throw new TimesheetPayrollRecalculateError(
        TIMESHEET_PAYROLL_RECALCULATE_NOSNAP_CODE,
        'This week has no frozen payroll snapshot, so it cannot be recalculated.'
      );
    }

    const profile = await client.query<{ team_id: string | null }>(
      `SELECT team_id FROM public.profiles WHERE id = $1`,
      [timesheet.user_id]
    );
    timesheet.team_id = profile.rows[0]?.team_id ?? null;

    const prepared = await preparePayrollSnapshotForLockedTimesheet(client, timesheet);
    const hashUnchanged = snapshot.input_hash === prepared.inputHash;
    const bucketsChanged = payBucketsChanged(snapshot, prepared.breakdown);
    const payImpact = !hashUnchanged && bucketsChanged;
    const nextStatus = payImpact ? statusAfterClearingManagerGate(timesheet.status) : timesheet.status;
    let nextSnapshotId = timesheet.current_payroll_snapshot_id;
    const notificationUserIds: string[] = [];

    if (!hashUnchanged) {
      const inserted = await insertPayrollSnapshotForLockedTimesheet(client, {
        timesheet,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        prepared,
      });
      nextSnapshotId = inserted.snapshotId;
    }

    if (payImpact) {
      if (timesheet.manager_approved_by) {
        notificationUserIds.push(timesheet.manager_approved_by);
      } else if (timesheet.team_id) {
        const authorisers = await client.query<{ id: string }>(
          `
            SELECT profile.id::text
            FROM public.profiles profile
            JOIN public.roles role ON role.id = profile.role_id
            WHERE profile.team_id = $1
              AND profile.id <> $2
              AND (
                COALESCE(role.is_manager_admin, false) = true
                OR COALESCE(role.is_super_admin, false) = true
              )
          `,
          [timesheet.team_id, timesheet.user_id]
        );
        notificationUserIds.push(...authorisers.rows.map((row) => row.id));
      }
      notificationUserIds.push(timesheet.user_id);
    }

    if (!hashUnchanged) {
      const headerUpdate = await client.query<{ id: string }>(
        `
          UPDATE public.timesheets
          SET
            status = $2,
            current_payroll_snapshot_id = $3,
            manager_approved_at = CASE WHEN $4 THEN NULL ELSE manager_approved_at END,
            manager_approved_by = CASE WHEN $4 THEN NULL ELSE manager_approved_by END,
            processed_at = CASE WHEN $4 THEN NULL ELSE processed_at END,
            updated_at = NOW()
          WHERE id = $1
            AND status = $5
            AND updated_at = $6::timestamptz
          RETURNING id::text
        `,
        [
          input.timesheetId,
          nextStatus,
          nextSnapshotId,
          payImpact,
          input.expectedStatus,
          input.expectedUpdatedAt,
        ]
      );
      if (!headerUpdate.rows[0]?.id) {
        throw new TimesheetPayrollRecalculateError(
          TIMESHEET_PAYROLL_EDIT_STALE_CODE,
          'Timesheet changed before it could be recalculated.'
        );
      }
    }

    await client.query(
      `
        INSERT INTO public.timesheet_payroll_edits (
          timesheet_id, actor_id, reason, pay_impact, client_pay_impact, idempotency_key,
          request_fingerprint, before_hash, after_hash, before_status, after_status,
          before_snapshot_id, after_snapshot_id, before_totals, after_totals,
          notification_user_ids
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14::jsonb, $15::jsonb,
          $16::uuid[]
        )
      `,
      [
        input.timesheetId,
        input.actorId,
        input.reason.trim(),
        payImpact,
        payImpact,
        input.idempotencyKey,
        requestFingerprint,
        snapshot.input_hash,
        prepared.inputHash,
        timesheet.status,
        hashUnchanged ? timesheet.status : nextStatus,
        timesheet.current_payroll_snapshot_id,
        nextSnapshotId,
        JSON.stringify({
          basic_minutes: snapshot.basic_minutes,
          overtime_minutes: snapshot.overtime_minutes,
          double_time_minutes: snapshot.double_time_minutes,
          operator_travel_minutes: snapshot.operator_travel_minutes,
          ipr_units: snapshot.ipr_units,
        }),
        JSON.stringify({
          basic_minutes: prepared.breakdown.basicMinutes,
          overtime_minutes: prepared.breakdown.overtimeMinutes,
          double_time_minutes: prepared.breakdown.doubleTimeMinutes,
          operator_travel_minutes: prepared.breakdown.operatorTravelMinutes,
          ipr_units: prepared.breakdown.iprUnits,
        }),
        notificationUserIds,
      ]
    );

    if (payImpact && notificationUserIds.length > 0) {
      await insertTimesheetNotificationInTransaction(client, {
        senderId: input.actorId,
        subject: 'Timesheet pay figures were amended',
        body: `Payroll recalculated this timesheet from the current payroll rule. Manager Approved was cleared if it was set. Reason: ${input.reason.trim()}`,
        recipientIds: notificationUserIds,
      });
    }

    return {
      status: hashUnchanged ? timesheet.status : nextStatus,
      payImpact,
      noop: hashUnchanged,
      beforeHash: snapshot.input_hash,
      afterHash: prepared.inputHash,
      snapshotId: nextSnapshotId,
      notificationUserIds,
    };
  }, input.createClient);
}
