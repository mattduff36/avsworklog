import pg from 'pg';
import {
  collectWorkingDatesFromEntries,
  getTimesheetIsoDateForDay,
  getUnconfirmedBankHolidayDates,
  isBankHolidayConfirmPhrase,
  isMissingTimesheetModuleSettingsError,
  timesheetEntryHasWorkingHours,
  type BankHolidayWorkHoursInput,
} from '@/lib/utils/timesheet-bank-holiday-work';
import { fetchUKBankHolidaysStrict } from '@/lib/utils/bank-holidays';
import {
  formatLocalIsoDate,
  getTimesheetWeekIsoBounds,
} from '@/lib/utils/timesheet-off-days';

const { Client } = pg;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export class TimesheetBankHolidayWorkError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'TimesheetBankHolidayWorkError';
    this.code = code;
    this.status = status;
  }
}

export type BankHolidayWorkPgClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[] }>;
};

export type BankHolidayWorkPgClientFactory = () => BankHolidayWorkPgClient;

interface LockedTimesheet {
  id: string;
  user_id: string;
  week_ending: string;
  status: string;
}

interface EligibleAbsenceRow {
  id: string;
  date: string;
  end_date: string | null;
  is_half_day: boolean | null;
  is_bank_holiday: boolean | null;
  status: string;
  reason_name: string;
}

interface BankHolidayConfirmationEvidence {
  work_date: string;
  absence_id: string;
}

export interface ConfirmBankHolidayWorkInput {
  actorId: string;
  targetUserId: string;
  weekEnding: string;
  timesheetId?: string | null;
  timesheetType?: 'civils' | 'plant';
  templateVersion?: 1 | 2;
  dates: string[];
  phrase: string;
}

export interface ConfirmBankHolidayWorkResult {
  timesheetId: string;
  confirmedDates: string[];
}

function createPgClient(): BankHolidayWorkPgClient {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new TimesheetBankHolidayWorkError('SAVE_FAILED', 'Bank holiday confirm is unavailable', 500);
  }
  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  }) as BankHolidayWorkPgClient;
}

function invalidInput(message: string): TimesheetBankHolidayWorkError {
  return new TimesheetBankHolidayWorkError('INVALID_INPUT', message, 400);
}

function conflict(message: string): TimesheetBankHolidayWorkError {
  return new TimesheetBankHolidayWorkError('CONFLICT', message, 409);
}

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

function normalizeReason(value: string): string {
  return value.trim().toLowerCase();
}

function enumerateAbsenceDates(row: EligibleAbsenceRow): string[] {
  const start = new Date(`${normalizeDate(row.date)}T00:00:00`);
  const end = new Date(`${normalizeDate(row.end_date || row.date)}T00:00:00`);
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86400000)) {
    dates.push(formatLocalIsoDate(cursor));
  }
  return dates;
}

async function isTrialEnabled(client: BankHolidayWorkPgClient): Promise<boolean> {
  try {
    const result = await client.query<{ bank_holiday_self_override_enabled: boolean }>(
      `
      SELECT bank_holiday_self_override_enabled
      FROM public.timesheet_module_settings
      WHERE id = TRUE
      LIMIT 1
    `
    );
    return result.rows[0]?.bank_holiday_self_override_enabled !== false;
  } catch (error) {
    if (
      isMissingTimesheetModuleSettingsError(
        error && typeof error === 'object'
          ? {
              code: 'code' in error ? String(error.code) : undefined,
              message: error instanceof Error ? error.message : undefined,
            }
          : undefined
      )
    ) {
      return false;
    }
    throw error;
  }
}

async function lockTimesheetById(
  client: BankHolidayWorkPgClient,
  timesheetId: string
): Promise<LockedTimesheet | null> {
  const locked = await client.query<LockedTimesheet>(
    `
      SELECT id::text, user_id::text, week_ending::text, status
      FROM public.timesheets
      WHERE id = $1
      FOR UPDATE
    `,
    [timesheetId]
  );
  return locked.rows[0] ?? null;
}

async function lockTimesheetByWeek(
  client: BankHolidayWorkPgClient,
  userId: string,
  weekEnding: string
): Promise<LockedTimesheet | null> {
  const locked = await client.query<LockedTimesheet>(
    `
      SELECT id::text, user_id::text, week_ending::text, status
      FROM public.timesheets
      WHERE user_id = $1
        AND week_ending = $2::date
      FOR UPDATE
    `,
    [userId, weekEnding]
  );
  return locked.rows[0] ?? null;
}

