import { z } from 'zod';
import pg from 'pg';
import {
  persistTimesheetEntries,
  toPersistableEntries,
  type AdjustPgClient,
  type AdjustableTimesheetEntryInput,
} from '@/lib/server/timesheet-adjust';

const { Client } = pg;

export const TIMESHEET_SUBMIT_FORBIDDEN = 'Forbidden: cannot submit this timesheet';
export const TIMESHEET_SUBMIT_CONFLICT =
  'This timesheet can no longer be submitted. Open the existing sheet or contact payroll.';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u;
const SIGNATURE_PATTERN = /^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/i;
const MAX_SIGNATURE_CHARS = 512_000;
const MAX_TEXT = 500;

export class TimesheetSubmitError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'TimesheetSubmitError';
    this.code = code;
    this.status = status;
  }
}

const optionalText = z
  .string()
  .trim()
  .max(MAX_TEXT)
  .nullable()
  .optional()
  .transform((value) => value || null);

const TimesheetSubmitEntrySchema = z
  .object({
    day_of_week: z.number().int().min(1).max(7),
    time_started: z.string().regex(TIME_PATTERN).nullable().optional(),
    time_finished: z.string().regex(TIME_PATTERN).nullable().optional(),
    operator_travel_hours: z.number().min(0).max(24).nullable().optional(),
    operator_yard_hours: z.number().min(0).max(24).nullable().optional(),
    operator_working_hours: z.number().min(0).max(24).nullable().optional(),
    machine_travel_hours: z.number().min(0).max(24).nullable().optional(),
    machine_start_time: z.string().regex(TIME_PATTERN).nullable().optional(),
    machine_finish_time: z.string().regex(TIME_PATTERN).nullable().optional(),
    machine_working_hours: z.number().min(0).max(24).nullable().optional(),
    machine_standing_hours: z.number().min(0).max(24).nullable().optional(),
    machine_operator_hours: z.number().min(0).max(24).nullable().optional(),
    maintenance_breakdown_hours: z.number().min(0).max(24).nullable().optional(),
    job_number: z.string().trim().max(64).nullable().optional(),
    job_numbers: z.array(z.string().trim().min(1).max(64)).max(8).nullable().optional(),
    did_not_work: z.boolean().nullable().optional(),
    working_in_yard: z.boolean().nullable().optional(),
    subsistence_payment_required: z.boolean().nullable().optional(),
    daily_total: z.number().min(0).max(24).nullable().optional(),
    night_shift: z.boolean().nullable().optional(),
    bank_holiday: z.boolean().nullable().optional(),
    remarks: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const TimesheetSubmitBodySchema = z
  .object({
    timesheetId: z.string().uuid().nullable().optional(),
    userId: z.string().uuid(),
    weekEnding: z.string().regex(ISO_DATE_PATTERN),
    timesheetType: z.enum(['civils', 'plant']),
    templateVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    regNumber: optionalText,
    siteAddress: optionalText,
    hirerName: optionalText,
    isHiredPlant: z.boolean().nullable().optional(),
    hiredPlantIdSerial: optionalText,
    hiredPlantDescription: optionalText,
    hiredPlantHiringCompany: optionalText,
    signatureData: z
      .string()
      .min(32)
      .max(MAX_SIGNATURE_CHARS)
      .regex(SIGNATURE_PATTERN, 'Signature must be a PNG, JPEG, or WebP data URL'),
    entries: z.array(TimesheetSubmitEntrySchema).length(7),
  })
  .strict()
  .superRefine((body, ctx) => {
    const seen = new Set<number>();
    for (const entry of body.entries) {
      if (seen.has(entry.day_of_week)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries'],
          message: 'Each day of the week must appear once',
        });
        return;
      }
      seen.add(entry.day_of_week);
      const hasHours = Boolean(entry.time_started && entry.time_finished);
      if (!hasHours && !entry.did_not_work) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries'],
          message: 'Each day must have hours or be marked did not work',
        });
        return;
      }
    }
    for (let day = 1; day <= 7; day += 1) {
      if (!seen.has(day)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries'],
          message: 'Submit requires all seven days',
        });
        return;
      }
    }
  });

export type TimesheetSubmitBody = z.infer<typeof TimesheetSubmitBodySchema>;

export interface TimesheetSubmitResult {
  id: string;
  status: 'submitted';
}

export type TimesheetSubmitPgClient = AdjustPgClient;
export type TimesheetSubmitPgClientFactory = () => TimesheetSubmitPgClient;

interface LockedTimesheet {
  id: string;
  user_id: string;
  week_ending: string;
  status: string;
  payroll_received_at: string | null;
  manager_approved_at: string | null;
  current_payroll_snapshot_id: string | null;
}

function createSubmitPgClient(): TimesheetSubmitPgClient {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new TimesheetSubmitError('SAVE_FAILED', 'Timesheet submit is unavailable', 500);
  }
  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  }) as TimesheetSubmitPgClient;
}

