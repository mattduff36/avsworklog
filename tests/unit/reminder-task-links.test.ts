import { describe, expect, it } from 'vitest';
import { getReminderTaskLink, getReminderTaskName } from '@/lib/utils/reminder-task-links';
import { getReminderAssetIdColumn } from '@/lib/server/reminders/complete-reminder-action';

describe('reminder task links', () => {
  it('links fleet inspection reminders to the matching new daily check page', () => {
    expect(getReminderTaskLink('van')).toEqual({
      href: '/van-inspections/new',
      label: 'Start van daily check',
    });
    expect(getReminderTaskLink('plant')).toEqual({
      href: '/plant-inspections/new',
      label: 'Start plant daily check',
    });
    expect(getReminderTaskLink('hgv')).toEqual({
      href: '/hgv-inspections/new',
      label: 'Start HGV daily check',
    });
  });

  it('returns simple task names for user-facing reminder text', () => {
    expect(getReminderTaskName('van')).toBe('van daily check');
    expect(getReminderTaskName('plant')).toBe('plant daily check');
    expect(getReminderTaskName('hgv')).toBe('HGV daily check');
    expect(getReminderTaskName(null)).toBe('assigned task');
  });

  it('maps asset types to reminder action id columns', () => {
    expect(getReminderAssetIdColumn('van')).toBe('van_id');
    expect(getReminderAssetIdColumn('plant')).toBe('plant_id');
    expect(getReminderAssetIdColumn('hgv')).toBe('hgv_id');
  });
});
