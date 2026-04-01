import { DAY_NAMES } from '@/types/timesheet';
import { calculateHours } from '@/lib/utils/time-calculations';
import type { TimesheetDidNotWorkReason, TimesheetOffDayState } from '@/lib/utils/timesheet-off-days';

export interface PlantEntryDraft {
  day_of_week: number;
  did_not_work: boolean;
  didNotWorkReason: TimesheetDidNotWorkReason | null;
  job_number: string;
  working_in_yard: boolean;
  time_started: string;
  time_finished: string;
  operator_travel_hours: string;
  operator_yard_hours: string;
  operator_working_hours: number | null;
  daily_total: number | null;
  machine_travel_hours: string;
  machine_start_time: string;
  machine_finish_time: string;
  machine_working_hours: number | null;
  machine_standing_hours: string;
  machine_operator_hours: string;
  maintenance_breakdown_hours: string;
  remarks: string;
}

export interface RecalculateEntryOptions {
  paidLeaveHours?: number;
  isLeaveLocked?: boolean;
  preserveDailyTotal?: boolean;
}

export const EMPTY_ENTRY: Omit<PlantEntryDraft, 'day_of_week'> = {
  did_not_work: false,
  didNotWorkReason: null,
  job_number: '',
  working_in_yard: false,
  time_started: '',
  time_finished: '',
  operator_travel_hours: '',
  operator_yard_hours: '',
  operator_working_hours: null,
  daily_total: null,
  machine_travel_hours: '',
  machine_start_time: '',
  machine_finish_time: '',
  machine_working_hours: null,
  machine_standing_hours: '',
  machine_operator_hours: '',
  maintenance_breakdown_hours: '',
  remarks: '',
};

export function createBlankEntry(dayOfWeek: number): PlantEntryDraft {
  return {
    day_of_week: dayOfWeek,
    ...EMPTY_ENTRY,
  };
}

export function parseHoursInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function toHoursInput(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

export function hasPlantData(entry: PlantEntryDraft): boolean {
  return [
    entry.time_started,
    entry.time_finished,
    entry.job_number,
    entry.operator_travel_hours,
    entry.operator_yard_hours,
    entry.machine_travel_hours,
    entry.machine_start_time,
    entry.machine_finish_time,
    entry.machine_standing_hours,
    entry.maintenance_breakdown_hours,
    entry.remarks,
  ].some((value) => value.trim().length > 0);
}

function hasManualAdditionalPlantData(entry: PlantEntryDraft): boolean {
  return [
    entry.machine_travel_hours,
    entry.machine_start_time,
    entry.machine_finish_time,
    entry.machine_standing_hours,
    entry.maintenance_breakdown_hours,
  ].some((value) => value.trim().length > 0);
}

export function recalculateEntry(entry: PlantEntryDraft, options: RecalculateEntryOptions = {}): PlantEntryDraft {
  const operatorWorking = entry.time_started && entry.time_finished
    ? calculateHours(entry.time_started, entry.time_finished)
    : null;

  const machineWorking = entry.machine_start_time && entry.machine_finish_time
    ? calculateHours(entry.machine_start_time, entry.machine_finish_time)
    : null;

  const operatorTravel = parseHoursInput(entry.operator_travel_hours) ?? 0;
  const operatorYard = parseHoursInput(entry.operator_yard_hours) ?? 0;
  const totalWorking = operatorWorking === null ? null : roundHours(operatorWorking + operatorTravel + operatorYard);
  const machineOperatorHours = operatorWorking === null ? '' : String(roundHours(operatorWorking));
  const paidLeaveHours = roundHours(Math.max(0, options.paidLeaveHours ?? 0));

  let dailyTotal = totalWorking;
  if (options.preserveDailyTotal) {
    dailyTotal = entry.daily_total;
  } else if (options.isLeaveLocked) {
    dailyTotal = paidLeaveHours;
  } else if (paidLeaveHours > 0) {
    dailyTotal = roundHours((totalWorking ?? 0) + paidLeaveHours);
  }

  return {
    ...entry,
    operator_working_hours: operatorWorking === null ? null : roundHours(operatorWorking),
    machine_working_hours: machineWorking === null ? null : roundHours(machineWorking),
    machine_operator_hours: machineOperatorHours,
    daily_total: dailyTotal,
  };
}

export function buildValidationErrors(entries: PlantEntryDraft[]): Record<number, string> {
  const next: Record<number, string> = {};
  entries.forEach((entry, index) => {
    if (!hasPlantData(entry) || entry.did_not_work) return;

    const missing: string[] = [];
    if (!entry.time_started) missing.push('Operator start time');
    if (!entry.time_finished) missing.push('Operator finish time');
    if (hasManualAdditionalPlantData(entry)) {
      if (!entry.machine_start_time) missing.push('Machine start time');
      if (!entry.machine_finish_time) missing.push('Machine finish time');
    }

    if (missing.length > 0) {
      next[index] = `${DAY_NAMES[index]}: ${missing.join(', ')} required when row has plant data.`;
    }
  });
  return next;
}

export function isPlantEntryComplete(entry: PlantEntryDraft, offDayState?: TimesheetOffDayState): boolean {
  if (offDayState?.isOnApprovedLeave) return true;
  const hasHours = Boolean(entry.time_started && entry.time_finished);
  return hasHours || entry.did_not_work;
}
