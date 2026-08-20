import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { canCurrentActorAuthoriseTimesheetTarget } from '@/lib/server/timesheet-approval-scope';
import { logServerError } from '@/lib/utils/server-error-logger';
import {
  TIMESHEET_PROCESS_STATUS_CONFLICT_CODE,
  resolveTimesheetProcessAction,
} from '@/lib/utils/timesheet-process';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: timesheetId } = await params;

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin
      .from('timesheets')
      .select('id, user_id, status, employee:profiles!timesheets_user_id_fkey(team_id)')
      .eq('id', timesheetId)
      .maybeSingle();
    const typedTarget = target as unknown as {
      id: string;
      user_id: string;
      status: string;
      employee: { team_id?: string | null } | null;
    } | null;

    if (targetError || !typedTarget) {
      return NextResponse.json({ error: 'Timesheet not found' }, { status: 404 });
    }

    const canAuthoriseTarget = await canCurrentActorAuthoriseTimesheetTarget({
      profileId: typedTarget.user_id,
      teamId: typedTarget.employee?.team_id || null,
    });
    if (!canAuthoriseTarget) {
      return NextResponse.json(
        { error: 'You cannot process this employee’s timesheet' },
        { status: 403 }
      );
    }

    const processDecision = resolveTimesheetProcessAction(typedTarget.status);
    if (processDecision.type === 'already_processed') {
      return NextResponse.json({ success: true, alreadyProcessed: true });
    }
    if (processDecision.type === 'conflict') {
      return NextResponse.json(
        {
          error: processDecision.message,
          code: TIMESHEET_PROCESS_STATUS_CONFLICT_CODE,
          currentStatus: typedTarget.status,
        },
        { status: 409 }
      );
    }

    const { data: updated, error: updateError } = await admin
      .from('timesheets')
      .update({
        status: 'processed',
        processed_at: new Date().toISOString(),
      })
      .eq('id', timesheetId)
      .eq('status', 'approved')
      .select('id')
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }
    if (!updated) {
      const { data: latest } = await admin
        .from('timesheets')
        .select('status')
        .eq('id', timesheetId)
        .maybeSingle();
      if (latest?.status === 'processed') {
        return NextResponse.json({ success: true, alreadyProcessed: true });
      }
      return NextResponse.json(
        {
          error: 'Timesheet status changed before it could be processed',
          code: TIMESHEET_PROCESS_STATUS_CONFLICT_CODE,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/timesheets/[id]/process',
      additionalData: {
        endpoint: '/api/timesheets/[id]/process',
        timesheetId,
      },
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process timesheet' },
      { status: 500 }
    );
  }
}
