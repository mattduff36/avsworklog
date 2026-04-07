import { describe, expect, it, vi } from 'vitest';
import {
  countUnreadNotificationsForUser,
  normalizeNotificationError,
  parseNotificationLimit,
} from '@/lib/server/notifications';

function createNotificationCountSupabaseMock(count: number | null, error: { message?: string | null } | null = null) {
  const response = { count, error };
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    is: vi.fn(() => query),
    then(onFulfilled?: (value: typeof response) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(response).then(onFulfilled, onRejected);
    },
  };

  return {
    supabase: {
      from: vi.fn(() => query),
    },
    query,
  };
}

describe('parseNotificationLimit', () => {
  it('falls back to the default limit for invalid values', () => {
    expect(parseNotificationLimit(null)).toBe(50);
    expect(parseNotificationLimit('')).toBe(50);
    expect(parseNotificationLimit('abc')).toBe(50);
    expect(parseNotificationLimit('-10')).toBe(50);
  });

  it('caps large values at the maximum limit', () => {
    expect(parseNotificationLimit('250')).toBe(100);
  });

  it('returns valid limits unchanged', () => {
    expect(parseNotificationLimit('25')).toBe(25);
    expect(parseNotificationLimit('100')).toBe(100);
  });
});

describe('normalizeNotificationError', () => {
  it('returns Error instances as-is', () => {
    const error = new Error('boom');
    expect(normalizeNotificationError(error)).toBe(error);
  });

  it('wraps string errors', () => {
    expect(normalizeNotificationError('failed').message).toBe('failed');
  });

  it('falls back to an unknown error message', () => {
    expect(normalizeNotificationError({ detail: 'no message' }).message).toBe('Unknown error');
  });
});

describe('countUnreadNotificationsForUser', () => {
  it('uses an exact count so the badge matches the inbox contents', async () => {
    const { supabase, query } = createNotificationCountSupabaseMock(0);

    await expect(countUnreadNotificationsForUser(supabase as never, 'user-1')).resolves.toBe(0);

    expect(supabase.from).toHaveBeenCalledWith('message_recipients');
    expect(query.select).toHaveBeenCalledWith('id, messages!inner(id)', { count: 'exact', head: true });
    expect(query.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'status', 'PENDING');
    expect(query.gte).toHaveBeenCalledWith('messages.created_at', expect.any(String));
    expect(query.is).toHaveBeenNthCalledWith(1, 'cleared_from_inbox_at', null);
    expect(query.is).toHaveBeenNthCalledWith(2, 'messages.deleted_at', null);
  });
});
