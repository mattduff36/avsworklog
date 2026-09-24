import { describe, expect, it } from 'vitest';

import {
  calculateNewUserRemainingLeaveDefault,
  calculateProratedAllowanceDays,
  CONTRACTOR_ONBOARDING_LEAVE_DEFAULTS,
  getContractorOnboardingViolation,
  isContractorOnboardingRole,
  roundToNearestHalfDay,
} from '@/lib/utils/absence-onboarding';

describe('absence onboarding calculations', () => {
  it('returns full allowance when onboarding on FY start', () => {
    const result = calculateNewUserRemainingLeaveDefault({
      annualAllowanceDays: 28,
      onboardingDate: new Date('2025-04-01T00:00:00Z'),
    });

    expect(result.proratedAllowanceDays).toBe(28);
    expect(result.defaultRemainingLeaveDays).toBe(28);
  });

  it('prorates allowance only for mid-year onboarding', () => {
    const result = calculateNewUserRemainingLeaveDefault({
      annualAllowanceDays: 28,
      onboardingDate: new Date('2025-10-01T00:00:00Z'),
    });

    expect(result.proratedAllowanceDays).toBe(13.96);
    expect(result.defaultRemainingLeaveDays).toBe(14);
  });

  it('calculates prorated allowance using inclusive date boundaries', () => {
    const prorated = calculateProratedAllowanceDays(
      30,
      new Date('2025-04-01T00:00:00Z'),
      new Date('2026-03-31T00:00:00Z'),
      new Date('2025-04-01T00:00:00Z')
    );

    expect(prorated).toBe(30);
  });

  it('rounds remaining leave values to nearest half day', () => {
    expect(roundToNearestHalfDay(0.15)).toBe(0);
    expect(roundToNearestHalfDay(13.74)).toBe(13.5);
    expect(roundToNearestHalfDay(13.76)).toBe(14);
  });

  it('uses only the stable internal role name for Contractor identity', () => {
    expect(isContractorOnboardingRole({ name: 'contractor' })).toBe(true);
    expect(isContractorOnboardingRole({ name: 'employee', display_name: 'Contractor' })).toBe(false);
    expect(isContractorOnboardingRole({ name: 'employee' })).toBe(false);
  });

  it('accepts only 0/0/no/no contractor onboarding payloads', () => {
    expect(getContractorOnboardingViolation({
      annualAllowanceDays: CONTRACTOR_ONBOARDING_LEAVE_DEFAULTS.annualAllowanceDays,
      remainingLeaveDays: CONTRACTOR_ONBOARDING_LEAVE_DEFAULTS.remainingLeaveDays,
      autoBookBankHolidays: false,
      autoApplyBulkBookings: false,
      selectedBulkBatchIds: [],
    })).toBeNull();

    expect(getContractorOnboardingViolation({
      annualAllowanceDays: 28,
      remainingLeaveDays: 0,
      autoBookBankHolidays: false,
      autoApplyBulkBookings: false,
    })).toContain('0 annual leave allowance');

    expect(getContractorOnboardingViolation({
      annualAllowanceDays: 0,
      remainingLeaveDays: 0,
      autoBookBankHolidays: true,
      autoApplyBulkBookings: false,
    })).toContain('cannot auto-book bank holidays');

    expect(getContractorOnboardingViolation({
      annualAllowanceDays: 0,
      remainingLeaveDays: 0,
      autoBookBankHolidays: false,
      autoApplyBulkBookings: false,
      selectedBulkBatchIds: ['batch-1'],
    })).toContain('cannot receive bulk absence bookings');
  });
});
