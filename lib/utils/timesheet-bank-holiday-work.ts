import {
  formatLocalIsoDate,
  getTimesheetEntryDateFromWeekEnding,
} from '@/lib/utils/timesheet-off-days';

export const BANK_HOLIDAY_CONFIRM_PHRASE = 'BANK HOLIDAY';
export const BANK_HOLIDAY_WORK_CREATED_VIA = 'timesheet_bank_holiday_work';

export type BankHolidayAuthoritativeReadState = 'idle' | 'loading' | 'ready' | 'failed';
export type BankHolidayReadFailureSource = 'trial' | 'leave' | 'confirmation';

export type BankHolidayActionReadiness =
  | { status: 'loading'; failureSource: null }
  | { status: 'failed'; failureSource: BankHolidayReadFailureSource }
  | { status: 'ready'; failureSource: null };

export interface BankHolidayWorkHoursInput {
  day_of_week: number;
  time_started?: string | null;
  time_finished?: string | null;
  operator_travel_hours?: number | null;
  operator_yard_hours?: number | null;
  operator_working_hours?: number | null;
  machine_travel_hours?: number | null;
  machine_working_hours?: number | null;
  machine_standing_hours?: number | null;
  machine_operator_hours?: number | null;
  maintenance_breakdown_hours?: number | null;
  machine_start_time?: string | null;
  machine_finish_time?: string | null;
}

export function isBankHolidayConfirmPhrase(value: string): boolean {
  return value.trim().toLowerCase() === BANK_HOLIDAY_CONFIRM_PHRASE.toLowerCase();
}

export function isMissingTimesheetModuleSettingsError(error: {
  code?: string | null;
  message?: string | null;
} | null | undefined): boolean {
  if (!error) return false;
  const code = error.code || '';
  const message = (error.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (message.includes('timesheet_module_settings') &&
      (message.includes('does not exist') || message.includes('schema cache')))
  );
}

export function resolveBankHolidayConfirmGate(input: {
  trialReady: boolean;
  trialEnabled: boolean;
  offDaysReady: boolean;
  confirmationReady?: boolean;
}): 'not-ready' | 'disabled' | 'required' {
  if (
    !input.trialReady ||
    !input.offDaysReady ||
    (input.trialEnabled && input.confirmationReady === false)
  ) {
    return 'not-ready';
  }
  return input.trialEnabled ? 'required' : 'disabled';
}

export function resolveBankHolidayActionReadiness(input: {
  trialState: BankHolidayAuthoritativeReadState;
  trialEnabled: boolean;
  leaveState: BankHolidayAuthoritativeReadState;
  confirmationState: BankHolidayAuthoritativeReadState;
}): BankHolidayActionReadiness {
  if (input.trialState === 'failed') {
    return { status: 'failed', failureSource: 'trial' };
  }
  if (input.leaveState === 'failed') {
    return { status: 'failed', failureSource: 'leave' };
  }
  if (input.trialState !== 'ready' || input.leaveState !== 'ready') {
    return { status: 'loading', failureSource: null };
  }
  if (!input.trialEnabled) {
    return { status: 'ready', failureSource: null };
  }
  if (input.confirmationState === 'failed') {
    return { status: 'failed', failureSource: 'confirmation' };
  }
  if (input.confirmationState !== 'ready') {
    return { status: 'loading', failureSource: null };
  }
  return { status: 'ready', failureSource: null };
}

export function shouldReplaceTimesheetDraftEntries(input: {
  status: 'draft' | 'submitted';
  resolvedTimesheetId: string;
}): boolean {
  return input.status === 'draft' && input.resolvedTimesheetId.length > 0;
}

export function timesheetEntryHasWorkingHours(entry: BankHolidayWorkHoursInput): boolean {
  const hasStartOrFinish = Boolean(entry.time_started?.trim() || entry.time_finished?.trim());
  const hasPlantHours = [
    entry.operator_travel_hours,
    entry.operator_yard_hours,
    entry.operator_working_hours,
    entry.machine_travel_hours,
    entry.machine_working_hours,
    entry.machine_standing_hours,
    entry.machine_operator_hours,
    entry.maintenance_breakdown_hours,
  ].some((hours) => typeof hours === 'number' && hours > 0);
  const hasMachineTime = Boolean(
    entry.machine_start_time?.trim() || entry.machine_finish_time?.trim()
  );
  return hasStartOrFinish || hasPlantHours || hasMachineTime;
}

export function getTimesheetIsoDateForDay(weekEnding: string, dayOfWeek: number): string {
  return formatLocalIsoDate(getTimesheetEntryDateFromWeekEnding(weekEnding, dayOfWeek));
}

export function collectWorkingDatesFromEntries(
  weekEnding: string,
  entries: BankHolidayWorkHoursInput[]
): string[] {
  const dates = entries
    .filter((entry) => timesheetEntryHasWorkingHours(entry))
    .map((entry) => getTimesheetIsoDateForDay(weekEnding, entry.day_of_week));
  return Array.from(new Set(dates)).sort();
}

export function getUnconfirmedBankHolidayDates(input: {
  bankHolidayDates: string[];
  workingDates: string[];
  confirmedDates: string[];
}): string[] {
  const confirmed = new Set(input.confirmedDates);
  return input.workingDates
    .filter((date) => input.bankHolidayDates.includes(date) && !confirmed.has(date))
    .sort();
}
