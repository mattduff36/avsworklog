import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { sendTimesheetRejectionEmail } from '@/lib/utils/email';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canCurrentActorAuthoriseTimesheetTarget } from '@/lib/server/timesheet-approval-scope';
import { getEffectiveRole } from '@/lib/utils/view-as';
import {
  TimesheetGateConflictError,
  applyTimesheetReject,
} from '@/lib/server/timesheet-gate-mutations';
import { TIMESHEET_GATE_STATUS_CONFLICT_CODE } from '@/lib/utils/timesheet-gates';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: timesheetId } = await params;
    const { comments } = await request.json();

    if (!comments || typeof comments !== 'string' || comments.trim().length === 0) {
      return NextResponse.json(
        { error: 'Rejection comments are required' },
        { status: 400 }
      );
    }

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get timesheet details
    const adminClient = createAdminClient();
    const { data: timesheet, error: timesheetError } = await adminClient
      .from('timesheets')
      .select(`
        id,
        user_id,
        week_ending,
        status,
        profiles:user_id (
          id,
          full_name
        ),
        employee:profiles!timesheets_user_id_fkey(team_id)
      `)
      .eq('id', timesheetId)
      .single();
    const typedTimesheet = timesheet as {
      id: string;
      user_id: string;
      week_ending: string;
      status: string;
      profiles: { id: string; full_name: string } | null;
      employee: { team_id?: string | null } | null;
    } | null;

    if (timesheetError || !typedTimesheet) {
      return NextResponse.json(
        { error: 'Timesheet not found' },
        { status: 404 }
      );
    }

    const canAuthoriseTarget = await canCurrentActorAuthoriseTimesheetTarget(
      {
        profileId: typedTimesheet.user_id,
        teamId: typedTimesheet.employee?.team_id || null,
      },
      { effectiveRole }
    );
    if (!canAuthoriseTarget) {
      return NextResponse.json(
        { error: 'You cannot reject this employee’s timesheet' },
        { status: 403 }
      );
    }

    try {
      await applyTimesheetReject({
        timesheetId,
        actorId: effectiveRole.user_id,
        comments: comments.trim(),
        expectedStatus: typedTimesheet.status,
      });
    } catch (error) {
      if (error instanceof TimesheetGateConflictError) {
        return NextResponse.json(
          {
            error: error.message,
            code: TIMESHEET_GATE_STATUS_CONFLICT_CODE,
            currentStatus: error.currentStatus,
          },
          { status: 409 }
        );
      }
      throw error;
    }

    // Email addresses live in auth.users, not public.profiles.
    const { data: employeeUserResult, error: employeeUserError } =
      await adminClient.auth.admin.getUserById(typedTimesheet.user_id);

    if (employeeUserError) {
      console.error('Error fetching employee email:', employeeUserError);
    }

    const employeeProfile = typedTimesheet.profiles as unknown as { full_name: string } | null;
    const employeeEmail = employeeUserResult.user?.email ?? null;

    if (employeeEmail) {
      const emailResult = await sendTimesheetRejectionEmail({
        to: employeeEmail,
        employeeName: employeeProfile?.full_name || 'Employee',
        weekEnding: new Date(typedTimesheet.week_ending).toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
        managerComments: comments.trim(),
      });

      if (!emailResult.success) {
        console.error('Failed to send rejection email:', emailResult.error);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Timesheet rejected and employee notified',
    });

  } catch (error) {
    console.error('Error rejecting timesheet:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/timesheets/[id]/reject',
      additionalData: {
        endpoint: '/api/timesheets/[id]/reject',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

