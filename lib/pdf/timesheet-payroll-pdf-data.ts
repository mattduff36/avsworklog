import { getSignedPayrollRule } from '@/lib/payroll/schema';
import type { PayrollDayInput, PayrollWeekBreakdown } from '@/lib/payroll/types';
import { normalizeTimesheetEntriesForDisplay } from '@/lib/utils/plant-timesheet-v2-normalization';
import type { TimesheetOffDayState } from '@/lib/utils/timesheet-off-days';
import type { Timesheet } from '@/types/timesheet';
import type { PayrollSnapshotPdfData, PayrollSnapshotPdfKind } from '@/lib/pdf/payroll-snapshot-summary';

export function buildTimesheetPayrollPreviewDays(
  timesheet: Pick<Timesheet, 'timesheet_type' | 'template_version' | 'entries'>,
  offDayStates: TimesheetOffDayState[] = []
): PayrollDayInput[] {
  const displayEntries = normalizeTimesheetEntriesForDisplay(
    timesheet,
    timesheet.entries || [],
    offDayStates
  );
  const byDay = new Map(displayEntries.map((entry) => [entry.day_of_week, entry]));
  const offDayByDay = new Map(offDayStates.map((state) => [state.day_of_week, state]));

  return [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => {
    const entry = byDay.get(dayOfWeek);
    const offDay = offDayByDay.get(dayOfWeek);
    return {
      dayOfWeek,
      timeStarted: entry?.time_started ?? null,
      timeFinished: entry?.time_finished ?? null,
      workedMinutesOverride: Math.round((entry?.daily_total || 0) * 60),
      nightShift: entry?.night_shift === true,
      bankHoliday: entry?.bank_holiday === true,
      didNotWork: entry?.did_not_work === true,
      paidLeaveUnits: offDay?.paidLeaveUnits || 0,
      unpaidLeaveUnits: offDay?.unpaidLeaveUnits || 0,
      operatorTravelHours: entry?.operator_travel_hours || 0,
      subsistence: entry?.subsistence_payment_required === true,
    };
  });
}

export function toPayrollSnapshotPdfData(
  breakdown: PayrollWeekBreakdown,
  kind: PayrollSnapshotPdfKind = 'snapshot',
  revision = 0
): PayrollSnapshotPdfData {
  return {
    kind,
    revision,
    basic_minutes: breakdown.basicMinutes,
    overtime_minutes: breakdown.overtimeMinutes,
    double_time_minutes: breakdown.doubleTimeMinutes,
    paid_leave_units: breakdown.paidLeaveUnits,
    unpaid_leave_units: breakdown.unpaidLeaveUnits,
    operator_travel_minutes: breakdown.operatorTravelMinutes,
    ipr_units: breakdown.iprUnits,
    subsistence_days: breakdown.subsistenceDays,
    subsistence_day_names: breakdown.subsistenceDayNames,
    rule_set: { name: getSignedPayrollRule(breakdown.ruleSetKey).name },
  };
}
