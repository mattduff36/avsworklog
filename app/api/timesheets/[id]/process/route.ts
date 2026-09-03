import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { canCurrentActorAuthoriseTimesheetTarget } from '@/lib/server/timesheet-approval-scope';
import {
  TimesheetGateConflictError,
  applyTimesheetManagerApproved,
} from '@/lib/server/timesheet-gate-mutations';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { TIMESHEET_PROCESS_STATUS_CONFLICT_CODE } from '@/lib/utils/timesheet-process';

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

    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole.user_id) {
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

    const canAuthoriseTarget = await canCurrentActorAuthoriseTimesheetTarget(
      {
        profileId: typedTarget.user_id,
        teamId: typedTarget.employee?.team_id || null,
      },
      { effectiveRole }
    );
    if (!canAuthoriseTarget) {
      return NextResponse.json(
        { error: 'You cannot process this employee’s timesheet' },
        { status: 403 }
      );
    }

    let expectedStatus = typedTarget.status;
    try {
      const body = (await request.json()) as { expected_status?: string };
      if (typeof body.expected_status === 'string' && body.expected_status.trim()) {
        expectedStatus = body.expected_status.trim();
      }
    } catch {
      // optional body
    }

    const result = await applyTimesheetManagerApproved({
      timesheetId,
      actorId: effectiveRole.user_id,
      expectedStatus,
    });
    return NextResponse.json({ success: true, alreadyProcessed: result.alreadyProcessed, status: result.status });
  } catch (error) {
    if (error instanceof TimesheetGateConflictError) {
      return NextResponse.json(
        {
          error: error.message,
          code: TIMESHEET_PROCESS_STATUS_CONFLICT_CODE,
          currentStatus: error.currentStatus,
        },
        { status: 409 }
      );
    }
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
