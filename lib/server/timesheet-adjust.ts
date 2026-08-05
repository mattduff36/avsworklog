import pg from 'pg';
import { getNormalizedJobNumbers } from '@/lib/utils/timesheet-job-codes';
import {
  hasWorkedTimesForSubsistence,
  syncSubsistenceRemark,
} from '@/lib/utils/timesheet-subsistence';

const { Client } = pg;

export interface AdjustableTimesheetEntryInput {
  day_of_week: number;
  time_started?: string | null;
  time_finished?: string | null;
  operator_travel_hours?: number | null;
  operator_yard_hours?: number | null;
  operator_working_hours?: number | null;
  machine_travel_hours?: number | null;
  machine_start_time?: string | null;
  machine_finish_time?: string | null;
  machine_working_hours?: number | null;
  machine_standing_hours?: number | null;
  machine_operator_hours?: number | null;
  maintenance_breakdown_hours?: number | null;
  job_number?: string | null;
  job_numbers?: string[] | null;
  did_not_work?: boolean | null;
  working_in_yard?: boolean | null;
  subsistence_payment_required?: boolean | null;
  daily_total?: number | null;
  night_shift?: boolean | null;
  bank_holiday?: boolean | null;
  remarks?: string | null;
}

export interface AdjustPgClient {
  connect(): Promise<void>;
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[] }>;
  end(): Promise<void>;
}

export type AdjustPgClientFactory = () => AdjustPgClient;

interface PersistableEntry {
  day_of_week: number;
  time_started: string | null;
  time_finished: string | null;
  operator_travel_hours: number | null;
  operator_yard_hours: number | null;
  operator_working_hours: number | null;
  machine_travel_hours: number | null;
  machine_start_time: string | null;
  machine_finish_time: string | null;
  machine_working_hours: number | null;
  machine_standing_hours: number | null;
  machine_operator_hours: number | null;
  maintenance_breakdown_hours: number | null;
  job_number: string | null;
  job_numbers: string[];
  did_not_work: boolean;
  working_in_yard: boolean;
  subsistence_payment_required: boolean;
  daily_total: number | null;
  night_shift: boolean;
  bank_holiday: boolean;
  remarks: string | null;
}

function createAdjustPgClient(): AdjustPgClient {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('Missing database connection string for timesheet adjustment');
  }
  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  }) as AdjustPgClient;
}

function shouldPersistEntry(entry: AdjustableTimesheetEntryInput): boolean {
  return Boolean(
    entry.time_started ||
      entry.time_finished ||
      entry.remarks ||
      entry.did_not_work ||
      entry.working_in_yard ||
      entry.subsistence_payment_required ||
      entry.job_number ||
      (entry.job_numbers && entry.job_numbers.length > 0) ||
      entry.operator_travel_hours ||
      entry.operator_yard_hours ||
      entry.machine_travel_hours ||
      entry.machine_start_time ||
      entry.machine_finish_time ||
      entry.machine_standing_hours ||
      entry.machine_operator_hours ||
      entry.maintenance_breakdown_hours ||
      ((entry.daily_total || 0) > 0)
  );
}

function toPersistableEntries(entries: AdjustableTimesheetEntryInput[]): PersistableEntry[] {
  return entries.filter(shouldPersistEntry).map((entry) => {
    const jobNumbers = getNormalizedJobNumbers(
      entry.job_numbers ?? (entry.job_number ? [entry.job_number] : [])
    );
    const normalizedRemarks =
      entry.remarks?.trim() ||
      (entry.did_not_work ? 'Did Not Work' : '');
    const requiresSubsistence =
      Boolean(entry.subsistence_payment_required) &&
      hasWorkedTimesForSubsistence({
        time_started: entry.time_started || null,
        time_finished: entry.time_finished || null,
      });
    const persistedRemarks = syncSubsistenceRemark(normalizedRemarks, requiresSubsistence);

    return {
      day_of_week: entry.day_of_week,
      time_started: entry.time_started || null,
      time_finished: entry.time_finished || null,
      operator_travel_hours: entry.operator_travel_hours ?? null,
      operator_yard_hours: entry.operator_yard_hours ?? null,
      operator_working_hours: entry.operator_working_hours ?? null,
      machine_travel_hours: entry.machine_travel_hours ?? null,
      machine_start_time: entry.machine_start_time || null,
      machine_finish_time: entry.machine_finish_time || null,
      machine_working_hours: entry.machine_working_hours ?? null,
      machine_standing_hours: entry.machine_standing_hours ?? null,
      machine_operator_hours: entry.machine_operator_hours ?? null,
      maintenance_breakdown_hours: entry.maintenance_breakdown_hours ?? null,
      job_number: jobNumbers[0] || null,
      job_numbers: jobNumbers,
      did_not_work: Boolean(entry.did_not_work),
      working_in_yard: Boolean(entry.working_in_yard),
      subsistence_payment_required: requiresSubsistence,
      daily_total: entry.daily_total ?? null,
      night_shift: entry.night_shift ?? false,
      bank_holiday: entry.bank_holiday ?? false,
      remarks: persistedRemarks || null,
    };
  });
}