async function insertDraftHeader(
  client: BankHolidayWorkPgClient,
  input: ConfirmBankHolidayWorkInput
): Promise<void> {
  await client.query(
    `
      INSERT INTO public.timesheets (
        user_id,
        week_ending,
        status,
        timesheet_type,
        template_version
      )
      VALUES ($1, $2::date, 'draft', $3, $4)
      ON CONFLICT ON CONSTRAINT timesheets_user_id_week_ending_key DO NOTHING
    `,
    [
      input.targetUserId,
      input.weekEnding,
      input.timesheetType ?? 'civils',
      input.templateVersion ?? (input.timesheetType === 'plant' ? 2 : 1),
    ]
  );
}

async function loadWeekAbsences(
  client: BankHolidayWorkPgClient,
  profileId: string,
  weekEnding: string,
  lockMode: 'none' | 'share' | 'update' = 'none'
): Promise<EligibleAbsenceRow[]> {
  const bounds = getTimesheetWeekIsoBounds(weekEnding);
  const lockClause =
    lockMode === 'update'
      ? 'FOR UPDATE OF a'
      : lockMode === 'share'
        ? 'FOR SHARE OF a'
        : '';
  const result = await client.query<EligibleAbsenceRow>(
    `
      SELECT
        a.id::text,
        a.date::text,
        a.end_date::text,
        a.is_half_day,
        a.is_bank_holiday,
        a.status,
        ar.name AS reason_name
      FROM public.absences a
      JOIN public.absence_reasons ar ON ar.id = a.reason_id
      WHERE a.profile_id = $1
        AND a.status IN ('approved', 'processed')
        AND a.date <= $3::date
        AND COALESCE(a.end_date, a.date) >= $2::date
      ${lockClause}
    `,
    [profileId, bounds.startIso, bounds.endIso]
  );
  return result.rows;
}

function coveringAbsences(absences: EligibleAbsenceRow[], workDate: string): EligibleAbsenceRow[] {
  return absences.filter((row) => enumerateAbsenceDates(row).includes(workDate));
}

function isSingleDayAbsence(row: EligibleAbsenceRow): boolean {
  return normalizeDate(row.date) === normalizeDate(row.end_date || row.date);
}

function findFlaggedBankHolidayAbsence(
  absences: EligibleAbsenceRow[],
  workDate: string
): EligibleAbsenceRow | undefined {
  return coveringAbsences(absences, workDate).find(
    (row) =>
      row.is_bank_holiday === true &&
      row.is_half_day !== true &&
      isSingleDayAbsence(row) &&
      normalizeReason(row.reason_name) === 'annual leave'
  );
}

function findCoveringAnnualLeaveAbsence(
  absences: EligibleAbsenceRow[],
  workDate: string
): EligibleAbsenceRow | undefined {
  return coveringAbsences(absences, workDate).find(
    (row) =>
      normalizeReason(row.reason_name) === 'annual leave' &&
      row.is_half_day !== true
  );
}

function dateNeedsUkBankHolidayCalendar(
  absences: EligibleAbsenceRow[],
  workDate: string
): boolean {
  return !findFlaggedBankHolidayAbsence(absences, workDate) &&
    Boolean(findCoveringAnnualLeaveAbsence(absences, workDate));
}

function resolveEligibleBankHolidayAbsence(
  absences: EligibleAbsenceRow[],
  workDate: string,
  ukBankHolidayDates: ReadonlySet<string> | null
): EligibleAbsenceRow {
  const flagged = findFlaggedBankHolidayAbsence(absences, workDate);
  if (flagged) return flagged;

  const coveringLeave = findCoveringAnnualLeaveAbsence(absences, workDate);
  if (coveringLeave) {
    if (!ukBankHolidayDates) {
      throw new TimesheetBankHolidayWorkError(
        'CALENDAR_UNAVAILABLE',
        'Unable to verify UK bank holidays',
        409
      );
    }
    if (ukBankHolidayDates.has(workDate)) {
      return coveringLeave;
    }
    throw invalidInput('Standard annual leave cannot be confirmed as bank-holiday work');
  }

  throw invalidInput('Each date must be a booked full-day bank holiday');
}

