import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import type {
  GetNotificationPreferencesResponse,
  UpdateNotificationPreferenceRequest,
  UpdateNotificationPreferenceResponse,
  NotificationPreference,
} from '@/types/notifications';
import {
  NOTIFICATION_MODULES,
  NOTIFICATION_MODULE_KEYS,
  type NotificationModuleKey,
} from '@/types/notifications';
import { getProfileWithRole } from '@/lib/utils/permissions';

function canUseNotificationModule(
  moduleKey: NotificationModuleKey,
  profile: Awaited<ReturnType<typeof getProfileWithRole>>
): boolean {
  const notificationModule = NOTIFICATION_MODULES.find((entry) => entry.key === moduleKey);
  if (!notificationModule) return false;
  if (notificationModule.availableFor === 'all') return true;

  const role = profile?.role;
  const isAdmin = profile?.is_super_admin === true || role?.is_super_admin === true || role?.role_class === 'admin';
  const isManager = role?.is_manager_admin === true || role?.role_class === 'manager';

  if (notificationModule.availableFor === 'admin') return isAdmin;
  if (notificationModule.availableFor === 'manager') return isManager || isAdmin;
  return false;
}

/**
 * GET /api/notification-preferences
 * Fetch current user's notification preferences for all modules
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch user's preferences
    const { data: prefs, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .order('module_key');

    if (error) {
      throw error;
    }

    const response: GetNotificationPreferencesResponse = {
      success: true,
      preferences: prefs || [],
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in GET /api/notification-preferences:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/notification-preferences',
      additionalData: { endpoint: '/api/notification-preferences', method: 'GET' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * PUT /api/notification-preferences
 * Update or create current user's notification preference for a module
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body: UpdateNotificationPreferenceRequest = await request.json();
    const { module_key, notify_in_app, notify_email } = body;

    if (!module_key || !NOTIFICATION_MODULE_KEYS.includes(module_key)) {
      return NextResponse.json({ 
        error: `Invalid module_key. Must be one of: ${NOTIFICATION_MODULE_KEYS.join(', ')}`
      }, { status: 400 });
    }

    const profile = await getProfileWithRole(user.id);
    if (!canUseNotificationModule(module_key, profile)) {
      return NextResponse.json({ error: 'Forbidden for this notification module' }, { status: 403 });
    }

    // Build upsert data
    const upsertData: Partial<NotificationPreference> & {
      user_id: string;
      module_key: NotificationModuleKey;
    } = {
      user_id: user.id,
      module_key,
    };

    if (notify_in_app !== undefined) upsertData.notify_in_app = notify_in_app;
    if (notify_email !== undefined) upsertData.notify_email = notify_email;

    // Upsert preference
    const { data: pref, error } = await supabase
      .from('notification_preferences')
      .upsert(upsertData, { onConflict: 'user_id,module_key' })
      .select()
      .single();

    if (error) {
      throw error;
    }

    const response: UpdateNotificationPreferenceResponse = {
      success: true,
      preference: pref,
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in PUT /api/notification-preferences:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/notification-preferences',
      additionalData: { endpoint: '/api/notification-preferences', method: 'PUT' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
