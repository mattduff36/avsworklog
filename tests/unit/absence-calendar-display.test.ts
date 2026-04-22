import { describe, expect, it } from 'vitest';
import { getWorkingDisplayDatesForAbsence } from '@/lib/utils/absence-calendar-display';
import { cloneWorkShiftPattern, STANDARD_WORK_SHIFT_PATTERN } from '@/lib/utils/work-shifts';

describe('absence calendar display dates', () => {
  it('shows only working days for a standard Wednesday-to-Wednesday booking', () => {
    const dates = getWorkingDisplayDatesForAbsence(
      {
        date: '2026-04-01',
        endDate: '2026-04-08',
        isHalfDay: false,
        halfDaySession: null,
      },
      STANDARD_WORK_SHIFT_PATTERN
    );

    expect(dates).toEqual([
      '2026-04-01',
      '2026-04-02',
      '2026-04-03',
      '2026-04-06',
      '2026-04-07',
      '2026-04-08',
    ]);
  });

  it('includes weekend days when the work shift pattern marks them as working', () => {
    const weekendPattern = cloneWorkShiftPattern({
      saturday_am: true,
      saturday_pm: true,
      sunday_am: true,
      sunday_pm: true,
    });

    const dates = getWorkingDisplayDatesForAbsence(
      {
        date: '2026-04-03',
        endDate: '2026-04-06',
        isHalfDay: false,
        halfDaySession: null,
      },
      weekendPattern
    );

    expect(dates).toEqual([
      '2026-04-03',
      '2026-04-04',
      '2026-04-05',
      '2026-04-06',
    ]);
  });
});
