import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { NotificationItem } from '@/types/messages';

type ServerSupabaseClient = SupabaseClient<Database>;

interface SenderShape {
  full_name?: string | null;
}

interface MessageShape {
  type?: NotificationItem['type'];
  priority?: NotificationItem['priority'];
  subject?: string | null;
  body?: string | null;
  sender_id?: string | null;
  created_at?: string | null;
  sender?: SenderShape | SenderShape[] | null;
}

interface RecipientShape {
  id?: string;
  message_id?: string;
  status?: NotificationItem['status'];
  signed_at?: string | null;
  first_shown_at?: string | null;
  messages?: MessageShape | MessageShape[] | null;
}

interface RecipientQueryResult {
  data: RecipientShape[] | null;
  error: { message?: string | null } | null;
}

interface NotificationCountQueryResult {
  count: number | null;
  error: { message?: string | null } | null;
}

const DEFAULT_NOTIFICATION_LIMIT = 50;
const MAX_NOTIFICATION_LIMIT = 100;
const NOTIFICATION_LOOKBACK_DAYS = 60;

function buildNotificationSinceIso(): string {
  const since = new Date();
  since.setDate(since.getDate() - NOTIFICATION_LOOKBACK_DAYS);
  return since.toISOString();
}

function isTransientFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|schema cache|bad gateway|502/i.test(message);
}

async function withRetry<T>(operation: () => Promise<T>, retries = 1): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientFetchError(error) || attempt === retries) {
        throw error;
      }
    }
  }

  throw normalizeNotificationError(lastError);
}

export function normalizeNotificationError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error('Unknown error');
}

function pickMessage(messages: RecipientShape['messages']): MessageShape | null {
  if (!messages) return null;
  return Array.isArray(messages) ? messages[0] ?? null : messages;
}

function pickSender(sender: MessageShape['sender']): SenderShape | null {
  if (!sender) return null;
  return Array.isArray(sender) ? sender[0] ?? null : sender;
}

export function parseNotificationLimit(limitParam: string | null): number {
  const parsed = Number.parseInt(limitParam ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_NOTIFICATION_LIMIT;
  }

  return Math.min(parsed, MAX_NOTIFICATION_LIMIT);
}

export async function listNotificationsForUser(
  supabase: ServerSupabaseClient,
  userId: string,
  options?: { limit?: number }
): Promise<NotificationItem[]> {
  const sinceIso = buildNotificationSinceIso();
  const limit = parseNotificationLimit(options?.limit ? String(options.limit) : null);
  const { data: recipients, error: fetchError } = await withRetry<RecipientQueryResult>(async () => {
    const result = (await supabase
      .from('message_recipients')
      .select(`
        id,
        message_id,
        status,
        signed_at,
        first_shown_at,
        created_at,
        messages!inner(
          id,
          type,
          subject,
          body,
          priority,
          sender_id,
          created_at,
          deleted_at,
          sender:profiles!messages_sender_id_fkey(
            id,
            full_name
          )
        )
      `)
      .eq('user_id', userId)
      .gte('messages.created_at', sinceIso)
      .is('cleared_from_inbox_at', null)
      .is('messages.deleted_at', null)
      .order('messages(created_at)', { ascending: false })
      .limit(limit)) as RecipientQueryResult;

    if (result.error && isTransientFetchError(result.error.message || '')) {
      throw new Error(result.error.message || 'Transient notifications query failure');
    }

    return result;
  });

  if (fetchError) {
    throw new Error(fetchError.message || 'Failed to fetch notifications');
  }

  return (recipients ?? [])
    .map((rawItem) => {
      const item = rawItem as RecipientShape;
      const message = pickMessage(item.messages);
      if (!message?.type || !message.priority || !message.created_at) return null;

      const sender = pickSender(message.sender);
      return {
        id: item.id ?? '',
        message_id: item.message_id ?? '',
        type: message.type,
        priority: message.priority,
        subject: message.subject ?? '',
        body: message.body ?? '',
        sender_name: sender?.full_name ?? 'Deleted User',
        sender_id: message.sender_id ?? null,
        status: item.status ?? 'PENDING',
        created_at: message.created_at,
        signed_at: item.signed_at ?? null,
        first_shown_at: item.first_shown_at ?? null,
      };
    })
    .filter((item): item is NotificationItem => item !== null);
}

export async function countUnreadNotificationsForUser(
  supabase: ServerSupabaseClient,
  userId: string
): Promise<number> {
  const sinceIso = buildNotificationSinceIso();
  const { count, error } = await withRetry<NotificationCountQueryResult>(async () => {
    const result = (await supabase
      .from('message_recipients')
      .select('id, messages!inner(id)', { count: 'planned', head: true })
      .eq('user_id', userId)
      .eq('status', 'PENDING')
      .gte('messages.created_at', sinceIso)
      .is('cleared_from_inbox_at', null)
      .is('messages.deleted_at', null)) as NotificationCountQueryResult;

    if (result.error && isTransientFetchError(result.error.message || '')) {
      throw new Error(result.error.message || 'Transient notification count failure');
    }

    return result;
  });

  if (error) {
    throw new Error(error.message || 'Failed to count notifications');
  }

  return count || 0;
}