async function loadUkBankHolidayDatesIfNeeded(
  absences: EligibleAbsenceRow[],
  dates: string[],
  loadUkBankHolidayDates: () => Promise<Set<string>>
): Promise<Set<string> | null> {
  if (!dates.some((date) => dateNeedsUkBankHolidayCalendar(absences, date))) {
    return null;
  }

  try {
    const loaded = await loadUkBankHolidayDates();
    if (loaded.size === 0) {
      throw new Error('UK bank holiday calendar was empty');
    }
    return loaded;
  } catch (error) {
    if (error instanceof TimesheetBankHolidayWorkError) throw error;
    throw new TimesheetBankHolidayWorkError(
      'CALENDAR_UNAVAILABLE',
      'Unable to verify UK bank holidays',
      409
    );
  }
}

async function loadConfirmationEvidence(
  client: BankHolidayWorkPgClient,
  timesheetId: string
): Promise<BankHolidayConfirmationEvidence[]> {
  const result = await client.query<BankHolidayConfirmationEvidence>(
    `
      SELECT work_date::text, absence_id::text
      FROM public.timesheet_bank_holiday_work_confirmations
      WHERE timesheet_id = $1
      ORDER BY work_date
    `,
    [timesheetId]
  );
  return result.rows.map((row) => ({
    work_date: normalizeDate(row.work_date),
    absence_id: row.absence_id,
  }));
}

export async function assertSubmittedBankHolidayHoursConfirmed(
  client: BankHolidayWorkPgClient,
  input: {
    timesheetId: string;
    userId: string;
    weekEnding: string;
    entries: BankHolidayWorkHoursInput[];
  },
  options?: {
    loadUkBankHolidayDates?: () => Promise<Set<string>>;
  }
): Promise<void> {
  const enabled = await isTrialEnabled(client);
  if (!enabled) return;

  const workingDates = collectWorkingDatesFromEntries(input.weekEnding, input.entries);
  if (workingDates.length === 0) return;

  const absences = await loadWeekAbsences(client, input.userId, input.weekEnding, 'share');
  const ukBankHolidayDates = await loadUkBankHolidayDatesIfNeeded(
    absences,
    workingDates,
    options?.loadUkBankHolidayDates || fetchUKBankHolidaysStrict
  );
  const requiredEvidence = workingDates.flatMap((date) => {
    try {
      const absence = resolveEligibleBankHolidayAbsence(absences, date, ukBankHolidayDates);
      return [{ workDate: date, absenceId: absence.id }];
    } catch (error) {
      if (error instanceof TimesheetBankHolidayWorkError && error.code === 'CALENDAR_UNAVAILABLE') {
        throw error;
      }
      return [];
    }
  });
  if (requiredEvidence.length === 0) return;

  const confirmationEvidence = await loadConfirmationEvidence(client, input.timesheetId);
  const unconfirmed = requiredEvidence
    .filter(
      (required) =>
        !confirmationEvidence.some(
          (confirmed) =>
            confirmed.work_date === required.workDate &&
            confirmed.absence_id === required.absenceId
        )
    )
    .map((required) => required.workDate);
  if (unconfirmed.length > 0) {
    throw new TimesheetBankHolidayWorkError(
      'BANK_HOLIDAY_CONFIRM_REQUIRED',
      'Bank holiday hours must be confirmed before submit',
      400
    );
  }
}

