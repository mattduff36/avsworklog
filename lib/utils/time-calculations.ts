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
 * Calculate total hours from an array of daily totals
 */
export function calculateWeeklyTotal(dailyTotals: (number | null)[]): number {
  return dailyTotals.reduce((sum: number, hours) => {
    return sum + (hours || 0);
  }, 0);
}

