import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import {
  canDisableNotificationModule,
  NOTIFICATION_MODULE_KEYS,
  type NotificationModuleKey,
} from '@/types/notifications';

type PreferenceClient = Pick<SupabaseClient<Database>, 'from'>;

export interface InAppNotificationPreferenceRow {
  user_id?: string | null;
  module_key?: string | null;
  notify_in_app?: boolean | null;
}

export function shouldDeliverInAppNotification(
  moduleKey: NotificationModuleKey,
  preference?: Pick<InAppNotificationPreferenceRow, 'notify_in_app'> | null
): boolean {
  if (!canDisableNotificationModule(moduleKey)) return true;
  return preference?.notify_in_app !== false;
}

export function filterRecipientIdsByInAppPreference(
  recipientIds: string[],
  preferences: InAppNotificationPreferenceRow[],
  moduleKey: NotificationModuleKey
): string[] {
  const preferenceByUserId = new Map(
    preferences
      .filter((preference): preference is InAppNotificationPreferenceRow & { user_id: string } => (
        typeof preference.user_id === 'string' && preference.user_id.length > 0
      ))
      .map((preference) => [preference.user_id, preference])
  );

  return recipientIds.filter((recipientId) => (
    shouldDeliverInAppNotification(moduleKey, preferenceByUserId.get(recipientId))
  ));
}

export function disabledInAppModuleKeysFromRows(
  rows: InAppNotificationPreferenceRow[]
): Set<NotificationModuleKey> {
  const disabledKeys = new Set<NotificationModuleKey>();

  for (const row of rows) {
    if (typeof row.module_key !== 'string') continue;
    if (!NOTIFICATION_MODULE_KEYS.includes(row.module_key as NotificationModuleKey)) continue;

    const moduleKey = row.module_key as NotificationModuleKey;
    if (!shouldDeliverInAppNotification(moduleKey, row)) {
      disabledKeys.add(moduleKey);
    }
  }

  return disabledKeys;
}

export async function filterInAppRecipientIds(
  client: PreferenceClient,
  moduleKey: NotificationModuleKey,
  recipientIds: string[]
): Promise<string[]> {
  const uniqueRecipientIds = Array.from(new Set(recipientIds.filter(Boolean)));
  if (uniqueRecipientIds.length === 0 || !canDisableNotificationModule(moduleKey)) {
    return uniqueRecipientIds;
  }

  const { data, error } = await client
    .from('notification_preferences')
    .select('user_id, notify_in_app')
    .eq('module_key', moduleKey)
    .in('user_id', uniqueRecipientIds);

  if (error) {
    throw new Error(error.message || 'Failed to load notification preferences');
  }

  return filterRecipientIdsByInAppPreference(
    uniqueRecipientIds,
    (data || []) as InAppNotificationPreferenceRow[],
    moduleKey
  );
}

export async function getDisabledInAppNotificationModuleKeys(
  client: PreferenceClient,
  userId: string
): Promise<Set<NotificationModuleKey>> {
  const { data, error } = await client
    .from('notification_preferences')
    .select('module_key, notify_in_app')
    .eq('user_id', userId);

  if (error) {
    console.error('Failed to load notification preferences for inbox filtering:', error.message);
    return new Set();
  }

  return disabledInAppModuleKeysFromRows((data || []) as InAppNotificationPreferenceRow[]);
}
