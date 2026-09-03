import { createHash } from 'crypto';
import pg from 'pg';
import { calculatePayrollWeek } from '@/lib/payroll/calculate';
import type {
  PayrollAssignmentSource,
  PayrollDayBand,
  PayrollDayInput,
  PayrollRuleConfiguration,
  PayrollRuleSetKey,
  PayrollTreatment,
  PayrollWeekBreakdown,
} from '@/lib/payroll/types';
import { validatePayrollRule } from '@/lib/payroll/schema';
import {
  type ApprovedAbsenceForTimesheet,
  formatLocalIsoDate,
  getTimesheetEntryDateFromWeekEnding,
  resolveTimesheetOffDayStates,
} from '@/lib/utils/timesheet-off-days';
import { fetchUKBankHolidays } from '@/lib/utils/bank-holidays';
import type { WorkShiftPattern } from '@/types/work-shifts';
import { hasPayrollReceivedGate, resolveTimesheetPayrollReceivedAction } from '@/lib/utils/timesheet-gates';

const { Client } = pg;
export const PAYROLL_ENGINE_VERSION = 2;
const ENGINE_VERSION = PAYROLL_ENGINE_VERSION;
const MAX_SERIALIZATION_RETRIES = 3;

interface QueryResult<Row> {
  rows: Row[];
}

export interface PayrollPgClient {
  connect(): Promise<void>;
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<Row>>;
  end(): Promise<void>;
}

export type PayrollPgClientFactory = () => PayrollPgClient;

export interface TimesheetPayrollLockRow {
  id: string;
  user_id: string;
  week_ending: string;
  status: string;
  team_id: string | null;
  current_payroll_snapshot_id: string | null;
  updated_at: string | null;
}

interface EntryRow {
  day_of_week: number;
  time_started: string | null;
  time_finished: string | null;
  daily_total: string | number | null;
  operator_travel_hours: string | number | null;
  did_not_work: boolean | null;
  night_shift: boolean | null;
  bank_holiday: boolean | null;
  subsistence_payment_required: boolean | null;
}

interface RuleResolutionRow {
  rule_set_id: string;
  rule_key: PayrollRuleSetKey;
  rule_name: string;
  rule_version_id: string;
  break_threshold_minutes: number;
  break_deduction_minutes: number;
  bank_holiday_treatment: PayrollTreatment;
  night_shift_treatment: PayrollTreatment | null;
  operator_travel_enabled: boolean;
  ipr_units_per_worked_day: string | number;
  ipr_weekly_cap: string | number;
  assignment_source: PayrollAssignmentSource;
  assignment_source_id: string | null;
}

interface BandRow {
  day_of_week: number;
  treatment: PayrollTreatment;
  up_to_minutes: number | null;
  remainder_treatment: PayrollTreatment | null;
}

export interface ApproveTimesheetPayrollInput {
  timesheetId: string;
  actorId: string;
  idempotencyKey: string;
  expectedStatus?: string;
}

export interface ApproveTimesheetPayrollResult {
  timesheetId: string;
  status: 'approved' | 'processed';
  legacy: boolean;
  snapshotId: string | null;
  revision: number | null;
  breakdown: PayrollWeekBreakdown | null;
}

export interface PreviewTimesheetPayrollInput {
  userId: string;
  weekEnding: string;
  days: PayrollDayInput[];
}

export interface PreviewTimesheetPayrollResult {
  legacy: boolean;
  breakdown: PayrollWeekBreakdown | null;
}

function createPayrollPgClient(): PayrollPgClient {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('Missing database connection string for payroll approval');
  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  }) as PayrollPgClient;
}

function entryDateForDay(weekEnding: string, dayOfWeek: number): string {
  return formatLocalIsoDate(getTimesheetEntryDateFromWeekEnding(weekEnding, dayOfWeek));
}

