import { getFinancialYear } from '@/lib/utils/date';

export const DEFAULT_ANNUAL_LEAVE_ALLOWANCE_DAYS = 28;

export const CONTRACTOR_ONBOARDING_LEAVE_DEFAULTS = {
  annualAllowanceDays: 0,
  remainingLeaveDays: 0,
  autoBookBankHolidays: false,
  autoApplyBulkBookings: false,
} as const;

export interface NewUserOnboardingCalculationInput {
  annualAllowanceDays: number;
  onboardingDate?: Date;
}

export interface ContractorOnboardingPayload {
  annualAllowanceDays: number;
  remainingLeaveDays: number;
  autoBookBankHolidays: boolean;
  autoApplyBulkBookings: boolean;
  selectedBulkBatchIds?: string[];
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

export function isContractorOnboardingRole(
  role?: { name?: string | null; display_name?: string | null } | null
): boolean {
  const roleName = role?.name?.trim().toLowerCase();
  const roleDisplayName = role?.display_name?.trim().toLowerCase();
  return roleName === 'contractor' || roleDisplayName === 'contractor';
}

export function getContractorOnboardingViolation(
  payload: ContractorOnboardingPayload
): string | null {
  if (payload.annualAllowanceDays !== CONTRACTOR_ONBOARDING_LEAVE_DEFAULTS.annualAllowanceDays) {
    return 'Contractor accounts must be created with 0 annual leave allowance.';
  }
  if (payload.remainingLeaveDays !== CONTRACTOR_ONBOARDING_LEAVE_DEFAULTS.remainingLeaveDays) {
    return 'Contractor accounts must be created with 0 remaining annual leave.';
  }
  if (payload.autoBookBankHolidays !== CONTRACTOR_ONBOARDING_LEAVE_DEFAULTS.autoBookBankHolidays) {
    return 'Contractor accounts cannot auto-book bank holidays.';
  }
  if (payload.autoApplyBulkBookings !== CONTRACTOR_ONBOARDING_LEAVE_DEFAULTS.autoApplyBulkBookings) {
    return 'Contractor accounts cannot auto-apply bulk absence bookings.';
  }
  if ((payload.selectedBulkBatchIds || []).length > 0) {
    return 'Contractor accounts cannot receive bulk absence bookings during onboarding.';
  }
  return null;
}
