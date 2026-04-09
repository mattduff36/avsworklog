/**
 * Calculate hours between two time strings (HH:mm format)
 * Returns decimal hours (e.g., 8.5 for 8 hours 30 minutes)
 */
export function calculateHours(
  timeStarted: string | null,
  timeFinished: string | null
): number | null {
  if (!timeStarted || !timeFinished) return null;

  try {
    const [startHour, startMinute] = timeStarted.split(':').map(Number);
    const [endHour, endMinute] = timeFinished.split(':').map(Number);

    if (
      isNaN(startHour) || isNaN(startMinute) ||
      isNaN(endHour) || isNaN(endMinute)
    ) {
      return null;
    }

    // Convert times to minutes
    const startTotalMinutes = startHour * 60 + startMinute;
    let endTotalMinutes = endHour * 60 + endMinute;

    // Handle overnight shifts (end time before start time)
    if (endTotalMinutes < startTotalMinutes) {
      endTotalMinutes += 24 * 60; // Add 24 hours
    }

    // Calculate difference in minutes
    const diffMinutes = endTotalMinutes - startTotalMinutes;

    // Convert to decimal hours (rounded to 2 decimal places)
    return Math.round((diffMinutes / 60) * 100) / 100;
  } catch {
    return null;
  }
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

export const STANDARD_LUNCH_BREAK_THRESHOLD_HOURS = 6.5;
export const STANDARD_LUNCH_BREAK_DEDUCTION_HOURS = 0.5;

export function applyStandardLunchBreakDeduction(hours: number | null): number | null {
  if (hours === null) return null;
  if (hours > STANDARD_LUNCH_BREAK_THRESHOLD_HOURS) {
    return roundHours(hours - STANDARD_LUNCH_BREAK_DEDUCTION_HOURS);
  }
  return roundHours(hours);
}

export function calculateStandardTimesheetHours(
  timeStarted: string | null,
  timeFinished: string | null
): number | null {
  return applyStandardLunchBreakDeduction(calculateHours(timeStarted, timeFinished));
}

interface CalculatePlantDailyTotalOptions {
  timeStarted: string | null;
  timeFinished: string | null;
  paidLeaveHours?: number;
  isLeaveLocked?: boolean;
  preserveDailyTotal?: boolean;
  existingDailyTotal?: number | null;
}

export function calculatePlantDailyTotal({
  timeStarted,
  timeFinished,
  paidLeaveHours = 0,
  isLeaveLocked = false,
  preserveDailyTotal = false,
  existingDailyTotal = null,
}: CalculatePlantDailyTotalOptions): number | null {
  const workedHours = calculateStandardTimesheetHours(timeStarted, timeFinished);
  const normalizedPaidLeaveHours = roundHours(Math.max(0, paidLeaveHours));

  if (preserveDailyTotal) {
    return existingDailyTotal;
  }

  if (isLeaveLocked) {
    return normalizedPaidLeaveHours;
  }

  if (normalizedPaidLeaveHours > 0) {
    return roundHours((workedHours ?? 0) + normalizedPaidLeaveHours);
  }

  return workedHours;
}

/**
 * Format decimal hours to display format (e.g., 8.5 -> "8.50")
 */
export function formatHours(hours: number | null): string {
  if (hours === null || hours === undefined) return '0.00';
  return hours.toFixed(2);
}

/**
 * Validate time format (HH:mm)
 */
export function isValidTime(time: string): boolean {
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  return timeRegex.test(time);
}

/**
 * Normalize a time value to the nearest 15-minute increment.
 * If input is not a recognizable HH:mm value, returns it unchanged.
 */
export function roundTimeToNearestQuarterHour(time: string): string {
  if (!time) return time;

  const match = time.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) return time;

  const rawHours = Number(match[1]);
  const rawMinutes = Number(match[2]);
  if (Number.isNaN(rawHours) || Number.isNaN(rawMinutes)) return time;
  if (rawHours < 0 || rawHours > 23) return time;

  const totalMinutes = rawHours * 60 + rawMinutes;
  const roundedTotal = Math.round(totalMinutes / 15) * 15;
  const minutesInDay = 24 * 60;
  const normalizedTotal = ((roundedTotal % minutesInDay) + minutesInDay) % minutesInDay;

  const hours = Math.floor(normalizedTotal / 60);
  const minutes = normalizedTotal % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Calculate total hours from an array of daily totals
 */
export function calculateWeeklyTotal(dailyTotals: (number | null)[]): number {
  return dailyTotals.reduce((sum: number, hours) => {
    return sum + (hours || 0);
  }, 0);
}

