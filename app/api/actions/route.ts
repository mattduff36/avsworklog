import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { mapReminderActionWithAsset } from '@/lib/server/reminders/generate-fleet-inspection-actions';

export async function GET(request: NextRequest) {
  try {
    const canManageActions = await canEffectiveRoleAccessModule('actions');
    if (!canManageActions) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const statusFilter = request.nextUrl.searchParams.get('status');
    const workflowKey = request.nextUrl.searchParams.get('workflow');
    const admin = createAdminClient();

    let query = admin
      .from('reminder_actions')
      .select(`
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
        updated_at,
        reminders (
          id,
          status
        )
      `)
      .order('last_detected_at', { ascending: false });

    if (statusFilter && statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    if (workflowKey) {
      query = query.eq('workflow_key', workflowKey);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      actions: (data || []).map((row) => mapReminderActionWithAsset(row)),
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/actions',
      additionalData: {
        endpoint: 'GET /api/actions',
      },
    });

    return NextResponse.json(
      { error: 'Failed to load actions' },
      { status: 500 },
    );
  }
}
