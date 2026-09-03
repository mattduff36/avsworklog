import { createHash } from 'crypto';
import pg from 'pg';
import type { AdjustableTimesheetEntryInput, AdjustPgClient } from '@/lib/server/timesheet-adjust';
import { persistTimesheetEntries } from '@/lib/server/timesheet-adjust';
import {
  insertPayrollSnapshotForLockedTimesheet,
  type PayrollPgClient,
  type TimesheetPayrollLockRow,
} from '@/lib/server/timesheet-payroll';
import {
  insertTimesheetNotificationInTransaction,
  TimesheetGateConflictError,
} from '@/lib/server/timesheet-gate-mutations';
import {
  TIMESHEET_PAYROLL_EDIT_PAY_IMPACT_MISMATCH_CODE,
  TIMESHEET_PAYROLL_EDIT_SNAPSHOTLESS_CODE,
  TIMESHEET_PAYROLL_EDIT_STALE_CODE,
  TIMESHEET_PAYROLL_EDIT_IDEMPOTENCY_CONFLICT_CODE,
  hasPayrollReceivedGate,
  statusAfterClearingManagerGate,
} from '@/lib/utils/timesheet-gates';
import {
  canonicalPayDayFromEntry,
  canonicalPayWeekFromEntries,
  classifyTimesheetPayImpact,
  padCanonicalPayWeek,
} from '@/lib/utils/timesheet-pay-hash';

const { Client } = pg;
const MAX_SERIALIZATION_RETRIES = 3;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class TimesheetPayrollEditError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TimesheetPayrollEditError';
    this.code = code;
  }
}

type EditPgClient = AdjustPgClient & PayrollPgClient;

function createEditPgClient(): EditPgClient {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('Missing database connection string for payroll edit');
  }
  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  }) as EditPgClient;
}

export interface ApplyTimesheetPayrollEditInput {
  timesheetId: string;
  actorId: string;
  reason: string;
  idempotencyKey: string;
  expectedStatus: string;
  expectedUpdatedAt: string;
  expectedSnapshotId: string | null;
  clientPayImpact: boolean;
  entries: AdjustableTimesheetEntryInput[];
  createClient?: () => EditPgClient;
}

export interface ApplyTimesheetPayrollEditResult {
  status: string;
  payImpact: boolean;
  beforeHash: string;
  afterHash: string;
  snapshotId: string | null;
  notificationUserIds: string[];
}

async function withSerializableRetry<T>(
  work: (client: EditPgClient) => Promise<T>,
  createClient: () => EditPgClient = createEditPgClient
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
  throw new Error('Payroll edit could not be completed.');
}

function payrollEditRequestFingerprint(input: ApplyTimesheetPayrollEditInput): string {
  return createHash('sha256')
    .update(JSON.stringify({
      timesheetId: input.timesheetId,
      actorId: input.actorId,
      reason: input.reason.trim(),
      expectedStatus: input.expectedStatus,
      expectedUpdatedAt: input.expectedUpdatedAt,
      expectedSnapshotId: input.expectedSnapshotId,
      clientPayImpact: input.clientPayImpact,
      entries: input.entries,
    }))
    .digest('hex');
}

