import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logServerError } from '@/lib/utils/server-error-logger';
import type {
  GetAllNotificationPreferencesResponse,
  AdminUpdatePreferenceRequest,
  UpdateNotificationPreferenceResponse,
  NotificationModuleKey,
} from '@/types/notifications';

/**
 * GET /api/notification-preferences/admin
 * Fetch all users' notification preferences (superadmin only)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is super admin (using email check for consistency with debug page)
    if (user.email !== 'admin@mpdee.co.uk') {
      return NextResponse.json({ error: 'Forbidden: SuperAdmin access required' }, { status: 403 });
    }

    // Use admin client to bypass RLS for fetching all users and preferences
    const adminClient = createAdminClient();

    // Fetch all users with their preferences
    const { data: profiles, error: profilesError } = await adminClient
      .from('profiles')
      .select(`
        id,
        full_name,
        role:roles(name)
      `)
      .order('full_name');

    if (profilesError) {
      throw profilesError;
    }

    // Fetch all notification preferences
    const { data: allPrefs, error: prefsError } = await adminClient
      .from('notification_preferences')
      .select('*');

    if (prefsError) {
      throw prefsError;
    }

    // Build response with users and their preferences
    const users = (profiles || []).map(p => ({
      user_id: p.id,
      full_name: p.full_name,
      role_name: (p.role as any)?.name || 'unknown',
      preferences: (allPrefs || []).filter(pref => pref.user_id === p.id),
    }));

    const response: GetAllNotificationPreferencesResponse = {
      success: true,
      users,
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in GET /api/notification-preferences/admin:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/notification-preferences/admin',
      additionalData: { endpoint: '/api/notification-preferences/admin', method: 'GET' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * PUT /api/notification-preferences/admin
 * Update any user's notification preference (superadmin override)
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is super admin (using email check for consistency with debug page)
    if (user.email !== 'admin@mpdee.co.uk') {
      return NextResponse.json({ error: 'Forbidden: SuperAdmin access required' }, { status: 403 });
    }

    // Parse request body
    const body: AdminUpdatePreferenceRequest = await request.json();
    const { user_id, module_key, notify_in_app, notify_email } = body;

    if (!user_id || !module_key) {
      return NextResponse.json({ 
        error: 'Missing user_id or module_key' 
      }, { status: 400 });
    }

    const validModules: NotificationModuleKey[] = ['errors', 'maintenance', 'rams', 'approvals', 'inspections'];
    if (!validModules.includes(module_key)) {
      return NextResponse.json({ 
        error: 'Invalid module_key. Must be: errors, maintenance, rams, approvals, or inspections' 
      }, { status: 400 });
    }

    // Build upsert data
    const upsertData: any = {
      user_id,
      module_key,
    };

    if (notify_in_app !== undefined) upsertData.notify_in_app = notify_in_app;
    if (notify_email !== undefined) upsertData.notify_email = notify_email;

    // Use admin client to bypass RLS for upserting
    const adminClient = createAdminClient();
    
    // Upsert preference
    const { data: pref, error } = await adminClient
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
    console.error('Error in PUT /api/notification-preferences/admin:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/notification-preferences/admin',
      additionalData: { endpoint: '/api/notification-preferences/admin', method: 'PUT' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
