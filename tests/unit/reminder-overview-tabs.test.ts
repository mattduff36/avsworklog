import { describe, expect, it } from 'vitest';
import {
  isReminderCategoryTabId,
  isReminderDailyCheckTabId,
  REMINDER_CATEGORY_TABS,
  REMINDER_DAILY_CHECK_TABS,
  REMINDER_OVERVIEW_TABS,
} from '@/lib/config/reminder-workflows';

describe('reminder overview tab hierarchy', () => {
  it('keeps vans, plant, and HGVs as Daily Checks sub-tabs', () => {
    expect(REMINDER_DAILY_CHECK_TABS.map((tab) => tab.id)).toEqual(['vans', 'plant', 'hgvs']);
    expect(REMINDER_DAILY_CHECK_TABS.some((tab) => isReminderCategoryTabId(tab.id))).toBe(false);
  });

  it('treats legacy job addresses and yard transfers as main categories', () => {
    expect(REMINDER_CATEGORY_TABS.map((tab) => tab.id)).toEqual([
      'legacy-job-addresses',
      'yard-transfers',
    ]);
    expect(REMINDER_CATEGORY_TABS.every((tab) => isReminderCategoryTabId(tab.id))).toBe(true);
    expect(REMINDER_CATEGORY_TABS.some((tab) => isReminderDailyCheckTabId(tab.id))).toBe(false);
  });

  it('keeps existing overview tab ids valid for shared routes', () => {
    expect(REMINDER_OVERVIEW_TABS.map((tab) => tab.id)).toEqual([
      'vans',
      'plant',
      'hgvs',
      'legacy-job-addresses',
      'yard-transfers',
    ]);
  });
});
