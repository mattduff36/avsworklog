import { calculateHours } from '@/lib/utils/time-calculations';
import { getWorkingSessionsForDate } from '@/lib/utils/work-shifts';
import type { WorkShiftPattern } from '@/types/work-shifts';

export type TimesheetDidNotWorkReason = 'Holiday' | 'Sickness' | 'Off Shift' | 'Other';
export type LeaveSession = 'AM' | 'PM';
export const PAID_LEAVE_DAILY_HOURS = 9;
const PAID_LEAVE_HALF_DAY_HOURS = PAID_LEAVE_DAILY_HOURS / 2;

export interface ApprovedAbsenceForTimesheet {
  date: string;
  end_date: string | null;
  is_half_day?: boolean | null;
  half_day_session?: LeaveSession | null;
  allow_timesheet_work_on_leave?: boolean | null;
  absence_reasons?: { name?: string | null; color?: string | null; is_paid?: boolean | null } | null;
}

export interface TimesheetLeaveLabel {
  reasonName: string;
  label: string;
  session: LeaveSession | 'FULL';
  color: string | null;
  isPaid: boolean;
  blocksWorkingEntry: boolean;
}

export interface TimesheetWorkWindow {
  start: string;
  end: string;
}

export interface TimesheetOffDayState {
  day_of_week: number;
  date: string;
  isExpectedShiftDay: boolean;
  isOnApprovedLeave: boolean;
  isLeaveLocked: boolean;
  isPartialLeave: boolean;
  hasAmLeave: boolean;
  hasPmLeave: boolean;
  workWindow: TimesheetWorkWindow | null;
  paidLeaveHours: number;
  leaveLabels: TimesheetLeaveLabel[];
  displayRemarks: string;
  leaveReasonName: string | null;
  leaveReasonColor: string | null;
  isAnnualLeave: boolean;
}

