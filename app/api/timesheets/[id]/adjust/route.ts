import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { sendTimesheetAdjustmentEmail } from '@/lib/utils/email';
import type { Database } from '@/types/database';

function getSupabaseAdmin() {
  return createSupabaseAdmin<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: timesheetId } = await params;
    const { comments, notifyManagerIds } = await request.json();

    if (!comments || typeof comments !== 'string' || comments.trim().length === 0) {
      return NextResponse.json(
        { error: 'Adjustment comments are required' },
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
    const { data: profile } = await supabase
      .from('profiles')
      .select(`
        id,
        full_name,
        roles!inner(is_manager_admin)
      `)
      .eq('id', user.id)
      .single();

    const typedProfile = profile as unknown as { 
      id: string; 
      full_name: string; 
      roles: { is_manager_admin: boolean } 
    } | null;

    if (!typedProfile?.roles?.is_manager_admin) {
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
          full_name
        )
      `)
      .eq('id', timesheetId)
      .single();

    const typedTimesheet = timesheet as unknown as {
      id: string;
      user_id: string;
      week_ending: string;
      status: string;
      profiles: { id: string; full_name: string };
    } | null;

    if (timesheetError || !typedTimesheet) {
      return NextResponse.json(
        { error: 'Timesheet not found' },
        { status: 404 }
      );
    }

    // Get employee email from auth.users using admin client
    const supabaseAdmin = getSupabaseAdmin();
    const { data: { user: employeeUser }, error: employeeUserError } = await supabaseAdmin.auth.admin.getUserById(typedTimesheet.user_id);
    
    if (employeeUserError) {
      console.error('Error fetching employee email:', employeeUserError);
    }

    const employeeEmail = employeeUser?.email || null;

    if (typedTimesheet.status !== 'approved') {
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

    const employeeProfile = typedTimesheet.profiles;
    const weekEnding = new Date(typedTimesheet.week_ending).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    // Send email to employee
    if (employeeEmail) {
      const emailResult = await sendTimesheetAdjustmentEmail({
        to: employeeEmail,
        recipientName: employeeProfile.full_name,
        employeeName: employeeProfile.full_name,
        weekEnding,
        adjustmentComments: comments.trim(),
        adjustedBy: typedProfile!.full_name,
      });

      if (!emailResult.success) {
        console.error('Failed to send adjustment email to employee:', emailResult.error);
      }
    }

    // Send emails to selected managers
    if (notifyManagerIds && notifyManagerIds.length > 0) {
      const { data: managers } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', notifyManagerIds);

      if (managers) {
        // Get emails from auth.users for these managers
        const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
        const emailMap = new Map(
          usersData.users
            .filter((u) => notifyManagerIds.includes(u.id))
            .map((u) => [u.id, u.email])
        );

        for (const manager of managers) {
          const managerEmail = emailMap.get(manager.id);
          if (managerEmail) {
            await sendTimesheetAdjustmentEmail({
              to: managerEmail,
              recipientName: manager.full_name,
              employeeName: employeeProfile.full_name,
              weekEnding,
              adjustmentComments: comments.trim(),
              adjustedBy: typedProfile!.full_name,
            });
          }
        }
      }
    }

    // Create in-app notification for employee
    const { data: employeeMessage } = await supabase
      .from('messages')
      .insert({
        title: 'Your Timesheet Has Been Adjusted',
        content: `Your timesheet for week ending ${new Date(typedTimesheet.week_ending).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })} has been adjusted by ${typedProfile!.full_name}.\n\nAdjustment Details: ${comments.trim()}`,
        message_type: 'timesheet_adjustment',
        created_by: user.id,
      })
      .select('id')
      .single();

    const typedEmployeeMessage = employeeMessage as unknown as { id: string } | null;

    if (typedEmployeeMessage) {
      await supabase
        .from('message_recipients')
        .insert({
          message_id: typedEmployeeMessage.id,
          recipient_id: typedTimesheet.user_id,
          read: false,
        });
    }

    // Create in-app notifications for selected managers
    if (notifyManagerIds && notifyManagerIds.length > 0) {
      const { data: managerMessage } = await supabase
        .from('messages')
        .insert({
          title: 'Timesheet Adjusted',
          content: `A timesheet for ${employeeProfile.full_name} (week ending ${new Date(typedTimesheet.week_ending).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}) has been adjusted by ${typedProfile!.full_name}.\n\nAdjustment Details: ${comments.trim()}`,
          message_type: 'timesheet_adjustment',
          created_by: user.id,
        })
        .select('id')
        .single();

      const typedManagerMessage = managerMessage as unknown as { id: string } | null;

      if (typedManagerMessage) {
        const recipients = notifyManagerIds.map((recipientId: string) => ({
          message_id: typedManagerMessage.id,
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
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

