/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it } from 'vitest';
import {
  DAILY_ALLOCATION_BOARD_VIEWS,
  getDailyAllocationViewStorageKey,
  readDailyAllocationViewPreference,
  writeDailyAllocationViewPreference,
} from '@/lib/config/daily-allocation-view-preference';

describe('daily allocation view preference', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to daily and persists weekly safely', () => {
    expect(readDailyAllocationViewPreference('user-1')).toBe(DAILY_ALLOCATION_BOARD_VIEWS.daily);
    writeDailyAllocationViewPreference('user-1', 'weekly');
    expect(localStorage.getItem(getDailyAllocationViewStorageKey('user-1'))).toBe('weekly');
    expect(readDailyAllocationViewPreference('user-1')).toBe('weekly');
    writeDailyAllocationViewPreference('user-1', 'daily');
    expect(readDailyAllocationViewPreference('user-1')).toBe('daily');
  });

  it('ignores invalid stored values and empty users', () => {
    localStorage.setItem(getDailyAllocationViewStorageKey('user-1'), 'month');
    expect(readDailyAllocationViewPreference('user-1')).toBe('daily');
    writeDailyAllocationViewPreference('', 'weekly');
    expect(readDailyAllocationViewPreference('')).toBe('daily');
  });
});
