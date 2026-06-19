import { describe, expect, it, vi } from 'vitest';
import {
  CHECK_INTERVAL_DAYS,
  CHECK_INTERVAL_MONTHS,
  formatInventoryCheckIntervalMonths,
  formatInventoryUnknownLocationAge,
  formatInventoryDate,
  getInventoryCheckIntervalDays,
  getInventoryCheckIntervalMonths,
  getInventoryCheckStatus,
  getInventoryDueDate,
  hasInventoryCheckLapsedForCategoryExit,
} from '@/app/(dashboard)/inventory/utils';

describe('inventory utils', () => {
  it('falls back to the default check interval', () => {
    expect(getInventoryCheckIntervalDays({ check_interval_days: null })).toBe(CHECK_INTERVAL_DAYS);
    expect(getInventoryCheckIntervalMonths({ check_interval_days: null })).toBe(CHECK_INTERVAL_MONTHS);
  });

  it('uses an item-specific check interval when present', () => {
    expect(getInventoryCheckIntervalDays({ check_interval_days: 90 })).toBe(90);
    expect(getInventoryCheckIntervalMonths({ check_interval_days: 90 })).toBe(3);
    expect(formatInventoryCheckIntervalMonths(3)).toBe('3 months');
    expect(getInventoryDueDate('2026-01-01', 3)).toBe('01 Apr 2026');
  });

  it('formats date-only and timestamp inventory dates', () => {
    expect(formatInventoryDate('2026-06-01')).toBe('01 Jun 2026');
    expect(formatInventoryDate('2026-06-01T14:08:25.330Z')).toBe('01 Jun 2026');
    expect(formatInventoryDate('not-a-date')).toBe('Not checked');
  });

  it('calculates due soon and overdue against per-item intervals', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T12:00:00Z'));

    expect(getInventoryCheckStatus({ last_checked_at: '2026-04-25', check_interval_days: 30 })).toBe('due_soon');
    expect(getInventoryCheckStatus({ last_checked_at: '2026-04-01', check_interval_days: 30 })).toBe('overdue');
    expect(getInventoryCheckStatus({ last_checked_at: null, check_interval_days: 30 })).toBe('needs_check');

    vi.useRealTimers();
  });

  it('suppresses due dates for special inventory statuses', () => {
    expect(getInventoryCheckStatus({
      category: 'check_on_demand',
      last_checked_at: '2026-01-01',
      check_interval_days: 30,
    })).toBe('not_required');

    expect(getInventoryCheckStatus({
      category: 'tools',
      location: { name: 'Unknown' },
      last_checked_at: null,
      check_interval_days: null,
    })).toBe('not_required');
  });

  it('calculates unknown-location age from movement or created date fallback', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T12:00:00Z'));

    expect(formatInventoryUnknownLocationAge({
      location: { name: 'Unknown' },
      unknown_location_entered_at: '2026-06-17T08:00:00Z',
      created_at: '2026-06-01T08:00:00Z',
    })).toBe('In Unknown for 2 days');

    expect(formatInventoryUnknownLocationAge({
      location: { name: 'Unknown' },
      unknown_location_entered_at: null,
      created_at: '2026-06-18T08:00:00Z',
    })).toBe('In Unknown for 1 day');

    vi.useRealTimers();
  });

  it('blocks leaving check-on-demand when the normal check has lapsed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T12:00:00Z'));

    expect(hasInventoryCheckLapsedForCategoryExit({ last_checked_at: '2026-04-01', check_interval_days: 30 })).toBe(true);
    expect(hasInventoryCheckLapsedForCategoryExit({ last_checked_at: null, check_interval_days: 30 })).toBe(true);
    expect(hasInventoryCheckLapsedForCategoryExit({ last_checked_at: '2026-04-25', check_interval_days: 30 })).toBe(false);

    vi.useRealTimers();
  });
});
