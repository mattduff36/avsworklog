export interface CanonicalTimesheetPayDay {
  dayOfWeek: number;
  timeStarted: string | null;
  timeFinished: string | null;
  workedMinutesOverride: number;
  nightShift: boolean;
  bankHoliday: boolean;
  didNotWork: boolean;
  operatorTravelHours: number;
  subsistence: boolean;
}

export interface ProposedTimesheetPayEntry {
  day_of_week: number;
  time_started?: string | null;
  time_finished?: string | null;
  daily_total?: number | null;
  operator_travel_hours?: number | null;
  did_not_work?: boolean | null;
  night_shift?: boolean | null;
  subsistence_payment_required?: boolean | null;
  job_number?: string | null;
  job_numbers?: string[] | null;
  remarks?: string | null;
  working_in_yard?: boolean | null;
  operator_yard_hours?: number | null;
  operator_working_hours?: number | null;
  machine_travel_hours?: number | null;
  machine_start_time?: string | null;
  machine_finish_time?: string | null;
  machine_working_hours?: number | null;
  machine_standing_hours?: number | null;
  machine_operator_hours?: number | null;
  maintenance_breakdown_hours?: number | null;
  bank_holiday?: boolean | null;
}

const PAY_FIELDS = [
  'time_started',
  'time_finished',
  'daily_total',
  'operator_travel_hours',
  'did_not_work',
  'night_shift',
  'bank_holiday',
  'subsistence_payment_required',
] as const;

const COSTING_FIELDS = [
  'job_number',
  'job_numbers',
  'remarks',
  'working_in_yard',
  'operator_yard_hours',
  'operator_working_hours',
  'machine_travel_hours',
  'machine_start_time',
  'machine_finish_time',
  'machine_working_hours',
  'machine_standing_hours',
  'machine_operator_hours',
  'maintenance_breakdown_hours',
] as const;

const IGNORED_ENTRY_FIELDS = [
  'id',
  'timesheet_id',
  'created_at',
  'updated_at',
  'timesheet_entry_job_codes',
] as const;

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTime(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return trimmed;
  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] || '00'}`;
}

export function canonicalPayDayFromEntry(entry: {
  day_of_week: number;
  time_started?: string | null;
  time_finished?: string | null;
  daily_total?: string | number | null;
  operator_travel_hours?: string | number | null;
  did_not_work?: boolean | null;
  night_shift?: boolean | null;
  bank_holiday?: boolean | null;
  subsistence_payment_required?: boolean | null;
}): CanonicalTimesheetPayDay {
  return {
    dayOfWeek: entry.day_of_week,
    timeStarted: normalizeTime(entry.time_started),
    timeFinished: normalizeTime(entry.time_finished),
    workedMinutesOverride: Math.round(toNumber(entry.daily_total) * 60),
    nightShift: entry.night_shift === true,
    bankHoliday: entry.bank_holiday === true,
    didNotWork: entry.did_not_work === true,
    operatorTravelHours: toNumber(entry.operator_travel_hours),
    subsistence: entry.subsistence_payment_required === true,
  };
}

export function emptyCanonicalPayDay(dayOfWeek: number): CanonicalTimesheetPayDay {
  return {
    dayOfWeek,
    timeStarted: null,
    timeFinished: null,
    workedMinutesOverride: 0,
    nightShift: false,
    bankHoliday: false,
    didNotWork: false,
    operatorTravelHours: 0,
    subsistence: false,
  };
}

export function isPersistableTimesheetPayEntry(entry: ProposedTimesheetPayEntry): boolean {
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

export function padCanonicalPayWeek(days: CanonicalTimesheetPayDay[]): CanonicalTimesheetPayDay[] {
  const byDay = new Map(days.map((day) => [day.dayOfWeek, day]));
  return [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => byDay.get(dayOfWeek) ?? emptyCanonicalPayDay(dayOfWeek));
}

export function canonicalPayWeekFromEntries(
  entries: ProposedTimesheetPayEntry[]
): CanonicalTimesheetPayDay[] {
  return padCanonicalPayWeek(
    entries.filter(isPersistableTimesheetPayEntry).map(canonicalPayDayFromEntry)
  );
}

export function serializeCanonicalPayDays(days: CanonicalTimesheetPayDay[]): string {
  const normalized = [...days].sort((left, right) => left.dayOfWeek - right.dayOfWeek);
  return JSON.stringify(normalized);
}

function unknownFieldNames(entry: ProposedTimesheetPayEntry): string[] {
  const known = new Set<string>([
    'day_of_week',
    ...PAY_FIELDS,
    ...COSTING_FIELDS,
    ...IGNORED_ENTRY_FIELDS,
  ]);
  return Object.keys(entry).filter((key) => !known.has(key));
}

export function classifyTimesheetPayImpact(input: {
  currentDays: CanonicalTimesheetPayDay[];
  proposedDays: CanonicalTimesheetPayDay[];
  proposedEntries?: ProposedTimesheetPayEntry[] | null;
}): { payImpact: boolean; beforeCanonical: string; afterCanonical: string } {
  const beforeCanonical = serializeCanonicalPayDays(input.currentDays);
  const afterCanonical = serializeCanonicalPayDays(input.proposedDays);
  if (input.proposedEntries) {
    const unknown = input.proposedEntries.flatMap(unknownFieldNames);
    if (unknown.length > 0) {
      return { payImpact: true, beforeCanonical, afterCanonical };
    }
  }
  return {
    payImpact: beforeCanonical !== afterCanonical,
    beforeCanonical,
    afterCanonical,
  };
}