export interface TimesheetEntryLike {
  day_of_week: number;
  time_started: string;
  time_finished: string;
  job_number: string;
  working_in_yard: boolean;
  did_not_work: boolean;
  didNotWorkReason: TimesheetDidNotWorkReason | null;
  daily_total: number | null;
  remarks: string;
}

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeReasonName(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function parseDidNotWorkReason(value: string | null | undefined): TimesheetDidNotWorkReason {
  const normalized = normalizeReasonName(value);
  if (normalized.startsWith('annual leave') || normalized === 'holiday') return 'Holiday';
  if (normalized.startsWith('sickness') || normalized.startsWith('sick')) return 'Sickness';
  if (normalized === 'not on shift' || normalized === 'off shift' || normalized === 'off') return 'Off Shift';
  return 'Other';
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function hasWorkingData(entry: TimesheetEntryLike): boolean {
  return Boolean(
    (entry.time_started && entry.time_started.trim()) ||
      (entry.time_finished && entry.time_finished.trim()) ||
      (entry.job_number && entry.job_number.trim()) ||
      entry.working_in_yard ||
      ((entry.daily_total || 0) > 0)
  );
}

function toMinutes(time: string): number | null {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [hours, minutes] = time.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

export function isWorkWindowOvernight(window: TimesheetWorkWindow | null): boolean {
  if (!window) return false;
  const min = toMinutes(window.start);
  const max = toMinutes(window.end);
  if (min === null || max === null) return false;
  return max < min;
}

export function isTimeWithinWorkWindow(time: string, window: TimesheetWorkWindow | null): boolean {
  if (!window || !time) return true;
  const minutes = toMinutes(time);
  const min = toMinutes(window.start);
  const max = toMinutes(window.end);
  if (minutes === null || min === null || max === null) return false;
  if (max < min) {
    // Overnight window, e.g. 17:00 -> 05:00.
    return minutes >= min || minutes <= max;
  }
  return minutes >= min && minutes <= max;
}

export function getTimesheetEntryDateFromWeekEnding(weekEnding: string, dayOfWeek: number): Date {
  const safeDay = Math.min(7, Math.max(1, dayOfWeek));
  const weekEndingDate = new Date(`${weekEnding}T00:00:00`);
  const entryDate = new Date(weekEndingDate);

  // week_ending is Sunday and day_of_week is 1-7 (Monday-Sunday)
  entryDate.setDate(weekEndingDate.getDate() - (7 - safeDay));

  return entryDate;
}

export function getTimesheetWeekIsoBounds(weekEnding: string): { startIso: string; endIso: string } {
  const start = getTimesheetEntryDateFromWeekEnding(weekEnding, 1);
  const end = getTimesheetEntryDateFromWeekEnding(weekEnding, 7);
  return {
    startIso: formatLocalIsoDate(start),
    endIso: formatLocalIsoDate(end),
  };
}

function computeWorkedHours(entry: TimesheetEntryLike, offDay: TimesheetOffDayState): number {
  if (!entry.time_started || !entry.time_finished) return 0;
  if (!isTimeWithinWorkWindow(entry.time_started, offDay.workWindow)) return 0;
  if (!isTimeWithinWorkWindow(entry.time_finished, offDay.workWindow)) return 0;

  const startMinutes = toMinutes(entry.time_started);
  const finishMinutes = toMinutes(entry.time_finished);

  // Keep half-day leave windows as same-day ranges unless the window itself wraps overnight.
  if (
    offDay.workWindow &&
    !isWorkWindowOvernight(offDay.workWindow) &&
    startMinutes !== null &&
    finishMinutes !== null &&
    finishMinutes < startMinutes
  ) {
    return 0;
  }

  let workedHours = calculateHours(entry.time_started, entry.time_finished) || 0;
  if (workedHours > 6.5) {
    workedHours -= 0.5;
  }

  return roundHours(Math.max(0, workedHours));
}

function toLeaveLabel(row: ApprovedAbsenceForTimesheet): TimesheetLeaveLabel {
  const reasonName = row.absence_reasons?.name?.trim() || 'Approved Leave';
  const isHalf = Boolean(row.is_half_day);
  const session: LeaveSession | 'FULL' = isHalf && row.half_day_session ? row.half_day_session : 'FULL';
  const isAnnualLeave = normalizeReasonName(reasonName) === 'annual leave';
  const allowsTimesheetWork = isAnnualLeave && Boolean(row.allow_timesheet_work_on_leave);

  return {
    reasonName,
    label: session === 'FULL' ? reasonName : `${reasonName} (${session})`,
    session,
    color: row.absence_reasons?.color || null,
    isPaid: Boolean(row.absence_reasons?.is_paid),
    blocksWorkingEntry: !allowsTimesheetWork,
  };
}

export function resolveTimesheetOffDayStates(
  weekEnding: string,
  approvedAbsences: ApprovedAbsenceForTimesheet[],
  pattern?: WorkShiftPattern | null
): TimesheetOffDayState[] {
  return Array.from({ length: 7 }, (_, index) => {
    const dayOfWeek = index + 1;
    const entryDate = getTimesheetEntryDateFromWeekEnding(weekEnding, dayOfWeek);
    const entryDateIso = formatLocalIsoDate(entryDate);
    const sessions = getWorkingSessionsForDate(entryDate, pattern);
    const isExpectedShiftDay = sessions.am || sessions.pm;

    const dayRows = approvedAbsences.filter((row) => {
      const rowEnd = row.end_date || row.date;
      return row.date <= entryDateIso && rowEnd >= entryDateIso;
    });

    const leaveLabels = dayRows
      .map(toLeaveLabel)
      .sort((a, b) => {
        const weight = (session: LeaveSession | 'FULL') => {
          if (session === 'FULL') return 0;
          return session === 'AM' ? 1 : 2;
        };
        return weight(a.session) - weight(b.session);
      });

    const hasAmLeave = leaveLabels.some(
      (label) => label.blocksWorkingEntry && (label.session === 'FULL' || label.session === 'AM')
    );
    const hasPmLeave = leaveLabels.some(
      (label) => label.blocksWorkingEntry && (label.session === 'FULL' || label.session === 'PM')
    );
    const isOnApprovedLeave = leaveLabels.length > 0;
    const isLeaveLocked = hasAmLeave && hasPmLeave;
    const isPartialLeave = isOnApprovedLeave && !isLeaveLocked;

    const amPaid = leaveLabels.some(
      (label) => label.isPaid && (label.session === 'FULL' || label.session === 'AM')
    );
    const pmPaid = leaveLabels.some(
      (label) => label.isPaid && (label.session === 'FULL' || label.session === 'PM')
    );
    const paidLeaveHours = roundHours((amPaid ? PAID_LEAVE_HALF_DAY_HOURS : 0) + (pmPaid ? PAID_LEAVE_HALF_DAY_HOURS : 0));

    let workWindow: TimesheetWorkWindow | null = null;
    if (!isLeaveLocked) {
      if (hasAmLeave) {
        workWindow = { start: '12:00', end: '23:59' };
      } else if (hasPmLeave) {
        workWindow = { start: '00:00', end: '13:00' };
      }
    }

    const displayRemarks = leaveLabels.map((label) => label.label).join('\n');
    const firstLabel = leaveLabels[0];
    const isAnnualLeave = leaveLabels.some((label) => normalizeReasonName(label.reasonName) === 'annual leave');

    return {
      day_of_week: dayOfWeek,
      date: entryDateIso,
      isExpectedShiftDay,
      isOnApprovedLeave,
      isLeaveLocked,
      isPartialLeave,
      hasAmLeave,
      hasPmLeave,
      workWindow,
      paidLeaveHours,
      leaveLabels,
      displayRemarks,
      leaveReasonName: firstLabel?.reasonName || null,
      leaveReasonColor: firstLabel?.color || null,
      isAnnualLeave,
    };
  });
}

export function normalizeTimesheetEntriesForOffDays(
  entries: TimesheetEntryLike[],
  offDayStates: TimesheetOffDayState[],
  options?: {
    enforceLeaveOverwrite?: boolean;
    applyNonShiftDefaults?: boolean;
  }
): TimesheetEntryLike[] {
  const enforceLeaveOverwrite = options?.enforceLeaveOverwrite ?? true;
  const applyNonShiftDefaults = options?.applyNonShiftDefaults ?? true;
  const offDayByDay = new Map(offDayStates.map((state) => [state.day_of_week, state] as const));

  return entries.map((entry) => {
    const offDay = offDayByDay.get(entry.day_of_week);
    if (!offDay) return entry;

    if (enforceLeaveOverwrite && offDay.isLeaveLocked) {
      const primaryReason = offDay.leaveReasonName || 'Approved Leave';
      return {
        ...entry,
        time_started: '',
        time_finished: '',
        job_number: '',
        working_in_yard: false,
        did_not_work: true,
        didNotWorkReason: parseDidNotWorkReason(primaryReason),
        daily_total: offDay.paidLeaveHours,
        remarks: offDay.displayRemarks || primaryReason,
      };
    }

    if (offDay.isPartialLeave) {
      const workedHours = computeWorkedHours(entry, offDay);
      return {
        ...entry,
        did_not_work: false,
        didNotWorkReason: null,
        daily_total: roundHours(workedHours + offDay.paidLeaveHours),
        remarks: offDay.displayRemarks || entry.remarks,
      };
    }

    if (applyNonShiftDefaults && !offDay.isExpectedShiftDay && !hasWorkingData(entry)) {
      return {
        ...entry,
        did_not_work: true,
        didNotWorkReason: entry.didNotWorkReason || 'Off Shift',
        daily_total: entry.daily_total ?? 0,
        remarks: isBlank(entry.remarks) ? 'Not on Shift' : entry.remarks,
      };
    }

    return entry;
  });
}