export function authorizeTimesheetSubmit(input: {
  actorId: string;
  targetUserId: string;
  canAuthoriseTarget: boolean;
}): boolean {
  if (!UUID_PATTERN.test(input.actorId) || !UUID_PATTERN.test(input.targetUserId)) {
    return false;
  }
  if (input.actorId === input.targetUserId) {
    return true;
  }
  return input.canAuthoriseTarget;
}

function invalidInput(message: string): TimesheetSubmitError {
  return new TimesheetSubmitError('INVALID_INPUT', message, 400);
}

function conflict(message = TIMESHEET_SUBMIT_CONFLICT): TimesheetSubmitError {
  return new TimesheetSubmitError('CONFLICT', message, 409);
}

function asLocked(row: LockedTimesheet | undefined): LockedTimesheet | null {
  return row ?? null;
}

function normalizeWeekEnding(value: string): string {
  return value.slice(0, 10);
}

async function lockById(
  client: TimesheetSubmitPgClient,
  timesheetId: string
): Promise<LockedTimesheet | null> {
  const locked = await client.query<LockedTimesheet>(
    `
      SELECT
        id::text,
        user_id::text,
        week_ending::text,
        status,
        payroll_received_at::text,
        manager_approved_at::text,
        current_payroll_snapshot_id::text
      FROM public.timesheets
      WHERE id = $1
      FOR UPDATE
    `,
    [timesheetId]
  );
  return asLocked(locked.rows[0]);
}

async function lockByWeek(
  client: TimesheetSubmitPgClient,
  userId: string,
  weekEnding: string
): Promise<LockedTimesheet | null> {
  const locked = await client.query<LockedTimesheet>(
    `
      SELECT
        id::text,
        user_id::text,
        week_ending::text,
        status,
        payroll_received_at::text,
        manager_approved_at::text,
        current_payroll_snapshot_id::text
      FROM public.timesheets
      WHERE user_id = $1
        AND week_ending = $2::date
      FOR UPDATE
    `,
    [userId, weekEnding]
  );
  return asLocked(locked.rows[0]);
}

