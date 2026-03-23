import { describe, expect, it } from 'vitest';
import { calculateDurationDays } from '@/lib/utils/date';
import { cloneWorkShiftPattern, STANDARD_WORK_SHIFT_PATTERN } from '@/lib/utils/work-shifts';

describe('work shift duration calculation', () => {
  it('keeps the standard Monday-Friday week at five days', () => {
    const days = calculateDurationDays(
      new Date('2026-03-23T00:00:00'),
      new Date('2026-03-29T00:00:00'),
      false,
      {
        pattern: STANDARD_WORK_SHIFT_PATTERN,
      }
    );

    expect(days).toBe(5);
  });

  it('counts part-time AM and PM sessions as half days', () => {
    const partTimePattern = cloneWorkShiftPattern({
      monday_am: true,
      monday_pm: false,
      tuesday_am: false,
      tuesday_pm: false,
      wednesday_am: true,
      wednesday_pm: true,
      thursday_am: false,
      thursday_pm: false,
      friday_am: false,
      friday_pm: true,
    });

    const days = calculateDurationDays(
      new Date('2026-03-23T00:00:00'),
      new Date('2026-03-27T00:00:00'),
      false,
      {
        pattern: partTimePattern,
      }
    );

    expect(days).toBe(2);
  });

  it('counts weekend-working employees correctly', () => {
    const weekendPattern = cloneWorkShiftPattern({
      monday_am: false,
      monday_pm: false,
      tuesday_am: false,
      tuesday_pm: false,
      wednesday_am: false,
      wednesday_pm: false,
      thursday_am: false,
      thursday_pm: false,
      friday_am: false,
      friday_pm: false,
      saturday_am: true,
      saturday_pm: true,
      sunday_am: true,
      sunday_pm: false,
    });

    const days = calculateDurationDays(
      new Date('2026-03-28T00:00:00'),
      new Date('2026-03-29T00:00:00'),
      false,
      {
        pattern: weekendPattern,
      }
    );

    expect(days).toBe(1.5);
  });

  it('uses the selected AM or PM half-day session', () => {
    const afternoonOnlyPattern = cloneWorkShiftPattern({
      monday_am: false,
      monday_pm: true,
    });

    const morning = calculateDurationDays(
      new Date('2026-03-23T00:00:00'),
      null,
      true,
      {
        pattern: afternoonOnlyPattern,
        halfDaySession: 'AM',
      }
    );

    const afternoon = calculateDurationDays(
      new Date('2026-03-23T00:00:00'),
      null,
      true,
      {
        pattern: afternoonOnlyPattern,
        halfDaySession: 'PM',
      }
    );

    expect(morning).toBe(0);
    expect(afternoon).toBe(0.5);
  });
});
