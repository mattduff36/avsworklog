import type { NotificationItem } from '@/types/messages';

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
