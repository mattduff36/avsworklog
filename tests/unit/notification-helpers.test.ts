import { describe, it, expect } from 'vitest';
import { resolveNotificationToOpen } from '@/lib/utils/notification-helpers';
import type { NotificationItem } from '@/types/messages';

function makeNotification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'rec-1',
    message_id: 'msg-1',
    type: 'REMINDER',
    priority: 'LOW',
    subject: 'Test notification',
    body: 'Body text',
    sender_name: 'Alice',
    sender_id: 'user-1',
    status: 'PENDING',
    created_at: '2026-02-01T10:00:00Z',
    signed_at: null,
    first_shown_at: null,
    ...overrides,
  };
}

describe('resolveNotificationToOpen', () => {
  const notifications: NotificationItem[] = [
    makeNotification({ id: 'rec-1', subject: 'First' }),
    makeNotification({ id: 'rec-2', subject: 'Second', status: 'SIGNED' }),
    makeNotification({ id: 'rec-3', subject: 'Third', status: 'DISMISSED' }),
  ];

  it('returns the matching notification by recipient id', () => {
    const result = resolveNotificationToOpen('rec-2', notifications);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('rec-2');
    expect(result!.subject).toBe('Second');
  });

  it('returns null when id is not found', () => {
    const result = resolveNotificationToOpen('rec-999', notifications);
    expect(result).toBeNull();
  });

  it('returns null when openNotificationId is null', () => {
    const result = resolveNotificationToOpen(null, notifications);
    expect(result).toBeNull();
  });

  it('returns null when openNotificationId is empty string', () => {
    const result = resolveNotificationToOpen('', notifications);
    expect(result).toBeNull();
  });

  it('returns null when notifications array is empty', () => {
    const result = resolveNotificationToOpen('rec-1', []);
    expect(result).toBeNull();
  });

  it('returns the first exact match when duplicates exist', () => {
    const dupes = [
      makeNotification({ id: 'dup', subject: 'First match' }),
      makeNotification({ id: 'dup', subject: 'Second match' }),
    ];
    const result = resolveNotificationToOpen('dup', dupes);
    expect(result).not.toBeNull();
    expect(result!.subject).toBe('First match');
  });
});
