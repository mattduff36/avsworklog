import { getFinancialYear } from '@/lib/utils/date';

export interface NewUserOnboardingCalculationInput {
  annualAllowanceDays: number;
  onboardingDate?: Date;
}

export interface NewUserOnboardingCalculationResult {
  financialYearStart: Date;
  financialYearEnd: Date;
  proratedAllowanceDays: number;
  defaultRemainingLeaveDays: number;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundToNearestHalfDay(value: number): number {
  return Math.round((value + Number.EPSILON) * 2) / 2;
}

function calculateInclusiveDayCount(start: Date, end: Date): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);
  const msInDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / msInDay) + 1);
}

export function calculateProratedAllowanceDays(
  annualAllowanceDays: number,
  financialYearStart: Date,
  financialYearEnd: Date,
  onboardingDate: Date
): number {
  const totalFinancialYearDays = calculateInclusiveDayCount(financialYearStart, financialYearEnd);
  if (totalFinancialYearDays <= 0) return 0;

  const boundedOnboardingDate = onboardingDate < financialYearStart ? financialYearStart : onboardingDate;
  const remainingDays = calculateInclusiveDayCount(boundedOnboardingDate, financialYearEnd);
  const prorated = annualAllowanceDays * (remainingDays / totalFinancialYearDays);

  return roundToTwoDecimals(prorated);
}

export function calculateNewUserRemainingLeaveDefault(
  input: NewUserOnboardingCalculationInput
): NewUserOnboardingCalculationResult {
  const onboardingDate = input.onboardingDate || new Date();
  const financialYear = getFinancialYear(onboardingDate);
  const proratedAllowanceDays = calculateProratedAllowanceDays(
    input.annualAllowanceDays,
    financialYear.start,
    financialYear.end,
    onboardingDate
  );
  const defaultRemainingLeaveDays = roundToNearestHalfDay(proratedAllowanceDays);

  return {
    financialYearStart: financialYear.start,
    financialYearEnd: financialYear.end,
    proratedAllowanceDays,
    defaultRemainingLeaveDays,
  };
}