export async function confirmBankHolidayWork(options: {
  input: ConfirmBankHolidayWorkInput;
  createClient?: BankHolidayWorkPgClientFactory;
  loadUkBankHolidayDates?: () => Promise<Set<string>>;
}): Promise<ConfirmBankHolidayWorkResult> {
  const { input } = options;
  if (!UUID_PATTERN.test(input.actorId) || !UUID_PATTERN.test(input.targetUserId)) {
    throw invalidInput('Invalid timesheet identity');
  }
  if (!ISO_DATE_PATTERN.test(input.weekEnding)) {
    throw invalidInput('Invalid week ending');
  }
  if (!isBankHolidayConfirmPhrase(input.phrase)) {
    throw invalidInput('Type BANK HOLIDAY to confirm');
  }

  const uniqueDates = Array.from(
    new Set(input.dates.map((date) => normalizeDate(date)).filter((date) => ISO_DATE_PATTERN.test(date)))
  ).sort();
  if (uniqueDates.length === 0 || uniqueDates.length > 7 || uniqueDates.length !== input.dates.length) {
    throw invalidInput('Confirm between one and seven unique bank-holiday dates in the timesheet week');
  }

  const bounds = getTimesheetWeekIsoBounds(input.weekEnding);
  if (uniqueDates.some((date) => date < bounds.startIso || date > bounds.endIso)) {
    throw invalidInput('Confirmed dates must belong to the selected timesheet week');
  }

  const createClient = options.createClient || createPgClient;
  const client = createClient();
  await client.connect();
  try {
    await client.query('BEGIN');

    const enabled = await isTrialEnabled(client);
    if (!enabled) {
      throw new TimesheetBankHolidayWorkError(
        'TRIAL_DISABLED',
        'Bank holiday self-override is disabled',
        409
      );
    }

    let locked = input.timesheetId ? await lockTimesheetById(client, input.timesheetId) : null;
    if (locked) {
      if (
        locked.user_id !== input.targetUserId ||
        normalizeDate(locked.week_ending) !== input.weekEnding
      ) {
        throw conflict('Timesheet identity does not match the selected week');
      }
    } else {
      locked = await lockTimesheetByWeek(client, input.targetUserId, input.weekEnding);
      if (!locked) {
        await insertDraftHeader(client, input);
        locked = await lockTimesheetByWeek(client, input.targetUserId, input.weekEnding);
      }
    }

    if (!locked) {
      throw new TimesheetBankHolidayWorkError('SAVE_FAILED', 'Failed to create timesheet', 500);
    }
    if (locked.status !== 'draft' && locked.status !== 'rejected') {
      throw conflict('Only draft or rejected timesheets can confirm bank-holiday hours');
    }

    const absences = await loadWeekAbsences(
      client,
      input.targetUserId,
      input.weekEnding,
      'update'
    );
    const ukBankHolidayDates = await loadUkBankHolidayDatesIfNeeded(
      absences,
      uniqueDates,
      options.loadUkBankHolidayDates || fetchUKBankHolidaysStrict
    );
    const eligible = uniqueDates.map((date) => ({
      date,
      absence: resolveEligibleBankHolidayAbsence(absences, date, ukBankHolidayDates),
    }));

    const flaggedAbsenceIds = Array.from(
      new Set(
        eligible
          .filter((row) => row.absence.is_bank_holiday === true && isSingleDayAbsence(row.absence))
          .map((row) => row.absence.id)
      )
    );
    if (flaggedAbsenceIds.length > 0) {
      const updatedAbsences = await client.query<{ id: string }>(
        `
          UPDATE public.absences
          SET allow_timesheet_work_on_leave = TRUE,
              updated_at = NOW()
          WHERE id = ANY($1::uuid[])
            AND is_bank_holiday IS TRUE
            AND COALESCE(is_half_day, false) = false
            AND status IN ('approved', 'processed')
          RETURNING id::text
        `,
        [flaggedAbsenceIds]
      );
      if (updatedAbsences.rows.length !== flaggedAbsenceIds.length) {
        throw conflict('Bank holiday absence changed before confirmation completed');
      }
    }

    for (const row of eligible) {
      await client.query(
        `
          INSERT INTO public.timesheet_bank_holiday_work_confirmations (
            timesheet_id,
            work_date,
            absence_id,
            confirmed_by
          )
          VALUES ($1, $2::date, $3, $4)
          ON CONFLICT (timesheet_id, work_date) DO UPDATE
          SET absence_id = EXCLUDED.absence_id,
              confirmed_by = EXCLUDED.confirmed_by,
              confirmed_at = NOW()
        `,
        [locked.id, row.date, row.absence.id, input.actorId]
      );
    }

    const evidence = await loadConfirmationEvidence(client, locked.id);
    const confirmedDates = evidence
      .filter((confirmed) => {
        try {
          return (
            resolveEligibleBankHolidayAbsence(
              absences,
              confirmed.work_date,
              ukBankHolidayDates
            ).id === confirmed.absence_id
          );
        } catch {
          return false;
        }
      })
      .map((confirmed) => confirmed.work_date);
    await client.query('COMMIT');
    return { timesheetId: locked.id, confirmedDates };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export function getWorkingBankHolidayDatesForEntries(
  weekEnding: string,
  entries: BankHolidayWorkHoursInput[],
  bankHolidayDates: string[]
): string[] {
  return getUnconfirmedBankHolidayDates({
    bankHolidayDates,
    workingDates: collectWorkingDatesFromEntries(weekEnding, entries),
    confirmedDates: [],
  });
}

export function entryDateHasWorkingHours(
  weekEnding: string,
  entries: BankHolidayWorkHoursInput[],
  date: string
): boolean {
  return entries.some(
    (entry) =>
      timesheetEntryHasWorkingHours(entry) &&
      getTimesheetIsoDateForDay(weekEnding, entry.day_of_week) === date
  );
}
