import { format, startOfWeek, endOfWeek, addDays, parseISO, isValid } from 'date-fns';
import { calculateDurationDaysForShiftPattern, STANDARD_WORK_SHIFT_PATTERN } from '@/lib/utils/work-shifts';
import type { WorkShiftPattern, WorkShiftSession } from '@/types/work-shifts';

/**
 * Get the Sunday (week ending) date for a given date
 */
export function getWeekEnding(date: Date = new Date()): Date {
  return endOfWeek(date, { weekStartsOn: 1 }); // Week starts on Monday
}

export interface WeekEndingSundayOption {
  isoDate: string;
  label: string;
}

/**
 * Build a constrained list of week-ending Sundays around the current week.
 * Defaults to: past 3 + current + future 2 Sundays.
 */
export function getWeekEndingSundayOptions(
  anchorDate: Date = new Date(),
  options: {
    pastCount?: number;
    futureCount?: number;
  } = {}
): WeekEndingSundayOption[] {
  const pastCount = options.pastCount ?? 3;
  const futureCount = options.futureCount ?? 2;
  const currentSunday = getWeekEnding(anchorDate);

  return Array.from({ length: pastCount + futureCount + 1 }, (_, index) => {
    const weekOffset = index - pastCount;
    const sundayDate = addDays(currentSunday, weekOffset * 7);
    const isoDate = formatDateISO(sundayDate);
    return {
      isoDate,
      label: `Sunday ${format(sundayDate, 'd MMM yyyy')}`,
    };
  });
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
 * Format date and time for display (dd/MM/yyyy HH:mm)
 */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '';
  
  try {
    const d = typeof date === 'string' ? parseISO(date) : date;
    if (!isValid(d)) return '';
    return format(d, 'dd/MM/yyyy HH:mm');
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
 * Get the financial year for a given date
 * Financial year runs from 1 April to 31 March the following year
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
  
  // If before April 1st, financial year started last year
  // If on or after April 1st, financial year started this year
  let startYear: number;
  
  if (month < 3 || (month === 3 && day < 1)) {
    // Jan-Mar: FY started last year
    startYear = year - 1;
  } else {
    // 1 April onwards: FY started this year
    startYear = year;
  }
  
  const start = new Date(startYear, 3, 1); // April 1st
  const end = new Date(startYear + 1, 2, 31); // March 31st next year
  const label = `${startYear}/${(startYear + 1).toString().slice(-2)}`;
  
  return { start, end, label };
}

/**
 * Get the current financial year
 */
export function getCurrentFinancialYear(): {
  start: Date;
  end: Date;
  label: string;
} {
  return getFinancialYear(new Date());
}

/**
 * Calculate duration in days between two dates (inclusive).
 * Defaults to the standard Monday-Friday working week unless a work-shift pattern is provided.
 */
export function calculateDurationDays(
  startDate: Date,
  endDate: Date | null,
  isHalfDay: boolean = false,
  options: {
    pattern?: WorkShiftPattern | null;
    halfDaySession?: WorkShiftSession | null;
  } = {}
): number {
  return calculateDurationDaysForShiftPattern(
    startDate,
    endDate,
    options.pattern || STANDARD_WORK_SHIFT_PATTERN,
    {
      isHalfDay,
      halfDaySession: options.halfDaySession,
    }
  );
}

export function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
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

/**
 * Legacy alias retained for compatibility.
 * Returns absolute date/time instead of relative text.
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
  return formatDateTime(date);
}
