import { getFinancialYear } from '@/lib/utils/date';

export function getResolvedAbsenceEndDate(date: string, endDate?: string | null): string {
  return endDate && endDate.trim().length > 0 ? endDate : date;
}

export function absenceSpansMultipleFinancialYears(date: string, endDate?: string | null): boolean {
  if (!date) {
    return false;
  }

  const resolvedEndDate = getResolvedAbsenceEndDate(date, endDate);
  const startFinancialYearStartYear = getFinancialYear(new Date(`${date}T00:00:00`)).start.getFullYear();
  const endFinancialYearStartYear = getFinancialYear(new Date(`${resolvedEndDate}T00:00:00`)).start.getFullYear();

  return startFinancialYearStartYear !== endFinancialYearStartYear;
}

export function getCrossFinancialYearAbsenceError(date: string, endDate?: string | null): string | null {
  if (!absenceSpansMultipleFinancialYears(date, endDate)) {
    return null;
  }

  return 'Absence bookings cannot span multiple financial years. Split the booking so each financial year has its own entry.';
}
