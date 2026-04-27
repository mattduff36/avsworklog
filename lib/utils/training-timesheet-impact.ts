import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { Timesheet } from '@/types/timesheet';

type DbClient = SupabaseClient<Database>;
type TimesheetStatus = Timesheet['status'];

interface TimesheetEntryImpactRow {
  timesheet_id: string;
  day_of_week: number;
  time_started: string | null;
  time_finished: string | null;
  job_number: string | null;
  working_in_yard: boolean | null;
  did_not_work: boolean | null;
  daily_total: number | null;
  remarks: string | null;
  timesheet_entry_job_codes?: Array<{ job_number: string | null }> | null;
}

interface TimesheetImpactRow {
  id: string;
  week_ending: string;
  status: TimesheetStatus;
  manager_comments: string | null;
}

export interface TrainingTimesheetImpactDate {
  date: string;
  dayOfWeek: number;
  hasEntry: boolean;
  hasWorkingHours: boolean;
  hasJobCodes: boolean;
  hasAnyEnteredData: boolean;
}

export interface TrainingTimesheetImpact {
  timesheetId: string;
  weekEnding: string;
  status: TimesheetStatus;
  managerComments: string | null;
  affectedDates: TrainingTimesheetImpactDate[];
  hasExistingHours: boolean;
  hasExistingJobCodes: boolean;
  hasAnyEnteredData: boolean;
}

export interface ResolveTrainingTimesheetImpactsInput {
  profileId: string;
  startDate: string;
  endDate?: string | null;
  isHalfDay?: boolean | null;
}

export interface ReturnSubmittedTrainingTimesheetsInput {
  actorUserId: string;
  impacts: TrainingTimesheetImpact[];
  reason?: string;
}

function parseIsoDate(dateIso: string): Date {
  return new Date(`${dateIso}T00:00:00`);
}

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

export function getTrainingImpactWeekEnding(dateIso: string): string {
  const date = parseIsoDate(dateIso);
  const daysUntilSunday = (7 - date.getDay()) % 7;
  return formatLocalIsoDate(addDays(date, daysUntilSunday));
}

export function getTrainingImpactDayOfWeek(dateIso: string): number {
  const day = parseIsoDate(dateIso).getDay();
  return day === 0 ? 7 : day;
}

export function expandTrainingImpactDates(input: ResolveTrainingTimesheetImpactsInput): string[] {
  const start = parseIsoDate(input.startDate);
  const end = input.isHalfDay ? start : parseIsoDate(input.endDate || input.startDate);
  const dates: string[] = [];

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    dates.push(formatLocalIsoDate(cursor));
  }

  return dates;
}

function entryHasWorkingHours(entry: TimesheetEntryImpactRow | undefined): boolean {
  return Boolean(entry?.time_started || entry?.time_finished);
}

function entryHasJobCodes(entry: TimesheetEntryImpactRow | undefined): boolean {
  if (!entry) return false;
  const legacyJobNumber = entry.job_number?.trim();
  const childJobNumbers = entry.timesheet_entry_job_codes || [];
  return Boolean(legacyJobNumber) || childJobNumbers.some((jobCode) => Boolean(jobCode.job_number?.trim()));
}

function entryHasAnyEnteredData(entry: TimesheetEntryImpactRow | undefined): boolean {
  if (!entry) return false;
  return Boolean(
    entryHasWorkingHours(entry) ||
      entryHasJobCodes(entry) ||
      entry.working_in_yard ||
      entry.did_not_work ||
      (entry.daily_total !== null && entry.daily_total > 0) ||
      entry.remarks?.trim()
  );
}

function buildReturnComment(dates: string[], reason: string): string {
  const formattedDates = dates.join(', ');
  return `${reason} Training booking added for ${formattedDates}. Please amend and resubmit this timesheet.`;
}

