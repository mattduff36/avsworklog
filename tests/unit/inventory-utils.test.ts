import { describe, expect, it, vi } from 'vitest';
import {
  CHECK_INTERVAL_DAYS,
  getInventoryCheckIntervalDays,
  getInventoryCheckStatus,
  getInventoryDueDate,
} from '@/app/(dashboard)/inventory/utils';

describe('inventory utils', () => {
  it('falls back to the default check interval', () => {
    expect(getInventoryCheckIntervalDays({ check_interval_days: null })).toBe(CHECK_INTERVAL_DAYS);
  });

  it('uses an item-specific check interval when present', () => {
    expect(getInventoryCheckIntervalDays({ check_interval_days: 90 })).toBe(90);
    expect(getInventoryDueDate('2026-01-01', 90)).toBe('01 Apr 2026');
  });

  it('calculates due soon and overdue against per-item intervals', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T12:00:00Z'));

    expect(getInventoryCheckStatus({ last_checked_at: '2026-05-01', check_interval_days: 20 })).toBe('due_soon');
    expect(getInventoryCheckStatus({ last_checked_at: '2026-05-01', check_interval_days: 10 })).toBe('overdue');
    expect(getInventoryCheckStatus({ last_checked_at: null, check_interval_days: 10 })).toBe('needs_check');

    vi.useRealTimers();
  });
});
