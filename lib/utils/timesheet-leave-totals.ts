import { formatHours } from '@/lib/utils/time-calculations';

export interface LeaveLabelLike {
  session: 'AM' | 'PM' | 'FULL';
  isPaid?: boolean;
}

export interface LeaveOffDayStateLike {
  day_of_week: number;
  isOnApprovedLeave: boolean;
  paidLeaveHours: number;
  leaveLabels: LeaveLabelLike[];
}

export interface LeaveEntryLike {
  day_of_week: number;
  daily_total: number | null;
}

export interface LeaveAwareRowTotal {
  dayOfWeek: number;
  totalHours: number;
  workedHours: number;
  leaveDays: number;
  hasLeave: boolean;
  leaveUnitLabel: string | null;
  display: string;
}

export interface LeaveAwareWeeklyTotal {
  workedHours: number;
  leaveDays: number;
  display: string;
}

export interface LeaveAwareTotalsResult {
  rows: LeaveAwareRowTotal[];
  rowByDay: Map<number, LeaveAwareRowTotal>;
  weekly: LeaveAwareWeeklyTotal;
}

export interface LeaveDaysBreakdown {
  leaveDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatCompactNumber(value: number): string {
  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function resolveLeaveDays(offDayState: LeaveOffDayStateLike | undefined): number {
  if (!offDayState?.isOnApprovedLeave) return 0;

  const resolved = offDayState.leaveLabels.reduce((sum, label) => {
    if (label.session === 'FULL') return sum + 1;
    return sum + 0.5;
  }, 0);

  if (resolved <= 0) return 1;
  return Math.min(1, roundToTwo(resolved));
}

function resolveWorkedHours(entry: LeaveEntryLike, offDayState: LeaveOffDayStateLike | undefined): number {
  const totalHours = Math.max(0, entry.daily_total || 0);
  if (!offDayState?.isOnApprovedLeave) return roundToTwo(totalHours);

  const paidLeaveHours = Math.max(0, offDayState.paidLeaveHours || 0);
  return roundToTwo(Math.max(0, totalHours - paidLeaveHours));
}

export function formatLeaveDaysLabel(leaveDays: number): string {
  if (leaveDays <= 0) return '0 days';
  if (leaveDays === 0.5) return 'Half day';
  if (leaveDays === 1) return '1 day';
  const value = formatCompactNumber(leaveDays);
  return `${value} days`;
}

export function formatLeaveAwareWeeklyDisplay(workedHours: number, leaveDays: number): string {
  if (leaveDays <= 0) return `${formatHours(roundToTwo(workedHours))}h`;
  return `${formatCompactNumber(roundToTwo(workedHours))} hours + ${formatLeaveDaysLabel(roundToTwo(leaveDays))}`;
}

export function formatLeaveAwareWeeklyDisplayMultiline(workedHours: number, leaveDays: number): string {
  const normalizedWorkedHours = roundToTwo(workedHours);
  const normalizedLeaveDays = roundToTwo(leaveDays);
  if (normalizedLeaveDays <= 0) return `${formatHours(normalizedWorkedHours)}h`;
  return `${formatCompactNumber(normalizedWorkedHours)} hours +\n${formatLeaveDaysLabel(normalizedLeaveDays)}`;
}

export function buildLeaveAwareTotals(
  entries: LeaveEntryLike[],
  offDayStates: LeaveOffDayStateLike[]
): LeaveAwareTotalsResult {
  const offDayByDay = new Map(offDayStates.map((state) => [state.day_of_week, state] as const));

  const rows = entries.map((entry) => {
    const offDayState = offDayByDay.get(entry.day_of_week);
    const totalHours = roundToTwo(Math.max(0, entry.daily_total || 0));
    const leaveDays = resolveLeaveDays(offDayState);
    const workedHours = resolveWorkedHours(entry, offDayState);
    const hasLeave = leaveDays > 0;
    const leaveUnitLabel = hasLeave ? formatLeaveDaysLabel(leaveDays) : null;
    const display =
      hasLeave && workedHours > 0
        ? `${formatHours(workedHours)}h + ${leaveUnitLabel}`
        : hasLeave
          ? (leaveUnitLabel as string)
          : `${formatHours(workedHours)}h`;

    return {
      dayOfWeek: entry.day_of_week,
      totalHours,
      workedHours,
      leaveDays,
      hasLeave,
      leaveUnitLabel,
      display,
    };
  });

  const weeklyWorkedHours = roundToTwo(rows.reduce((sum, row) => sum + row.workedHours, 0));
  const weeklyLeaveDays = roundToTwo(rows.reduce((sum, row) => sum + row.leaveDays, 0));

  return {
    rows,
    rowByDay: new Map(rows.map((row) => [row.dayOfWeek, row] as const)),
    weekly: {
      workedHours: weeklyWorkedHours,
      leaveDays: weeklyLeaveDays,
      display: formatLeaveAwareWeeklyDisplay(weeklyWorkedHours, weeklyLeaveDays),
    },
  };
}

export function buildLeaveDaysBreakdown(offDayStates: LeaveOffDayStateLike[]): LeaveDaysBreakdown {
  let leaveDays = 0;
  let paidLeaveDays = 0;
  let unpaidLeaveDays = 0;

  offDayStates.forEach((offDayState) => {
    if (!offDayState.isOnApprovedLeave) return;

    const sessionBuckets: { AM: 'paid' | 'unpaid' | null; PM: 'paid' | 'unpaid' | null } = {
      AM: null,
      PM: null,
    };

    offDayState.leaveLabels.forEach((label) => {
      const sessions = label.session === 'FULL' ? (['AM', 'PM'] as const) : ([label.session] as const);
      sessions.forEach((session) => {
        if (sessionBuckets[session] === 'paid') return;
        if (label.isPaid) {
          sessionBuckets[session] = 'paid';
          return;
        }
        if (!sessionBuckets[session]) {
          sessionBuckets[session] = 'unpaid';
        }
      });
    });

    const paidForDay = (sessionBuckets.AM === 'paid' ? 0.5 : 0) + (sessionBuckets.PM === 'paid' ? 0.5 : 0);
    const unpaidForDay = (sessionBuckets.AM === 'unpaid' ? 0.5 : 0) + (sessionBuckets.PM === 'unpaid' ? 0.5 : 0);
    const totalForDay = paidForDay + unpaidForDay;

    if (totalForDay === 0) {
      leaveDays = roundToTwo(leaveDays + 1);
      unpaidLeaveDays = roundToTwo(unpaidLeaveDays + 1);
      return;
    }

    leaveDays = roundToTwo(leaveDays + totalForDay);
    paidLeaveDays = roundToTwo(paidLeaveDays + paidForDay);
    unpaidLeaveDays = roundToTwo(unpaidLeaveDays + unpaidForDay);
  });

  return {
    leaveDays,
    paidLeaveDays,
    unpaidLeaveDays,
  };
}
