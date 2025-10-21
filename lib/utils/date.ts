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
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'dd/MM/yyyy');
}

/**
 * Format date for ISO string (database storage)
 */
export function formatDateISO(date: Date | string): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'yyyy-MM-dd');
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