function toNumber(value: string | number | null): number {
  if (value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function resolveRule(
  client: PayrollPgClient,
  timesheet: TimesheetPayrollLockRow
): Promise<{ row: RuleResolutionRow; rule: PayrollRuleConfiguration }> {
  const resolution = await client.query<RuleResolutionRow>(
    `
      WITH profile_assignment AS (
        SELECT assignment.rule_set_id, assignment.profile_id::text AS source_id, assignment.is_active
        FROM public.payroll_profile_rule_assignments assignment
        WHERE assignment.profile_id = $1
          AND assignment.effective_week_ending <= $3
        ORDER BY assignment.effective_week_ending DESC
        LIMIT 1
      ),
      team_assignment AS (
        SELECT assignment.rule_set_id, assignment.team_id::text AS source_id
        FROM public.payroll_team_rule_assignments assignment
        WHERE assignment.team_id = $2
          AND assignment.effective_week_ending <= $3
        ORDER BY assignment.effective_week_ending DESC
        LIMIT 1
      ),
      chosen AS (
        SELECT
          COALESCE(
            (SELECT rule_set_id FROM profile_assignment WHERE is_active),
            (SELECT rule_set_id FROM team_assignment),
            (SELECT id FROM public.payroll_rule_sets WHERE rule_key = 'civils')
          ) AS rule_set_id,
          CASE
            WHEN EXISTS (SELECT 1 FROM profile_assignment WHERE is_active) THEN 'profile'
            WHEN EXISTS (SELECT 1 FROM team_assignment) THEN 'team'
            ELSE 'fallback'
          END AS assignment_source,
          COALESCE(
            (SELECT source_id FROM profile_assignment WHERE is_active),
            (SELECT source_id FROM team_assignment)
          ) AS assignment_source_id
      )
      SELECT
        rule_set.id AS rule_set_id,
        rule_set.rule_key,
        rule_set.name AS rule_name,
        version.id AS rule_version_id,
        version.break_threshold_minutes,
        version.break_deduction_minutes,
        version.bank_holiday_treatment,
        version.night_shift_treatment,
        version.operator_travel_enabled,
        version.ipr_units_per_worked_day,
        version.ipr_weekly_cap,
        chosen.assignment_source,
        chosen.assignment_source_id
      FROM chosen
      JOIN public.payroll_rule_sets rule_set ON rule_set.id = chosen.rule_set_id
      JOIN LATERAL (
        SELECT candidate.*
        FROM public.payroll_rule_versions candidate
        WHERE candidate.rule_set_id = rule_set.id
          AND candidate.status IN ('active', 'archived')
          AND candidate.effective_week_ending <= $3
        ORDER BY candidate.effective_week_ending DESC, candidate.version_number DESC
        LIMIT 1
      ) version ON true
    `,
    [timesheet.user_id, timesheet.team_id, timesheet.week_ending]
  );
  const row = resolution.rows[0];
  if (!row) throw new Error('Payroll configuration is incomplete for this timesheet week.');

  const bandResult = await client.query<BandRow>(
    `
      SELECT day_of_week, treatment, up_to_minutes, remainder_treatment
      FROM public.payroll_rule_day_bands
      WHERE rule_version_id = $1
      ORDER BY day_of_week
    `,
    [row.rule_version_id]
  );
  const dayBands: Record<number, PayrollDayBand> = {};
  for (const band of bandResult.rows) {
    dayBands[band.day_of_week] = {
      treatment: band.treatment,
      upToMinutes: band.up_to_minutes ?? undefined,
      remainderTreatment: band.remainder_treatment ?? undefined,
    };
  }

  const rule: PayrollRuleConfiguration = {
    key: row.rule_key,
    name: row.rule_name,
    breakThresholdMinutes: row.break_threshold_minutes,
    breakDeductionMinutes: row.break_deduction_minutes,
    bankHolidayTreatment: row.bank_holiday_treatment,
    nightShiftTreatment: row.night_shift_treatment,
    dayBands,
    operatorTravelEnabled: row.operator_travel_enabled,
    iprUnitsPerWorkedDay: toNumber(row.ipr_units_per_worked_day),
    iprWeeklyCap: toNumber(row.ipr_weekly_cap),
  };
  const errors = validatePayrollRule(rule);
  if (errors.length > 0) throw new Error(`Payroll configuration is invalid: ${errors.join(' ')}`);
  return { row, rule };
}

async function loadCanonicalLeaveByDay(
  client: PayrollPgClient,
  userId: string,
  weekEnding: string
): Promise<Map<number, { paidLeaveUnits: number; unpaidLeaveUnits: number }>> {
  const [absencesResult, workShiftResult] = await Promise.all([
    client.query<ApprovedAbsenceForTimesheet>(
      `
        SELECT
          absence.id::text,
          absence.date::text,
          COALESCE(absence.end_date, absence.date)::text AS end_date,
          absence.status,
          absence.is_half_day,
          absence.half_day_session,
          absence.allow_timesheet_work_on_leave,
          jsonb_build_object(
            'name', reason.name,
            'color', reason.color,
            'is_paid', reason.is_paid
          ) AS absence_reasons
        FROM public.absences absence
        JOIN public.absence_reasons reason ON reason.id = absence.reason_id
        WHERE absence.profile_id = $1
          AND absence.status IN ('approved', 'processed')
          AND absence.date <= $2::date
          AND COALESCE(absence.end_date, absence.date) >= ($2::date - INTERVAL '6 days')::date
      `,
      [userId, weekEnding]
    ),
    client.query<WorkShiftPattern>(
      `
        SELECT
          monday_am,
          monday_pm,
          tuesday_am,
          tuesday_pm,
          wednesday_am,
          wednesday_pm,
          thursday_am,
          thursday_pm,
          friday_am,
          friday_pm,
          saturday_am,
          saturday_pm,
          sunday_am,
          sunday_pm
        FROM public.employee_work_shifts
        WHERE profile_id = $1
        LIMIT 1
      `,
      [userId]
    ),
  ]);

  return new Map(
    resolveTimesheetOffDayStates(
      weekEnding,
      absencesResult.rows,
      workShiftResult.rows[0] || null
    ).map((state) => [
      state.day_of_week,
      {
        paidLeaveUnits: state.paidLeaveUnits,
        unpaidLeaveUnits: state.unpaidLeaveUnits,
      },
    ])
  );
}

export async function insertPayrollSnapshotForLockedTimesheet(
  client: PayrollPgClient,
  input: {
    timesheet: TimesheetPayrollLockRow;
    actorId: string;
    idempotencyKey: string;
  }
): Promise<{ snapshotId: string; revision: number; breakdown: PayrollWeekBreakdown }> {
  const timesheet = input.timesheet;
  const [{ row: resolution, rule }, entriesResult, leaveByDay, bankHolidays] = await Promise.all([
    resolveRule(client, timesheet),
    client.query<EntryRow>(
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
      [timesheet.id]
    ),
    loadCanonicalLeaveByDay(client, timesheet.user_id, timesheet.week_ending),
    fetchUKBankHolidays('england-and-wales').then((dates) => {
      if (dates.size === 0) {
        throw new Error('Unable to verify UK bank holidays for payroll approval.');
      }
      return dates;
    }),
  ]);

  const days: PayrollDayInput[] = entriesResult.rows.map((entry) => {
    const leave = leaveByDay.get(entry.day_of_week);
    const entryDate = entryDateForDay(timesheet.week_ending, entry.day_of_week);
    return {
      dayOfWeek: entry.day_of_week,
      timeStarted: entry.time_started,
      timeFinished: entry.time_finished,
      workedMinutesOverride: Math.round(toNumber(entry.daily_total) * 60),
      nightShift: entry.night_shift === true,
      bankHoliday: bankHolidays.has(entryDate),
      didNotWork: entry.did_not_work === true,
      operatorTravelHours: toNumber(entry.operator_travel_hours),
      subsistence: entry.subsistence_payment_required === true,
      paidLeaveUnits: leave?.paidLeaveUnits || 0,
      unpaidLeaveUnits: leave?.unpaidLeaveUnits || 0,
    };
  });
  const breakdown = calculatePayrollWeek({
    weekEnding: timesheet.week_ending,
    rule,
    days,
  });
  const sourceEvidence = {
    engineVersion: ENGINE_VERSION,
    assignment: {
      source: resolution.assignment_source,
      sourceId: resolution.assignment_source_id,
    },
    rule,
    days,
    breakdown,
  };
  const inputHash = createHash('sha256')
    .update(JSON.stringify(sourceEvidence))
    .digest('hex');

  const revisionResult = await client.query<{ next_revision: number }>(
    `
      SELECT COALESCE(MAX(revision), 0) + 1 AS next_revision
      FROM public.timesheet_payroll_snapshots
      WHERE timesheet_id = $1
    `,
    [timesheet.id]
  );
  const revision = Number(revisionResult.rows[0]?.next_revision ?? 1);
  const snapshotResult = await client.query<{ id: string }>(
    `
      INSERT INTO public.timesheet_payroll_snapshots (
        timesheet_id,
        revision,
        supersedes_snapshot_id,
        rule_set_id,
        rule_version_id,
        assignment_source,
        assignment_source_id,
        engine_version,
        input_hash,
        idempotency_key,
        basic_minutes,
        overtime_minutes,
        double_time_minutes,
        payable_minutes,
        paid_leave_units,
        unpaid_leave_units,
        operator_travel_minutes,
        ipr_units,
        subsistence_days,
        subsistence_day_names,
        source_evidence,
        approved_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22
      )
      RETURNING id
    `,
    [
      timesheet.id,
      revision,
      timesheet.current_payroll_snapshot_id,
      resolution.rule_set_id,
      resolution.rule_version_id,
      resolution.assignment_source,
      resolution.assignment_source_id,
      ENGINE_VERSION,
      inputHash,
      input.idempotencyKey,
      breakdown.basicMinutes,
      breakdown.overtimeMinutes,
      breakdown.doubleTimeMinutes,
      breakdown.payableMinutes,
      breakdown.paidLeaveUnits,
      breakdown.unpaidLeaveUnits,
      breakdown.operatorTravelMinutes,
      breakdown.iprUnits,
      breakdown.subsistenceDays,
      breakdown.subsistenceDayNames,
      JSON.stringify(sourceEvidence),
      input.actorId,
    ]
  );
  const snapshotId = snapshotResult.rows[0]?.id;
  if (!snapshotId) throw new Error('Failed to create payroll snapshot.');

  for (const day of breakdown.days) {
    await client.query(
      `
        INSERT INTO public.timesheet_payroll_snapshot_days (
          snapshot_id,
          day_of_week,
          entry_date,
          rounded_time_started,
          rounded_time_finished,
          elapsed_minutes,
          break_minutes,
          payable_minutes,
          basic_minutes,
          overtime_minutes,
          double_time_minutes,
          paid_leave_units,
          unpaid_leave_units,
          operator_travel_minutes,
          ipr_units,
          subsistence,
          treatment_reason
        )
        VALUES (
          $1, $2, $3, $4::time, $5::time, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17
        )
      `,
      [
        snapshotId,
        day.dayOfWeek,
        entryDateForDay(timesheet.week_ending, day.dayOfWeek),
        day.roundedTimeStarted,
        day.roundedTimeFinished,
        day.elapsedMinutes,
        day.breakMinutes,
        day.payableMinutes,
        day.basicMinutes,
        day.overtimeMinutes,
        day.doubleTimeMinutes,
        day.paidLeaveUnits,
        day.unpaidLeaveUnits,
        day.operatorTravelMinutes,
        day.iprUnits,
        day.subsistence,
        day.treatmentReason,
      ]
    );
  }

  return { snapshotId, revision, breakdown };
}

async function approveInTransaction(
  client: PayrollPgClient,
  input: ApproveTimesheetPayrollInput
): Promise<ApproveTimesheetPayrollResult> {
  const existing = await client.query<{
    id: string;
    timesheet_id: string;
    revision: number;
    source_evidence: { breakdown?: PayrollWeekBreakdown };
  }>(
    `
      SELECT id, timesheet_id, revision, source_evidence
      FROM public.timesheet_payroll_snapshots
      WHERE idempotency_key = $1
    `,
    [input.idempotencyKey]
  );
    if (existing.rows[0]) {
    const snapshot = existing.rows[0];
    if (snapshot.timesheet_id !== input.timesheetId) {
      throw new Error('Idempotency key already belongs to another timesheet.');
    }
    const statusResult = await client.query<{ status: string }>(
      `SELECT status FROM public.timesheets WHERE id = $1`,
      [input.timesheetId]
    );
    const resultStatus = statusResult.rows[0]?.status === 'processed' ? 'processed' : 'approved';
    return {
      timesheetId: input.timesheetId,
      status: resultStatus,
      legacy: false,
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      breakdown: snapshot.source_evidence.breakdown ?? null,
    };
  }

  const timesheetResult = await client.query<TimesheetPayrollLockRow>(
    `
      SELECT
        timesheet.id,
        timesheet.user_id,
        timesheet.week_ending::text,
        timesheet.status,
        profile.team_id,
        timesheet.current_payroll_snapshot_id,
        timesheet.updated_at::text
      FROM public.timesheets timesheet
      JOIN public.profiles profile ON profile.id = timesheet.user_id
      WHERE timesheet.id = $1
      FOR UPDATE OF timesheet
    `,
    [input.timesheetId]
  );
  const timesheet = timesheetResult.rows[0];
  if (!timesheet) throw new Error('Timesheet not found.');
  if (input.expectedStatus && timesheet.status !== input.expectedStatus) {
    throw new Error('Timesheet status changed before it could be marked Payroll Received.');
  }

  const payrollDecision = resolveTimesheetPayrollReceivedAction(timesheet.status);
  if (payrollDecision.type === 'already_done' || hasPayrollReceivedGate(timesheet.status)) {
    const resultStatus = timesheet.status === 'processed' ? 'processed' : 'approved';
    if (!timesheet.current_payroll_snapshot_id) {
      return {
        timesheetId: timesheet.id,
        status: resultStatus,
        legacy: true,
        snapshotId: null,
        revision: null,
        breakdown: null,
      };
    }

    const snapshotResult = await client.query<{ id: string; revision: number }>(
      `
        SELECT id, revision
        FROM public.timesheet_payroll_snapshots
        WHERE id = $1
          AND timesheet_id = $2
      `,
      [timesheet.current_payroll_snapshot_id, timesheet.id]
    );
    const snapshot = snapshotResult.rows[0];
    if (!snapshot) {
      throw new Error('Approved timesheet snapshot pointer is invalid.');
    }

    return {
      timesheetId: timesheet.id,
      status: resultStatus,
      legacy: false,
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      breakdown: null,
    };
  }
  if (payrollDecision.type === 'conflict') {
    throw new Error(payrollDecision.message);
  }
  const nextStatus = payrollDecision.nextStatus;

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
    await client.query(
      `
        UPDATE public.timesheets
        SET
          status = $3,
          payroll_received_at = COALESCE(payroll_received_at, NOW()),
          payroll_received_by = COALESCE(payroll_received_by, $2),
          reviewed_by = $2,
          reviewed_at = NOW(),
          processed_at = CASE WHEN $3 = 'processed' THEN COALESCE(processed_at, NOW()) ELSE processed_at END,
          updated_at = NOW()
        WHERE id = $1
      `,
      [timesheet.id, input.actorId, nextStatus]
    );
    return {
      timesheetId: timesheet.id,
      status: nextStatus === 'processed' ? 'processed' : 'approved',
      legacy: true,
      snapshotId: null,
      revision: null,
      breakdown: null,
    };
  }

  const { snapshotId, revision, breakdown } = await insertPayrollSnapshotForLockedTimesheet(client, {
    timesheet,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
  });


  await client.query(
    `
      UPDATE public.timesheets
        SET
          status = $4,
          payroll_received_at = COALESCE(payroll_received_at, NOW()),
          payroll_received_by = COALESCE(payroll_received_by, $2),
          reviewed_by = $2,
          reviewed_at = NOW(),
          processed_at = CASE WHEN $4 = 'processed' THEN COALESCE(processed_at, NOW()) ELSE processed_at END,
          current_payroll_snapshot_id = $3,
          updated_at = NOW()
        WHERE id = $1
    `,
    [timesheet.id, input.actorId, snapshotId, nextStatus]
  );

  return {
    timesheetId: timesheet.id,
    status: nextStatus === 'processed' ? 'processed' : 'approved',
    legacy: false,
    snapshotId,
    revision,
    breakdown,
  };
}

export async function approveTimesheetWithPayrollSnapshot(
  input: ApproveTimesheetPayrollInput,
  createClient: PayrollPgClientFactory = createPayrollPgClient
): Promise<ApproveTimesheetPayrollResult> {
  let attempt = 0;
  while (attempt < MAX_SERIALIZATION_RETRIES) {
    const client = createClient();
    await client.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      const result = await approveInTransaction(client, input);
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
  throw new Error('Payroll approval could not be completed.');
}

export async function previewTimesheetPayroll(
  input: PreviewTimesheetPayrollInput,
  createClient: PayrollPgClientFactory = createPayrollPgClient
): Promise<PreviewTimesheetPayrollResult> {
  const client = createClient();
  await client.connect();
  try {
    const profileResult = await client.query<{ team_id: string | null }>(
      `SELECT team_id FROM public.profiles WHERE id = $1`,
      [input.userId]
    );
    if (!profileResult.rows[0]) throw new Error('Employee profile not found.');
    const rollout = await client.query<{ applies: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1 FROM public.payroll_rollout_activations
          WHERE effective_week_ending <= $1
        ) AS applies
      `,
      [input.weekEnding]
    );
    if (!rollout.rows[0]?.applies) return { legacy: true, breakdown: null };
    const timesheet: TimesheetPayrollLockRow = {
      id: 'preview',
      user_id: input.userId,
      week_ending: input.weekEnding,
      status: 'draft',
      team_id: profileResult.rows[0].team_id,
      current_payroll_snapshot_id: null,
      updated_at: null,
    };
    const { rule } = await resolveRule(client, timesheet);
    const leaveByDay = await loadCanonicalLeaveByDay(client, input.userId, input.weekEnding);
    return {
      legacy: false,
      breakdown: calculatePayrollWeek({
        weekEnding: input.weekEnding,
        rule,
        days: input.days.map((day) => {
          const leave = leaveByDay.get(day.dayOfWeek);
          return {
            ...day,
            paidLeaveUnits: leave?.paidLeaveUnits || 0,
            unpaidLeaveUnits: leave?.unpaidLeaveUnits || 0,
          };
        }),
      }),
    };
  } finally {
    await client.end();
  }
}
