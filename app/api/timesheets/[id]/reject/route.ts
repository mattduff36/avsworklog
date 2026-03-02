import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendTimesheetRejectionEmail } from '@/lib/utils/email';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    type DbClient = { from: (t: string) => ReturnType<typeof supabase.from> };
    const db = supabase as unknown as DbClient;
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

    // Verify user is a manager/admin
    const { data: profile } = await db
      .from('profiles')
      .select(`
        id,
        roles!inner(is_manager_admin)
      `)
      .eq('id', user.id)
      .single();

    const typedProfile = profile as { roles: { is_manager_admin: boolean } | null } | null;
    if (!typedProfile?.roles?.is_manager_admin) {
      return NextResponse.json(
        { error: 'Only managers and admins can reject timesheets' },
        { status: 403 }
      );
    }

    // Get timesheet details
    const { data: timesheet, error: timesheetError } = await db
      .from('timesheets')
      .select(`
        id,
        user_id,
        week_ending,
        status,
        profiles:user_id (
          id,
          full_name,
          email
        )
      `)
      .eq('id', timesheetId)
      .single();
    const typedTimesheet = timesheet as {
      id: string;
      user_id: string;
      week_ending: string;
      status: string;
      profiles: { id: string; full_name: string; email: string | null } | null;
    } | null;

    if (timesheetError || !typedTimesheet) {
      return NextResponse.json(
        { error: 'Timesheet not found' },
        { status: 404 }
      );
    }

    if (typedTimesheet.status !== 'submitted') {
      return NextResponse.json(
        { error: 'Only submitted timesheets can be rejected' },
        { status: 400 }
      );
    }

    // Update timesheet status
    const { error: updateError } = await db
      .from('timesheets')
      .update({
        status: 'rejected',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        manager_comments: comments.trim(),
      } as never)
      .eq('id', timesheetId);

    if (updateError) {
      console.error('Error updating timesheet:', updateError);
      throw updateError;
    }

    // Send email notification
    const employeeProfile = typedTimesheet.profiles as unknown as { full_name: string; email: string };
    if (employeeProfile?.email) {
      const emailResult = await sendTimesheetRejectionEmail({
        to: employeeProfile.email,
        employeeName: employeeProfile.full_name,
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

    // Create in-app notification
    const { data: message, error: messageInsertError } = await db
      .from('messages')
      .insert({
        title: 'Timesheet Rejected',
        content: `Your timesheet for week ending ${new Date(typedTimesheet.week_ending).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })} has been rejected.\n\nManager's Comments: ${comments.trim()}`,
        message_type: 'timesheet_rejection',
        created_by: user.id,
      } as never)
      .select('id')
      .single();
    let messageError = messageInsertError;
    const typedMessage = message as { id: string } | null;
    if (!messageError && typedMessage) {
      const { error: recipientError } = await db
        .from('message_recipients')
        .insert({
          message_id: typedMessage.id,
          recipient_id: typedTimesheet.user_id,
          read: false,
        } as never);
      messageError = recipientError;
    }

    if (messageError) {
      console.error('Failed to create in-app notification:', messageError);
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

