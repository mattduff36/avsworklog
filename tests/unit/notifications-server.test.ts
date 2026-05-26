import { describe, expect, it, vi } from 'vitest';
import {
  countUnreadNotificationsForUser,
  listNotificationsForUser,
  normalizeNotificationError,
  parseNotificationLimit,
} from '@/lib/server/notifications';
import { createSupabaseQueryMock } from '@/tests/utils/supabase-query-mock';

function createNotificationsSupabaseMock(
  data: unknown[] | null,
  error: { message?: string | null } | null = null
) {
  const response = { data, error };
  const query = createSupabaseQueryMock(response, ['select', 'eq', 'gte', 'is', 'order', 'limit']);

  return {
    supabase: {
      from: vi.fn(() => query),
    },
    query,
  };
}

function createNotificationCountSupabaseMock(count: number | null, error: { message?: string | null } | null = null) {
  const response = { count, error };
  const query = createSupabaseQueryMock(response, ['select', 'eq', 'gte', 'is']);

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

describe('listNotificationsForUser', () => {
  it('preserves toolbox talk PDF paths for notification detail links', async () => {
    const { supabase, query } = createNotificationsSupabaseMock([
      {
        id: 'recipient-1',
        message_id: 'message-1',
        status: 'SIGNED',
        signed_at: '2026-05-19T09:00:00.000Z',
        first_shown_at: '2026-05-19T08:00:00.000Z',
        signature_data: 'data:image/png;base64,signature',
        messages: {
          type: 'TOOLBOX_TALK',
          priority: 'HIGH',
          created_via: 'web',
          subject: 'Harness safety',
          body: 'Read the attached document.',
          pdf_file_path: 'sender-1/1716111111111_harness.pdf',
          sender_id: 'sender-1',
          created_at: '2026-05-19T07:00:00.000Z',
          sender: {
            full_name: 'Site Manager',
          },
        },
      },
    ]);

    await expect(listNotificationsForUser(supabase as never, 'user-1')).resolves.toMatchObject([
      {
        id: 'recipient-1',
        message_id: 'message-1',
        type: 'TOOLBOX_TALK',
        pdf_file_path: 'sender-1/1716111111111_harness.pdf',
        signature_data: 'data:image/png;base64,signature',
      },
    ]);

    expect(query.select).toHaveBeenCalledWith(expect.stringContaining('pdf_file_path'));
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
