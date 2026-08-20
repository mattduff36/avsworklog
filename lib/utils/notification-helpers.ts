import type { NotificationItem } from '@/types/messages';
import type { NotificationModuleKey } from '@/types/notifications';

/**
 * Resolve which notification to open based on a recipient ID from a deep-link.
 * Returns the matching NotificationItem or null if not found.
 */
export function resolveNotificationToOpen(
  openNotificationId: string | null,
  notifications: NotificationItem[]
): NotificationItem | null {
  if (!openNotificationId || notifications.length === 0) return null;

  return notifications.find((n) => n.id === openNotificationId) ?? null;
}

export function isUnreadNotification(notification: Pick<NotificationItem, 'status' | 'type' | 'priority'>): boolean {
  if (notification.status === 'PENDING') return true;

  // Level 1 Toolbox Talks are internally marked SHOWN when the user chooses
  // read-later so they stop blocking the app, but they still require a later signature.
  return notification.status === 'SHOWN'
    && notification.type === 'TOOLBOX_TALK'
    && notification.priority === 'LOW';
}

export function resolveNotificationModuleKey(
  notification: Pick<NotificationItem, 'type' | 'created_via'> & {
    module_key?: NotificationModuleKey | null;
  }
): NotificationModuleKey {
  if (notification.module_key) return notification.module_key;

  const createdVia = notification.created_via ?? '';

  if (notification.type === 'TOOLBOX_TALK') return 'toolbox_talks';
  if (createdVia.startsWith('toolbox-talks')) return 'toolbox_talks';
  if (createdVia === 'sensitive_pin_security') return 'sensitive_pin_security';
  if (createdVia === 'maintenance_reminder') return 'maintenance';
  if (createdVia.includes('error')) return 'errors';
  if (createdVia.includes('quote')) return 'quotes';
  if (createdVia.startsWith('suggestion:')) return 'suggestions';
  if (createdVia === 'absence_contact_line_manager') return 'absence';
  if (
    createdVia === 'timesheet_did_not_work_exception' ||
    createdVia === 'timesheet_adjustment' ||
    createdVia === 'timesheet_rejection'
  ) {
    return 'timesheets';
  }
  if (createdVia === 'timesheet_training_decline') return 'training';
  if (createdVia === 'inventory_location_request') return 'inventory';
  if (
    createdVia === 'processed_absence_change' ||
    createdVia === 'processed_absence_timesheet_adjustment' ||
    createdVia.startsWith('processed_absence_')
  ) {
    return 'processed_absence';
  }
  if (notification.type === 'REMINDER') return 'reminders';

  return 'general_notifications';
}

export function dailyAllocationNotificationHref(
  notification: Pick<NotificationItem, 'daily_allocation_publication_id' | 'daily_allocation_labour_item_id'>
): string | null {
  if (notification.daily_allocation_publication_id) {
    return `/daily-allocation/my?publication=${notification.daily_allocation_publication_id}`;
  }
  if (notification.daily_allocation_labour_item_id) {
    return `/daily-allocation/my?item=${notification.daily_allocation_labour_item_id}`;
  }
  return null;
}