export async function applyTimesheetPayrollEdit(
  input: ApplyTimesheetPayrollEditInput
): Promise<ApplyTimesheetPayrollEditResult> {
  if (!UUID_PATTERN.test(input.idempotencyKey)) {
    throw new Error('A valid idempotency_key is required');
  }
  if (!input.reason.trim()) {
    throw new Error('A reason is required for payroll edits');
  }
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    throw new Error('Entry payload is required');
  }
  if (input.expectedSnapshotId !== null && !UUID_PATTERN.test(input.expectedSnapshotId)) {
    throw new TimesheetPayrollEditError(
      TIMESHEET_PAYROLL_EDIT_STALE_CODE,
      'expected_snapshot_id must be a UUID or null'
    );
  }

  return withSerializableRetry(async (client) => {
    const requestFingerprint = payrollEditRequestFingerprint(input);
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
        existing.timesheet_id !== input.timesheetId ||
        existing.actor_id !== input.actorId ||
        existing.request_fingerprint !== requestFingerprint
      ) {
        throw new TimesheetPayrollEditError(
          TIMESHEET_PAYROLL_EDIT_IDEMPOTENCY_CONFLICT_CODE,
          'This save token was already used for a different payroll edit. Reload and try again.'
        );
      }
      return {
        status: existing.after_status,
        payImpact: existing.pay_impact,
        beforeHash: existing.before_hash || '',
        afterHash: existing.after_hash || '',
        snapshotId: existing.after_snapshot_id,
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
    if (timesheet.status === 'draft') {
      throw new TimesheetPayrollEditError(
        TIMESHEET_PAYROLL_EDIT_STALE_CODE,
        'Draft timesheets are edited by the employee, not payroll edit.'
      );
    }
    if (timesheet.status !== input.expectedStatus) {
      throw new TimesheetPayrollEditError(
        TIMESHEET_PAYROLL_EDIT_STALE_CODE,
        'Timesheet status changed before it could be edited.'
      );
    }
    if (
      (timesheet.current_payroll_snapshot_id || null) !== (input.expectedSnapshotId || null)
    ) {
      throw new TimesheetPayrollEditError(
        TIMESHEET_PAYROLL_EDIT_STALE_CODE,
        'Payroll snapshot changed before this edit could be saved.'
      );
    }

    const currentEntries = await client.query<{
      day_of_week: number;
      time_started: string | null;
      time_finished: string | null;
      daily_total: string | number | null;
      operator_travel_hours: string | number | null;
      did_not_work: boolean | null;
      night_shift: boolean | null;
      bank_holiday: boolean | null;
      subsistence_payment_required: boolean | null;
    }>(
      `
        SELECT
          day_of_week,
          time_started::text,
          time_finished::text,
          daily_total,
          operator_travel_hours,
          did_not_work,
          night_shift,
          bank_holiday,
          subsistence_payment_required
        FROM public.timesheet_entries
        WHERE timesheet_id = $1
        ORDER BY day_of_week
      `,
      [input.timesheetId]
    );

    const currentDays = padCanonicalPayWeek(currentEntries.rows.map(canonicalPayDayFromEntry));
    const proposedDays = canonicalPayWeekFromEntries(input.entries);
    const classification = classifyTimesheetPayImpact({
      currentDays,
      proposedDays,
      proposedEntries: input.entries,
    });

    if (classification.payImpact !== input.clientPayImpact) {
      throw new TimesheetPayrollEditError(
        TIMESHEET_PAYROLL_EDIT_PAY_IMPACT_MISMATCH_CODE,
        'This save would change pay differently than the warning shown. Reload and confirm again.'
      );
    }

    const beforeTotals = await client.query<{
      basic_minutes: number | null;
      overtime_minutes: number | null;
      double_time_minutes: number | null;
      subsistence_days: number | null;
    }>(
      `
        SELECT basic_minutes, overtime_minutes, double_time_minutes, subsistence_days
        FROM public.timesheet_payroll_snapshots
        WHERE id = $1
      `,
      [timesheet.current_payroll_snapshot_id]
    );

    const profile = await client.query<{ team_id: string | null }>(
      `SELECT team_id FROM public.profiles WHERE id = $1`,
      [timesheet.user_id]
    );
    timesheet.team_id = profile.rows[0]?.team_id ?? null;

    await client.query(`SELECT set_config('app.timesheet_payroll_edit', '1', true)`);
    await persistTimesheetEntries(client, input.timesheetId, input.entries);

    let nextStatus = timesheet.status;
    let nextSnapshotId = timesheet.current_payroll_snapshot_id;
    const notificationUserIds: string[] = [];

    if (classification.payImpact) {
      if (hasPayrollReceivedGate(timesheet.status)) {
        const rollout = await client.query<{ applies: boolean }>(
          `
            SELECT EXISTS (
              SELECT 1
              FROM public.payroll_rollout_activations
              WHERE effective_week_ending <= $1
            ) AS applies
          `,
          [timesheet.week_ending]
        );
        if (!rollout.rows[0]?.applies) {
          throw new TimesheetPayrollEditError(
            TIMESHEET_PAYROLL_EDIT_SNAPSHOTLESS_CODE,
            'This historic week has no frozen payroll snapshot, so hour changes cannot be saved. Job-number corrections are still allowed.'
          );
        }
        const snapshot = await insertPayrollSnapshotForLockedTimesheet(client, {
          timesheet: {
            ...timesheet,
            current_payroll_snapshot_id: timesheet.current_payroll_snapshot_id,
          },
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey,
        });
        nextSnapshotId = snapshot.snapshotId;
      }

      nextStatus = statusAfterClearingManagerGate(timesheet.status);
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

    const totals = await client.query<{
      basic_minutes: number | null;
      overtime_minutes: number | null;
      double_time_minutes: number | null;
      subsistence_days: number | null;
    }>(
      `
        SELECT basic_minutes, overtime_minutes, double_time_minutes, subsistence_days
        FROM public.timesheet_payroll_snapshots
        WHERE id = $1
      `,
      [nextSnapshotId]
    );

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
        classification.payImpact,
        input.expectedStatus,
        input.expectedUpdatedAt,
      ]
    );
    if (!headerUpdate.rows[0]?.id) {
      throw new TimesheetPayrollEditError(
        TIMESHEET_PAYROLL_EDIT_STALE_CODE,
        'Timesheet changed before it could be edited.'
      );
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
        classification.payImpact,
        input.clientPayImpact,
        input.idempotencyKey,
        requestFingerprint,
        classification.beforeHash,
        classification.afterHash,
        timesheet.status,
        nextStatus,
        timesheet.current_payroll_snapshot_id,
        nextSnapshotId,
        beforeTotals.rows[0] ? JSON.stringify(beforeTotals.rows[0]) : null,
        totals.rows[0] ? JSON.stringify(totals.rows[0]) : null,
        notificationUserIds,
      ]
    );

    if (classification.payImpact && notificationUserIds.length > 0) {
      await insertTimesheetNotificationInTransaction(client, {
        senderId: input.actorId,
        subject: 'Timesheet pay figures were amended',
        body: `Payroll amended hours or pay on this timesheet. Manager Approved was cleared if it was set. Reason: ${input.reason.trim()}`,
        recipientIds: notificationUserIds,
      });
    }

    return {
      status: nextStatus,
      payImpact: classification.payImpact,
      beforeHash: classification.beforeHash,
      afterHash: classification.afterHash,
      snapshotId: nextSnapshotId,
      notificationUserIds,
    };
  }, input.createClient);
}

export { TimesheetGateConflictError };
