import { format, startOfWeek, endOfWeek, addDays, parseISO, isValid } from 'date-fns';

/**
 * Get the Sunday (week ending) date for a given date
 */
export function getWeekEnding(date: Date = new Date()): Date {
  return endOfWeek(date, { weekStartsOn: 1 }); // Week starts on Monday
}

/**
 * Get the Monday (week starting) date for a given date
 */
export function getWeekStarting(date: Date = new Date()): Date {
  return startOfWeek(date, { weekStartsOn: 1 }); // Week starts on Monday
}

/**
 * Get all dates in a week (Monday to Sunday) given a week ending date
 */
export function getWeekDates(weekEnding: Date): Date[] {
  const monday = getWeekStarting(weekEnding);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * Format date for display
 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  
  try {
    const d = typeof date === 'string' ? parseISO(date) : date;
    if (!isValid(d)) return '';
    return format(d, 'dd/MM/yyyy');
  } catch {
    return '';
  }
}

/**
 * Format date for ISO string (database storage)
 */
export function formatDateISO(date: Date | string | null | undefined): string {
  if (!date) return '';
  
  try {
    const d = typeof date === 'string' ? parseISO(date) : date;
    if (!isValid(d)) return '';
    return format(d, 'yyyy-MM-dd');
  } catch {
    return '';
  }
}

/**
 * Parse date from string safely
 */
export function parseDate(dateString: string): Date | null {
  try {
    const date = parseISO(dateString);
    return isValid(date) ? date : null;
  } catch {
    return null;
  }
}

/**
 * Get day of week number (1-7) from date
 */
export function getDayOfWeek(date: Date): number {
  const day = date.getDay();
  // Convert Sunday (0) to 7, and Monday (1) stays 1
  return day === 0 ? 7 : day;
}

/**
 * Format time for display (HH:mm)
 */
export function formatTime(time: string | null): string {
  if (!time) return '';
  // Time is stored as HH:mm:ss, display as HH:mm
  return time.substring(0, 5);
}

/**
 * Get the UK financial year for a given date
 * UK financial year runs from 6 April to 5 April the following year
 * @param date The date to get the financial year for
 * @returns Object with start, end dates and label (e.g., "2024/25")
 */
export function getFinancialYear(date: Date = new Date()): {
  start: Date;
  end: Date;
  label: string;
} {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-11
  const day = date.getDate();
  
  // If before April 6th, financial year started last year
  // If on or after April 6th, financial year started this year
  let startYear: number;
  
  if (month < 3 || (month === 3 && day < 6)) {
    // Jan-Mar or 1-5 April: FY started last year
    startYear = year - 1;
  } else {
    // 6 April onwards: FY started this year
    startYear = year;
  }
  
  const start = new Date(startYear, 3, 6); // April 6th
  const end = new Date(startYear + 1, 3, 5); // April 5th next year
  const label = `${startYear}/${(startYear + 1).toString().slice(-2)}`;
  
  return { start, end, label };
}

/**
 * Get the current UK financial year
 */
export function getCurrentFinancialYear(): {
  start: Date;
  end: Date;
  label: string;
} {
  return getFinancialYear(new Date());
}

/**
 * Calculate duration in days between two dates (inclusive)
 * This is a base function; weekend/bank holiday exclusions can be added later
 * @param startDate The start date
 * @param endDate The end date (if null, assumes single day)
 * @param isHalfDay Whether this is a half-day absence
 * @returns Duration in days (e.g., 1.0, 0.5, 2.5)
 */
export function calculateDurationDays(
  startDate: Date,
  endDate: Date | null,
  isHalfDay: boolean = false
): number {
  // Single day
  if (!endDate || startDate.getTime() === endDate.getTime()) {
    return isHalfDay ? 0.5 : 1.0;
  }
  
  // Multi-day: count all days inclusive
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Reset time to avoid timezone issues
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  
  const diffTime = end.getTime() - start.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 for inclusive
  
  return diffDays;
}

/**
 * Check if a date falls within the current financial year
 */
export function isInCurrentFinancialYear(date: Date): boolean {
  const { start, end } = getCurrentFinancialYear();
  return date >= start && date <= end;
}

/**
 * Get all months in the financial year
 * Returns array of Date objects representing the first day of each month
 */
export function getFinancialYearMonths(financialYear?: {
  start: Date;
  end: Date;
  label: string;
}): Date[] {
  const fy = financialYear || getCurrentFinancialYear();
  const months: Date[] = [];
  
  const current = new Date(fy.start);
  current.setDate(1); // First day of the month
  
  while (current <= fy.end) {
    months.push(new Date(current));
    current.setMonth(current.getMonth() + 1);
  }
  
  return months;
}

