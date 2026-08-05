import type { LegacyPayrollBreakdown, LegacyPayrollDayInput } from './types';

/**
 * Frozen October 2025 payroll behaviour.
 *
 * This adapter intentionally preserves the pre-cutover export classification.
 * Do not update it when changing the signed payroll rules.
 */
export function calculateLegacyPayroll(days: LegacyPayrollDayInput[]): LegacyPayrollBreakdown {
  let basicHours = 0;
  let overtimeHours = 0;
  let doubleTimeHours = 0;

  for (const day of days) {
    const hours = Math.max(0, day.workedHours || 0);
    if (day.nightShift || day.bankHoliday) {
      doubleTimeHours += hours;
    } else if (day.dayOfWeek === 6 || day.dayOfWeek === 7) {
      overtimeHours += hours;
    } else {
      basicHours += hours;
    }
  }

  return {
    basicHours,
    overtimeHours,
    doubleTimeHours,
    totalHours: basicHours + overtimeHours + doubleTimeHours,
  };
}
