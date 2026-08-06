import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendTimesheetAdjustmentEmail } from '@/lib/utils/email';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { Database } from '@/types/database';
import { notifyProcessedAbsenceTimesheetAdjustment } from '@/lib/server/processed-absence-notifications';
import { canCurrentActorAuthoriseTimesheetTarget } from '@/lib/server/timesheet-approval-scope';
import {
  applyTimesheetAdjustmentMutation,
  type AdjustableTimesheetEntryInput,
} from '@/lib/server/timesheet-adjust';

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
    type DbClient = { from: (t: string) => ReturnType<typeof supabase.from> };
    const db = supabase as unknown as DbClient;
    const { id: timesheetId } = await params;
    const body = (await request.json()) as {
      comments?: unknown;
      notifyManagerIds?: unknown;
      entries?: AdjustableTimesheetEntryInput[];
    };
    const comments = body.comments;
    const notifyManagerIds = Array.isArray(body.notifyManagerIds)
      ? body.notifyManagerIds.filter((id): id is string => typeof id === 'string')
      : [];
    const entries = Array.isArray(body.entries) ? body.entries : null;

    if (!comments || typeof comments !== 'string' || comments.trim().length === 0) {
      return NextResponse.json(
        { error: 'Adjustment comments are required' },
        { status: 400 }
      );
    }

    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole.user_id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Authorize employee scope before any payroll mutation.
    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin
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
      .maybeSingle();

    const typedTimesheet = target as unknown as {
      id: string;
      user_id: string;
      week_ending: string;
      status: string;
      profiles: { id: string; full_name: string };
      employee: { team_id?: string | null } | null;
    } | null;

    if (targetError || !typedTimesheet) {
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
        { error: 'You cannot adjust this employee’s timesheet' },
        { status: 403 }
      );
    }

    if (typedTimesheet.status !== 'approved' && typedTimesheet.status !== 'adjusted') {
      return NextResponse.json(
        { error: 'Only approved or already-adjusted timesheets can be marked as adjusted' },
        { status: 400 }
      );
    }

    if (typedTimesheet.status === 'approved' && entries === null) {
      return NextResponse.json(
        { error: 'Entry payload is required when adjusting an approved timesheet' },
        { status: 400 }
      );
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('id', effectiveRole.user_id)
      .single();
    const typedProfile = profile as { id: string; full_name: string } | null;

    // Demote + rewrite entries in one DB transaction after auth/scope passed.
    await applyTimesheetAdjustmentMutation({
      timesheetId,
      actorId: effectiveRole.user_id,
      comments: comments.trim(),
      notifyManagerIds,
      entries,
    });

    const supabaseAdmin = getSupabaseAdmin();
    const { data: { user: employeeUser }, error: employeeUserError } = await supabaseAdmin.auth.admin.getUserById(typedTimesheet.user_id);
    if (employeeUserError) {
      console.error('Error fetching employee email:', employeeUserError);
    }
    const employeeEmail = employeeUser?.email || null;

    const employeeProfile = typedTimesheet.profiles;
    const weekEnding = new Date(typedTimesheet.week_ending).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

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

    if (notifyManagerIds.length > 0) {
      const { data: managers } = await db
        .from('profiles')
        .select('id, full_name')
        .in('id', notifyManagerIds);
      const typedManagers = (managers || []) as Array<{ id: string; full_name: string }>;

      if (typedManagers.length > 0) {
        for (const manager of typedManagers) {
          try {
            const { data: { user: managerUser }, error: managerUserError } = await supabaseAdmin.auth.admin.getUserById(manager.id);

            if (!managerUserError && managerUser?.email) {
              await sendTimesheetAdjustmentEmail({
                to: managerUser.email,
                recipientName: manager.full_name,
                employeeName: employeeProfile.full_name,
                weekEnding,
                adjustmentComments: comments.trim(),
                adjustedBy: typedProfile!.full_name,
              });
            } else {
              console.error(`Error fetching email for manager ${manager.id}:`, managerUserError);
            }
          } catch (err) {
            console.error(`Exception fetching email for manager ${manager.id}:`, err);
          }
        }
      }
    }

    const { data: employeeMessage } = await db
      .from('messages')
      .insert({
        type: 'NOTIFICATION',
        subject: 'Your Timesheet Has Been Adjusted',
        body: `Your timesheet for week ending ${new Date(typedTimesheet.week_ending).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })} has been adjusted by ${typedProfile!.full_name}.\n\nAdjustment Details: ${comments.trim()}`,
        priority: 'HIGH',
        sender_id: effectiveRole.user_id!,
        created_via: 'timesheet_adjustment',
        module_key: 'timesheets',
      } satisfies Database['public']['Tables']['messages']['Insert'])
      .select('id')
      .single();

    const typedEmployeeMessage = employeeMessage as unknown as { id: string } | null;

    if (typedEmployeeMessage) {
      await db
        .from('message_recipients')
        .insert({
          message_id: typedEmployeeMessage.id,
          user_id: typedTimesheet.user_id,
          status: 'PENDING' as const,
        });
    }

    if (notifyManagerIds.length > 0) {
      const { data: managerMessage } = await db
        .from('messages')
        .insert({
          type: 'NOTIFICATION',
          subject: 'Timesheet Adjusted',
          body: `A timesheet for ${employeeProfile.full_name} (week ending ${new Date(typedTimesheet.week_ending).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}) has been adjusted by ${typedProfile!.full_name}.\n\nAdjustment Details: ${comments.trim()}`,
          priority: 'HIGH',
          sender_id: effectiveRole.user_id!,
          created_via: 'timesheet_adjustment',
          module_key: 'timesheets',
        } satisfies Database['public']['Tables']['messages']['Insert'])
        .select('id')
        .single();

      const typedManagerMessage = managerMessage as unknown as { id: string } | null;

      if (typedManagerMessage) {
        const recipients = notifyManagerIds.map((recipientId: string) => ({
          message_id: typedManagerMessage.id,
          user_id: recipientId,
          status: 'PENDING' as const,
        }));

        await db
          .from('message_recipients')
          .insert(recipients);
      }
    }

    try {
      await notifyProcessedAbsenceTimesheetAdjustment(supabaseAdmin, {
        actorUserId: effectiveRole.user_id!,
        employeeProfileId: typedTimesheet.user_id,
        employeeName: employeeProfile.full_name,
        weekEnding: typedTimesheet.week_ending,
        adjustmentComments: comments.trim(),
      });
    } catch (notificationError) {
      console.error('Failed to notify Accounts about processed absence timesheet adjustment:', notificationError);
    }

    return NextResponse.json({
      success: true,
      message: 'Timesheet marked as adjusted and notifications sent',
    });

  } catch (error) {
    console.error('Error adjusting timesheet:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/timesheets/[id]/adjust',
      additionalData: {
        endpoint: '/api/timesheets/[id]/adjust',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