export async function resolveTrainingTimesheetImpacts(
  supabase: DbClient,
  input: ResolveTrainingTimesheetImpactsInput
): Promise<TrainingTimesheetImpact[]> {
  const dates = expandTrainingImpactDates(input);
  const weekEndings = Array.from(new Set(dates.map(getTrainingImpactWeekEnding)));

  if (weekEndings.length === 0) return [];

  const { data: timesheets, error: timesheetError } = await supabase
    .from('timesheets')
    .select('id, week_ending, status, manager_comments')
    .eq('user_id', input.profileId)
    .in('week_ending', weekEndings);

  if (timesheetError) throw timesheetError;

  const timesheetRows = (timesheets || []) as TimesheetImpactRow[];
  if (timesheetRows.length === 0) return [];

  const timesheetIds = timesheetRows.map((timesheet) => timesheet.id);
  const { data: entries, error: entriesError } = await supabase
    .from('timesheet_entries')
    .select(`
      timesheet_id,
      day_of_week,
      time_started,
      time_finished,
      job_number,
      working_in_yard,
      did_not_work,
      daily_total,
      remarks,
      timesheet_entry_job_codes(job_number)
    `)
    .in('timesheet_id', timesheetIds);

  if (entriesError) throw entriesError;

  const entriesByTimesheetAndDay = new Map<string, TimesheetEntryImpactRow>();
  for (const entry of (entries || []) as unknown as TimesheetEntryImpactRow[]) {
    entriesByTimesheetAndDay.set(`${entry.timesheet_id}:${entry.day_of_week}`, entry);
  }

  return timesheetRows.map((timesheet) => {
    const affectedDates = dates
      .filter((date) => getTrainingImpactWeekEnding(date) === timesheet.week_ending)
      .map<TrainingTimesheetImpactDate>((date) => {
        const dayOfWeek = getTrainingImpactDayOfWeek(date);
        const entry = entriesByTimesheetAndDay.get(`${timesheet.id}:${dayOfWeek}`);
        return {
          date,
          dayOfWeek,
          hasEntry: Boolean(entry),
          hasWorkingHours: entryHasWorkingHours(entry),
          hasJobCodes: entryHasJobCodes(entry),
          hasAnyEnteredData: entryHasAnyEnteredData(entry),
        };
      });

    return {
      timesheetId: timesheet.id,
      weekEnding: timesheet.week_ending,
      status: timesheet.status,
      managerComments: timesheet.manager_comments,
      affectedDates,
      hasExistingHours: affectedDates.some((date) => date.hasWorkingHours),
      hasExistingJobCodes: affectedDates.some((date) => date.hasJobCodes),
      hasAnyEnteredData: affectedDates.some((date) => date.hasAnyEnteredData),
    };
  });
}

export function buildTrainingTimesheetImpactMessage(impacts: TrainingTimesheetImpact[]): string | null {
  if (impacts.length === 0) return null;

  const lines = impacts.map((impact) => {
    const entered = impact.hasAnyEnteredData
      ? impact.hasExistingHours
        ? 'existing hours'
        : 'existing entries'
      : 'no entered hours';
    return `Week ending ${impact.weekEnding}: ${impact.status} timesheet with ${entered}`;
  });

  return [
    'This Training booking affects an existing timesheet:',
    ...lines,
    'Draft/rejected timesheets will keep existing entries and show a review warning. Submitted timesheets will be returned to the employee if this booking is approved. Approved timesheets require manager review; processed timesheets remain locked.',
  ].join('\n');
}

export async function returnSubmittedTrainingTimesheetsForAmendment(
  supabase: DbClient,
  input: ReturnSubmittedTrainingTimesheetsInput
): Promise<string[]> {
  const returnedTimesheetIds: string[] = [];

  for (const impact of input.impacts) {
    if (impact.status !== 'submitted') continue;

    const newComment = buildReturnComment(
      impact.affectedDates.map((date) => date.date),
      input.reason || 'Approved'
    );
    const managerComments = impact.managerComments
      ? `${impact.managerComments}\n\n${newComment}`
      : newComment;

    const { error } = await supabase
      .from('timesheets')
      .update({
        status: 'rejected',
        reviewed_by: input.actorUserId,
        reviewed_at: new Date().toISOString(),
        manager_comments: managerComments,
      })
      .eq('id', impact.timesheetId)
      .eq('status', 'submitted');

    if (error) throw error;
    returnedTimesheetIds.push(impact.timesheetId);
  }

  return returnedTimesheetIds;
}
