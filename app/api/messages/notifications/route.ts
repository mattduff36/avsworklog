import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { GetNotificationsResponse, NotificationItem } from '@/types/messages';

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

function isTransientFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(message);
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
  throw normalizeError(lastError);
}

function normalizeError(error: unknown): Error {
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

/**
 * GET /api/messages/notifications
 * Fetch notification inbox for current user (last 60 days, not cleared)
 * Returns both Toolbox Talks and Reminders with their statuses
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await withRetry(
      () => supabase.auth.getUser()
    );
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Calculate 60 days ago
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Fetch notifications (last 60 days, not cleared, not deleted messages)
    const { data: recipients, error: fetchError } = await supabase
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
          sender:sender_id(
            id,
            full_name
          )
        )
      `)
      .eq('user_id', user.id)
      .gte('messages.created_at', sixtyDaysAgo.toISOString())
      .is('cleared_from_inbox_at', null)
      .is('messages.deleted_at', null)
      .order('messages(created_at)', { ascending: false });

    if (fetchError) {
      console.error('Error fetching notifications:', fetchError);
      throw new Error(fetchError.message || 'Failed to fetch notifications');
    }

    // Transform to NotificationItem format
    const notifications: NotificationItem[] = (recipients ?? [])
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

    // Count unread (PENDING status)
    const unread_count = notifications.filter(n => n.status === 'PENDING').length;

    const response: GetNotificationsResponse = {
      success: true,
      notifications,
      unread_count
    };

    return NextResponse.json(response);

  } catch (error) {
    const normalizedError = normalizeError(error);
    console.error('Error in GET /api/messages/notifications:', normalizedError);

    try {
      await logServerError({
        error: normalizedError,
        componentName: '/api/messages/notifications',
        additionalData: {
          endpoint: '/api/messages/notifications',
        },
      });
    } catch (logError) {
      console.error('Failed to log server error for /api/messages/notifications:', logError);
    }
    return NextResponse.json({ 
      error: normalizedError.message || 'Internal server error',
    }, { status: 500 });
  }
}

