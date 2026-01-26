import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import type {
  GetNotificationPreferencesResponse,
  UpdateNotificationPreferenceRequest,
  UpdateNotificationPreferenceResponse,
  NotificationModuleKey,
} from '@/types/notifications';

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
    const { module_key, enabled, notify_in_app, notify_email } = body;

    const validModules: NotificationModuleKey[] = ['errors', 'maintenance', 'rams', 'approvals', 'inspections'];
    if (!module_key || !validModules.includes(module_key)) {
      return NextResponse.json({ 
        error: 'Invalid module_key. Must be: errors, maintenance, rams, approvals, or inspections' 
      }, { status: 400 });
    }

    // Build upsert data
    const upsertData: any = {
      user_id: user.id,
      module_key,
    };

    if (enabled !== undefined) upsertData.enabled = enabled;
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
