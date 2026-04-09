import type { Timesheet, TimesheetEntry } from '@/types/timesheet';
import type { TimesheetOffDayState } from '@/lib/utils/timesheet-off-days';
import { calculatePlantDailyTotal, calculateStandardTimesheetHours } from '@/lib/utils/time-calculations';

export function isPlantTimesheetV2(
  timesheet: Pick<Timesheet, 'timesheet_type' | 'template_version'> | null | undefined
): boolean {
  return Boolean(timesheet?.timesheet_type === 'plant' && timesheet?.template_version === 2);
}

export function normalizePlantTimesheetV2Entry(
  entry: TimesheetEntry,
  offDayState?: TimesheetOffDayState
): TimesheetEntry {
  const operatorWorkingHours = calculateStandardTimesheetHours(entry.time_started, entry.time_finished);

  return {
    ...entry,
    operator_working_hours: operatorWorkingHours,
    machine_operator_hours: operatorWorkingHours,
    daily_total: calculatePlantDailyTotal({
      timeStarted: entry.time_started,
      timeFinished: entry.time_finished,
      paidLeaveHours: offDayState?.paidLeaveHours,
      isLeaveLocked: Boolean(offDayState?.isLeaveLocked),
    }),
  };
}

export function normalizeTimesheetEntriesForDisplay(
  timesheet: Pick<Timesheet, 'timesheet_type' | 'template_version'> | null | undefined,
  entries: TimesheetEntry[],
  offDayStates: TimesheetOffDayState[] = []
): TimesheetEntry[] {
  if (!isPlantTimesheetV2(timesheet)) {
    return entries;
  }

  const offDayMap = new Map(offDayStates.map((state) => [state.day_of_week, state] as const));
  return entries.map((entry) => normalizePlantTimesheetV2Entry(entry, offDayMap.get(entry.day_of_week)));
}
