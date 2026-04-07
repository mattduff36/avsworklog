import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import {
  countUnreadNotificationsForUser,
  normalizeNotificationError,
} from '@/lib/server/notifications';

export async function GET() {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await createClient();
    const unread_count = await countUnreadNotificationsForUser(supabase, current.profile.id);

    return NextResponse.json({
      success: true,
      unread_count,
    });
  } catch (error) {
    const normalizedError = normalizeNotificationError(error);
    console.error('Error in GET /api/messages/notifications/count:', normalizedError);

    try {
      await logServerError({
        error: normalizedError,
        componentName: '/api/messages/notifications/count',
        additionalData: {
          endpoint: '/api/messages/notifications/count',
        },
      });
    } catch (logError) {
      console.error('Failed to log server error for /api/messages/notifications/count:', logError);
    }

    return NextResponse.json(
      { error: normalizedError.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
