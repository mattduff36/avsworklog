import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import {
  countUnreadNotificationsForUser,
  listNotificationsForUser,
  normalizeNotificationError,
  parseNotificationLimit,
} from '@/lib/server/notifications';
import type { GetNotificationsResponse } from '@/types/messages';

/**
 * GET /api/messages/notifications
 * Fetch notification inbox for current user (last 60 days, not cleared)
 * Returns both Toolbox Talks and Reminders with their statuses
 */
export async function GET(request: NextRequest) {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await createClient();
    const userId = current.profile.id;
    const limit = parseNotificationLimit(request.nextUrl.searchParams.get('limit'));
    const [notifications, unread_count] = await Promise.all([
      listNotificationsForUser(supabase, userId, { limit }),
      countUnreadNotificationsForUser(supabase, userId),
    ]);

    const response: GetNotificationsResponse = {
      success: true,
      notifications,
      unread_count,
    };

    return NextResponse.json(response);

  } catch (error) {
    const normalizedError = normalizeNotificationError(error);
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

