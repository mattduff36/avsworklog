import { describe, expect, it } from 'vitest';

import {
  calculateNewUserRemainingLeaveDefault,
  calculateProratedAllowanceDays,
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
});
