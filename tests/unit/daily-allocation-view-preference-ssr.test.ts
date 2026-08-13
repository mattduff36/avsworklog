import { describe, expect, it } from 'vitest';
import {
  DAILY_ALLOCATION_BOARD_VIEWS,
  readDailyAllocationViewPreference,
  writeDailyAllocationViewPreference,
} from '@/lib/config/daily-allocation-view-preference';

describe('daily allocation view preference SSR guards', () => {
  it('returns the daily default when window is unavailable', () => {
    expect(typeof window).toBe('undefined');
    expect(readDailyAllocationViewPreference('user-1')).toBe(DAILY_ALLOCATION_BOARD_VIEWS.daily);
    writeDailyAllocationViewPreference('user-1', 'weekly');
    expect(readDailyAllocationViewPreference('user-1')).toBe(DAILY_ALLOCATION_BOARD_VIEWS.daily);
  });
});
