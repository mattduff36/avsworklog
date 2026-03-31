import { describe, expect, it } from 'vitest';
import {
  buildLeaveAwareTotals,
  buildLeaveDaysBreakdown,
  formatLeaveAwareWeeklyDisplay,
} from '@/lib/utils/timesheet-leave-totals';

describe('timesheet leave-aware totals', () => {
  it('shows full-day leave as day units and excludes leave credit from worked hours', () => {
    const totals = buildLeaveAwareTotals(
      [{ day_of_week: 2, daily_total: 9 }],
      [
        {
          day_of_week: 2,
          isOnApprovedLeave: true,
          paidLeaveHours: 9,
          leaveLabels: [{ session: 'FULL', isPaid: true }],
        },
      ]
    );

    expect(totals.rowByDay.get(2)?.display).toBe('1 day');
    expect(totals.weekly.workedHours).toBe(0);
    expect(totals.weekly.leaveDays).toBe(1);
    expect(totals.weekly.display).toBe('0 hours + 1 day');
  });

  it('shows mixed half-day leave rows as worked hours plus leave unit', () => {
    const totals = buildLeaveAwareTotals(
      [{ day_of_week: 3, daily_total: 9.5 }],
      [
        {
          day_of_week: 3,
          isOnApprovedLeave: true,
          paidLeaveHours: 4.5,
          leaveLabels: [{ session: 'AM', isPaid: true }],
        },
      ]
    );

    expect(totals.rowByDay.get(3)?.workedHours).toBe(5);
    expect(totals.rowByDay.get(3)?.display).toBe('5.00h + Half day');
    expect(totals.weekly.display).toBe('5 hours + Half day');
  });

  it('keeps non-leave rows as plain hour totals', () => {
    const totals = buildLeaveAwareTotals([{ day_of_week: 1, daily_total: 8 }], []);
    expect(totals.rowByDay.get(1)?.display).toBe('8.00h');
    expect(totals.weekly.display).toBe('8.00h');
  });

  it('calculates paid and unpaid leave day breakdown by session', () => {
    const breakdown = buildLeaveDaysBreakdown([
      {
        day_of_week: 4,
        isOnApprovedLeave: true,
        paidLeaveHours: 4.5,
        leaveLabels: [
          { session: 'AM', isPaid: true },
          { session: 'PM', isPaid: false },
        ],
      },
    ]);

    expect(breakdown.leaveDays).toBe(1);
    expect(breakdown.paidLeaveDays).toBe(0.5);
    expect(breakdown.unpaidLeaveDays).toBe(0.5);
  });

  it('formats weekly leave-aware display with compact hour/day values', () => {
    expect(formatLeaveAwareWeeklyDisplay(27, 1.5)).toBe('27 hours + 1.5 days');
  });
});