async function countEntries(client: TimesheetSubmitPgClient, timesheetId: string): Promise<number> {
  const counted = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM public.timesheet_entries WHERE timesheet_id = $1`,
    [timesheetId]
  );
  return counted.rows[0]?.count ?? 0;
}

function isIncompleteSubmitted(row: LockedTimesheet, entryCount: number): boolean {
  return (
    row.status === 'submitted' &&
    entryCount === 0 &&
    !row.payroll_received_at &&
    !row.manager_approved_at &&
    !row.current_payroll_snapshot_id
  );
}

function assertWritableStart(row: LockedTimesheet, entryCount: number): void {
  if (row.status === 'draft' || row.status === 'rejected') {
    return;
  }
  if (isIncompleteSubmitted(row, entryCount)) {
    return;
  }
  throw conflict();
}

async function insertDraftHeader(
  client: TimesheetSubmitPgClient,
  body: TimesheetSubmitBody
): Promise<void> {
  await client.query(
    `
      INSERT INTO public.timesheets (
        user_id,
        week_ending,
        status,
        timesheet_type,
        template_version,
        reg_number,
        site_address,
        hirer_name,
        is_hired_plant,
        hired_plant_id_serial,
        hired_plant_description,
        hired_plant_hiring_company
      )
      VALUES (
        $1, $2::date, 'draft', $3, $4,
        $5, $6, $7, $8, $9, $10, $11
      )
      ON CONFLICT ON CONSTRAINT timesheets_user_id_week_ending_key DO NOTHING
    `,
    [
      body.userId,
      body.weekEnding,
      body.timesheetType,
      body.templateVersion ?? (body.timesheetType === 'plant' ? 2 : 1),
      body.regNumber,
      body.siteAddress,
      body.hirerName,
      body.isHiredPlant ?? false,
      body.hiredPlantIdSerial,
      body.hiredPlantDescription,
      body.hiredPlantHiringCompany,
    ]
  );
}

async function applyHeaderDraftFields(
  client: TimesheetSubmitPgClient,
  timesheetId: string,
  body: TimesheetSubmitBody
): Promise<void> {
  const updated = await client.query<{ id: string }>(
    `
      UPDATE public.timesheets
      SET
        timesheet_type = $2,
        template_version = $3,
        reg_number = $4,
        site_address = $5,
        hirer_name = $6,
        is_hired_plant = $7,
        hired_plant_id_serial = $8,
        hired_plant_description = $9,
        hired_plant_hiring_company = $10,
        updated_at = NOW()
      WHERE id = $1
        AND status IN ('draft', 'rejected')
      RETURNING id::text
    `,
    [
      timesheetId,
      body.timesheetType,
      body.templateVersion ?? (body.timesheetType === 'plant' ? 2 : 1),
      body.regNumber,
      body.siteAddress,
      body.hirerName,
      body.isHiredPlant ?? false,
      body.hiredPlantIdSerial,
      body.hiredPlantDescription,
      body.hiredPlantHiringCompany,
    ]
  );
  if (!updated.rows[0]?.id) {
    throw conflict();
  }
}

async function demoteIncompleteSubmitted(
  client: TimesheetSubmitPgClient,
  timesheetId: string
): Promise<void> {
  const demoted = await client.query<{ id: string }>(
    `
      UPDATE public.timesheets
      SET
        status = 'draft',
        updated_at = NOW()
      WHERE id = $1
        AND status = 'submitted'
        AND payroll_received_at IS NULL
        AND manager_approved_at IS NULL
        AND current_payroll_snapshot_id IS NULL
      RETURNING id::text
    `,
    [timesheetId]
  );
  if (!demoted.rows[0]?.id) {
    throw conflict();
  }
}

async function markSubmitted(
  client: TimesheetSubmitPgClient,
  timesheetId: string,
  signatureData: string
): Promise<void> {
  const submitted = await client.query<{ id: string }>(
    `
      UPDATE public.timesheets
      SET
        status = 'submitted',
        signature_data = $2,
        submitted_at = NOW(),
        signed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
        AND status IN ('draft', 'rejected')
      RETURNING id::text
    `,
    [timesheetId, signatureData]
  );
  if (!submitted.rows[0]?.id) {
    throw conflict();
  }
}

export function toSubmitEntries(entries: TimesheetSubmitBody['entries']): AdjustableTimesheetEntryInput[] {
  return entries.map((entry) => ({
    day_of_week: entry.day_of_week,
    time_started: entry.time_started ?? null,
    time_finished: entry.time_finished ?? null,
    operator_travel_hours: entry.operator_travel_hours ?? null,
    operator_yard_hours: entry.operator_yard_hours ?? null,
    operator_working_hours: entry.operator_working_hours ?? null,
    machine_travel_hours: entry.machine_travel_hours ?? null,
    machine_start_time: entry.machine_start_time ?? null,
    machine_finish_time: entry.machine_finish_time ?? null,
    machine_working_hours: entry.machine_working_hours ?? null,
    machine_standing_hours: entry.machine_standing_hours ?? null,
    machine_operator_hours: entry.machine_operator_hours ?? null,
    maintenance_breakdown_hours: entry.maintenance_breakdown_hours ?? null,
    job_number: entry.job_number ?? null,
    job_numbers: entry.job_numbers ?? null,
    did_not_work: entry.did_not_work ?? false,
    working_in_yard: entry.working_in_yard ?? false,
    subsistence_payment_required: entry.subsistence_payment_required ?? false,
    daily_total: entry.daily_total ?? null,
    night_shift: entry.night_shift ?? false,
    bank_holiday: entry.bank_holiday ?? false,
    remarks: entry.remarks ?? null,
  }));
}

export async function applyTimesheetSubmit(options: {
  body: TimesheetSubmitBody;
  createClient?: TimesheetSubmitPgClientFactory;
}): Promise<TimesheetSubmitResult> {
  const persistable = toPersistableEntries(toSubmitEntries(options.body.entries));
  if (persistable.length !== 7) {
    throw invalidInput('Submit requires all seven days');
  }

  const createClient = options.createClient || createSubmitPgClient;
  const client = createClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    const hintId = options.body.timesheetId ?? null;
    let locked = hintId ? await lockById(client, hintId) : null;
    if (locked) {
      if (
        locked.user_id !== options.body.userId ||
        normalizeWeekEnding(locked.week_ending) !== options.body.weekEnding
      ) {
        throw conflict('Timesheet identity does not match the selected week');
      }
    } else {
      locked = await lockByWeek(client, options.body.userId, options.body.weekEnding);
      if (!locked) {
        await insertDraftHeader(client, options.body);
        locked = await lockByWeek(client, options.body.userId, options.body.weekEnding);
      }
    }

    if (!locked) {
      throw new TimesheetSubmitError('SAVE_FAILED', 'Failed to create timesheet', 500);
    }

    const entryCount = await countEntries(client, locked.id);
    assertWritableStart(locked, entryCount);
    if (isIncompleteSubmitted(locked, entryCount)) {
      await demoteIncompleteSubmitted(client, locked.id);
    }

    await applyHeaderDraftFields(client, locked.id, options.body);
    await persistTimesheetEntries(client, locked.id, toSubmitEntries(options.body.entries));
    const persistedCount = await countEntries(client, locked.id);
    if (persistedCount !== 7) {
      throw invalidInput('Submit requires all seven days');
    }
    await markSubmitted(client, locked.id, options.body.signatureData);
    await client.query('COMMIT');
    return { id: locked.id, status: 'submitted' };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