export async function applyTimesheetAdjustmentMutation(options: {
  timesheetId: string;
  actorId: string;
  comments: string;
  notifyManagerIds: string[];
  entries: AdjustableTimesheetEntryInput[] | null;
  createClient?: AdjustPgClientFactory;
}): Promise<void> {
  const createClient = options.createClient || createAdjustPgClient;
  const client = createClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    // Re-check status under the transaction so a concurrent processed/reapproval
    // transition cannot be overwritten by a stale adjust request.
    const locked = await client.query<{ id: string; status: string }>(
      `
        SELECT id::text, status
        FROM public.timesheets
        WHERE id = $1
        FOR UPDATE
      `,
      [options.timesheetId]
    );
    const current = locked.rows[0];
    if (!current) {
      throw new Error('Timesheet not found');
    }
    if (current.status !== 'approved' && current.status !== 'adjusted') {
      throw new Error('Only approved or already-adjusted timesheets can be marked as adjusted');
    }

    const updated = await client.query<{ id: string }>(
      `
        UPDATE public.timesheets
        SET
          status = 'adjusted',
          adjusted_by = $2,
          adjusted_at = NOW(),
          adjustment_recipients = $3::uuid[],
          manager_comments = $4,
          updated_at = NOW()
        WHERE id = $1
          AND status IN ('approved', 'adjusted')
        RETURNING id::text
      `,
      [
        options.timesheetId,
        options.actorId,
        options.notifyManagerIds,
        options.comments.trim(),
      ]
    );
    if (!updated.rows[0]?.id) {
      throw new Error('Only approved or already-adjusted timesheets can be marked as adjusted');
    }

    if (options.entries) {
      await client.query(
        `DELETE FROM public.timesheet_entries WHERE timesheet_id = $1`,
        [options.timesheetId]
      );

      const persistable = toPersistableEntries(options.entries);
      for (const entry of persistable) {
        const inserted = await client.query<{ id: string }>(
          `
            INSERT INTO public.timesheet_entries (
              timesheet_id, day_of_week, time_started, time_finished,
              operator_travel_hours, operator_yard_hours, operator_working_hours,
              machine_travel_hours, machine_start_time, machine_finish_time,
              machine_working_hours, machine_standing_hours, machine_operator_hours,
              maintenance_breakdown_hours, job_number, did_not_work, working_in_yard,
              subsistence_payment_required, daily_total, night_shift, bank_holiday, remarks
            )
            VALUES (
              $1, $2, $3, $4,
              $5, $6, $7,
              $8, $9, $10,
              $11, $12, $13,
              $14, $15, $16, $17,
              $18, $19, $20, $21, $22
            )
            RETURNING id::text
          `,
          [
            options.timesheetId,
            entry.day_of_week,
            entry.time_started,
            entry.time_finished,
            entry.operator_travel_hours,
            entry.operator_yard_hours,
            entry.operator_working_hours,
            entry.machine_travel_hours,
            entry.machine_start_time,
            entry.machine_finish_time,
            entry.machine_working_hours,
            entry.machine_standing_hours,
            entry.machine_operator_hours,
            entry.maintenance_breakdown_hours,
            entry.job_number,
            entry.did_not_work,
            entry.working_in_yard,
            entry.subsistence_payment_required,
            entry.daily_total,
            entry.night_shift,
            entry.bank_holiday,
            entry.remarks,
          ]
        );
        const entryId = inserted.rows[0]?.id;
        if (!entryId) {
          throw new Error('Failed to insert adjusted timesheet entry');
        }
        for (const [displayOrder, jobNumber] of entry.job_numbers.entries()) {
          await client.query(
            `
              INSERT INTO public.timesheet_entry_job_codes (
                timesheet_entry_id, job_number, display_order
              )
              VALUES ($1, $2, $3)
            `,
            [entryId, jobNumber, displayOrder]
          );
        }
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors once the original failure is known
    }
    throw error;
  } finally {
    await client.end();
  }
}
