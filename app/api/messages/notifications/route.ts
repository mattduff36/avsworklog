import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { GetNotificationsResponse, NotificationItem } from '@/types/messages';

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error('Unknown error');
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
    const { data: { user }, error: userError } = await supabase.auth.getUser();
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
      .order('messages(created_at)', { ascending: false }); // Newest first

    if (fetchError) {
      console.error('Error fetching notifications:', fetchError);
      throw new Error(fetchError.message || 'Failed to fetch notifications');
    }

    // Transform to NotificationItem format
    const notifications: NotificationItem[] = recipients?.map(item => ({
      id: item.id,
      message_id: item.message_id,
      type: item.messages.type,
      priority: item.messages.priority,
      subject: item.messages.subject,
      body: item.messages.body,
      sender_name: item.messages.sender?.full_name || 'Deleted User',
      sender_id: item.messages.sender_id,
      status: item.status,
      created_at: item.messages.created_at,
      signed_at: item.signed_at,
      first_shown_at: item.first_shown_at
    })) || [];

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

