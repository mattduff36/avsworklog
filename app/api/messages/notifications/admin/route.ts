import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { GetNotificationsResponse, NotificationItem } from '@/types/messages';

/**
 * GET /api/messages/notifications/admin
 * Fetch notifications for a specific user (admin only)
 * Query param: user_id=<uuid>
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const profile = await getProfileWithRole(user.id);
    if (!profile?.role || !profile.role.is_manager_admin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Get target user from query params
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('user_id');

    if (!targetUserId) {
      return NextResponse.json({ error: 'Missing user_id query parameter' }, { status: 400 });
    }

    // Calculate 60 days ago
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Fetch notifications for the target user
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
      .eq('user_id', targetUserId)
      .gte('messages.created_at', sixtyDaysAgo.toISOString())
      .is('cleared_from_inbox_at', null)
      .is('messages.deleted_at', null)
      .order('messages(created_at)', { ascending: false }); // Newest first

    if (fetchError) {
      console.error('Error fetching notifications:', fetchError);
      throw fetchError;
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
    console.error('Error in GET /api/messages/notifications/admin:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/messages/notifications/admin',
      additionalData: {
        endpoint: '/api/messages/notifications/admin',
      },
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
