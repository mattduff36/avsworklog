import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendTimesheetAdjustmentEmail } from '@/lib/utils/email';
import { validateRequest, validateParams, IdParamsSchema, TimesheetAdjustSchema } from '@/lib/validation/schemas';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    
    // Validate params
    const paramsResult = validateParams(await params, IdParamsSchema);
    if (!paramsResult.success) {
      return NextResponse.json(
        { success: false, error: paramsResult.error },
        { status: 400 }
      );
    }
    const { id: timesheetId } = paramsResult.data;

    // Validate request body
    const bodyResult = await validateRequest(request, TimesheetAdjustSchema);
    if (!bodyResult.success) {
      return NextResponse.json(
        { success: false, error: bodyResult.error },
        { status: 400 }
      );
    }
    const { comments, notifyManagerIds } = bodyResult.data;

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Verify user is a manager/admin
    const { data: profile } = await supabase
      .from('profiles')
      .select(`
        id,
        full_name,
        roles!inner(is_manager_admin)
      `)
      .eq('id', user.id)
      .single();

    if (!profile?.roles?.is_manager_admin) {
      return NextResponse.json(
        { error: 'Only managers and admins can adjust timesheets' },
        { status: 403 }
      );
    }

    // Get timesheet details
    const { data: timesheet, error: timesheetError } = await supabase
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

    if (timesheetError || !timesheet) {
      return NextResponse.json(
        { error: 'Timesheet not found' },
        { status: 404 }
      );
    }

    if (timesheet.status !== 'approved') {
      return NextResponse.json(
        { error: 'Only approved timesheets can be marked as adjusted' },
        { status: 400 }
      );
    }

    // Update timesheet status
    const { error: updateError } = await supabase
      .from('timesheets')
      .update({
        status: 'adjusted',
        adjusted_by: user.id,
        adjusted_at: new Date().toISOString(),
        adjustment_recipients: notifyManagerIds || [],
        manager_comments: comments.trim(),
      })
      .eq('id', timesheetId);

    if (updateError) {
      console.error('Error updating timesheet:', updateError);
      throw updateError;
    }

    const employeeProfile = timesheet.profiles as unknown as { id: string; full_name: string; email: string };
    const weekEnding = new Date(timesheet.week_ending).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    // Send email to employee
    if (employeeProfile?.email) {
      const emailResult = await sendTimesheetAdjustmentEmail({
        to: employeeProfile.email,
        recipientName: employeeProfile.full_name,
        employeeName: employeeProfile.full_name,
        weekEnding,
        adjustmentComments: comments.trim(),
        adjustedBy: profile.full_name,
      });

      if (!emailResult.success) {
        console.error('Failed to send adjustment email to employee:', emailResult.error);
      }
    }

    // Send emails to selected managers
    if (notifyManagerIds && notifyManagerIds.length > 0) {
      const { data: managers } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', notifyManagerIds);

      if (managers) {
        for (const manager of managers) {
          if (manager.email) {
            await sendTimesheetAdjustmentEmail({
              to: manager.email,
              recipientName: manager.full_name,
              employeeName: employeeProfile.full_name,
              weekEnding,
              adjustmentComments: comments.trim(),
              adjustedBy: profile.full_name,
            });
          }
        }
      }
    }

    // Create in-app notification for employee
    const { data: employeeMessage } = await supabase
      .from('messages')
      .insert({
        title: '📝 Your Timesheet Has Been Adjusted',
        content: `Your timesheet for week ending ${new Date(timesheet.week_ending).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })} has been adjusted by ${profile.full_name}.\n\nAdjustment Details: ${comments.trim()}`,
        message_type: 'timesheet_adjustment',
        created_by: user.id,
      })
      .select('id')
      .single();

    if (employeeMessage) {
      await supabase
        .from('message_recipients')
        .insert({
          message_id: employeeMessage.id,
          recipient_id: timesheet.user_id,
          read: false,
        });
    }

    // Create in-app notifications for selected managers
    if (notifyManagerIds && notifyManagerIds.length > 0) {
      const { data: managerMessage } = await supabase
        .from('messages')
        .insert({
          title: '📝 Timesheet Adjusted',
          content: `A timesheet for ${employeeProfile.full_name} (week ending ${new Date(timesheet.week_ending).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}) has been adjusted by ${profile.full_name}.\n\nAdjustment Details: ${comments.trim()}`,
          message_type: 'timesheet_adjustment',
          created_by: user.id,
        })
        .select('id')
        .single();

      if (managerMessage) {
        const recipients = notifyManagerIds.map((recipientId: string) => ({
          message_id: managerMessage.id,
          recipient_id: recipientId,
          read: false,
        }));

        await supabase
          .from('message_recipients')
          .insert(recipients);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Timesheet marked as adjusted and notifications sent',
    });

  } catch (error) {
    console.error('Error adjusting timesheet:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

