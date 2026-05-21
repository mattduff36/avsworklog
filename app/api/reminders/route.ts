import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { mapReminderActionWithAsset } from '@/lib/server/reminders/generate-fleet-inspection-actions';

export async function GET(request: NextRequest) {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canViewReminders = await canEffectiveRoleAccessModule('reminders');
    if (!canViewReminders) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const statusFilter = request.nextUrl.searchParams.get('status') || 'pending';
    const admin = createAdminClient();

    let query = admin
      .from('reminders')
      .select(`
        id,
        action_id,
        assigned_to,
        assigned_by,
        status,
        action_note,
        actioned_at,
        actioned_by,
        cancelled_at,
        created_at,
        updated_at,
        action:reminder_actions (
          id,
          workflow_key,
          source_type,
          dedupe_key,
          status,
          priority,
          title,
          description,
          asset_type,
          van_id,
          plant_id,
          hgv_id,
          metadata,
          created_by,
          resolved_by,
          first_detected_at,
          last_detected_at,
          resolved_at,
          created_at,
          updated_at
        )
      `)
      .eq('assigned_to', current.profile.id)
      .order('created_at', { ascending: false });

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const reminders = (data || []).flatMap((row) => {
      const actionRow = Array.isArray(row.action) ? row.action[0] : row.action;
      if (!actionRow) {
        return [];
      }

      return [{
        ...row,
        action: mapReminderActionWithAsset({
          ...actionRow,
          reminders: [],
        }),
      }];
    });

    return NextResponse.json({
      success: true,
      reminders,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reminders',
      additionalData: {
        endpoint: 'GET /api/reminders',
      },
    });

    return NextResponse.json(
      { error: 'Failed to load reminders' },
      { status: 500 },
    );
  }
}
