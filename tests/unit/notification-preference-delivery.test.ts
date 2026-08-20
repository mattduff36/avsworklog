import { describe, expect, it, vi } from 'vitest';
import {
  disabledInAppModuleKeysFromRows,
  filterInAppRecipientIds,
  filterRecipientIdsByInAppPreference,
  getDisabledInAppNotificationModuleKeys,
  shouldDeliverInAppNotification,
} from '@/lib/server/notification-preference-delivery';
import { createSupabaseQueryMock } from '@/tests/utils/supabase-query-mock';

describe('shouldDeliverInAppNotification', () => {
  it('delivers by default when no preference exists', () => {
    expect(shouldDeliverInAppNotification('timesheets')).toBe(true);
    expect(shouldDeliverInAppNotification('timesheets', null)).toBe(true);
  });

  it('honors an explicit in-app opt-out', () => {
    expect(shouldDeliverInAppNotification('timesheets', { notify_in_app: false })).toBe(false);
  });

  it('keeps required modules deliverable even if a preference is off', () => {
    expect(shouldDeliverInAppNotification('toolbox_talks', { notify_in_app: false })).toBe(true);
  });
});

describe('filterRecipientIdsByInAppPreference', () => {
  it('keeps recipients without a preference row and drops opted-out users', () => {
    expect(
      filterRecipientIdsByInAppPreference(
        ['manager-1', 'admin-1', 'admin-2'],
        [
          { user_id: 'admin-1', notify_in_app: false },
          { user_id: 'admin-2', notify_in_app: true },
        ],
        'timesheets'
      )
    ).toEqual(['manager-1', 'admin-2']);
  });
});

describe('disabledInAppModuleKeysFromRows', () => {
  it('collects only disableable modules that opted out of in-app delivery', () => {
    expect(
      disabledInAppModuleKeysFromRows([
        { module_key: 'timesheets', notify_in_app: false },
        { module_key: 'absence', notify_in_app: true },
        { module_key: 'toolbox_talks', notify_in_app: false },
        { module_key: 'not-a-module', notify_in_app: false },
      ])
    ).toEqual(new Set(['timesheets']));
  });
});

describe('filterInAppRecipientIds', () => {
  it('loads timesheet preferences and excludes opted-out recipients', async () => {
    const query = createSupabaseQueryMock(
      {
        data: [{ user_id: 'admin-1', notify_in_app: false }],
        error: null,
      },
      ['select', 'eq', 'in']
    );
    const client = { from: vi.fn(() => query) };

    await expect(
      filterInAppRecipientIds(client as never, 'timesheets', ['admin-1', 'manager-1'])
    ).resolves.toEqual(['manager-1']);

    expect(client.from).toHaveBeenCalledWith('notification_preferences');
    expect(query.eq).toHaveBeenCalledWith('module_key', 'timesheets');
    expect(query.in).toHaveBeenCalledWith('user_id', ['admin-1', 'manager-1']);
  });

  it('returns an empty list without querying when there are no recipients', async () => {
    const client = { from: vi.fn() };

    await expect(filterInAppRecipientIds(client as never, 'timesheets', [])).resolves.toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe('getDisabledInAppNotificationModuleKeys', () => {
  it('fails open when preferences cannot be loaded', async () => {
    const query = createSupabaseQueryMock(
      {
        data: null,
        error: { message: 'permission denied' },
      },
      ['select', 'eq', 'in']
    );
    const client = { from: vi.fn(() => query) };

    await expect(getDisabledInAppNotificationModuleKeys(client as never, 'user-1')).resolves.toEqual(new Set());
  });
});
