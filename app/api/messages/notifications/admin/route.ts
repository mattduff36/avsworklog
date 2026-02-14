import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { GetNotificationsResponse, NotificationItem } from '@/types/messages';

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error('Unknown error');
}

/**
 * GET /api/messages/notifications/admin
 * Fetch notifications for a specific user
 * 
 * Authorization: Super Admin OR Admin role ONLY (not regular managers)
 * Query param: user_id=<uuid>
 * 
 * Security: Verifies target user exists before fetching their data
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin (strict: super admin OR admin role only, NOT regular managers)
    const profile = await getProfileWithRole(user.id);
    const isStrictAdmin = profile?.role?.is_super_admin === true || profile?.role?.name === 'admin';
    
    if (!isStrictAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Get target user from query params
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('user_id');

    if (!targetUserId) {
      return NextResponse.json({ error: 'Missing user_id query parameter' }, { status: 400 });
    }

    // Verify target user exists (prevents admins from querying non-existent users)
    const { data: targetProfile, error: targetError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', targetUserId)
      .single();

    if (targetError || !targetProfile) {
      return NextResponse.json({ error: 'Invalid user_id: User not found' }, { status: 404 });
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
    console.error('Error in GET /api/messages/notifications/admin:', normalizedError);

    try {
      await logServerError({
        error: normalizedError,
        request,
        componentName: '/api/messages/notifications/admin',
        additionalData: {
          endpoint: '/api/messages/notifications/admin',
        },
      });
    } catch (logError) {
      console.error('Failed to log server error for /api/messages/notifications/admin:', logError);
    }
    return NextResponse.json({ 
      error: normalizedError.message || 'Internal server error',
    }, { status: 500 });
  }
}
