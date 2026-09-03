import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { canCurrentActorAuthoriseTimesheetTarget } from '@/lib/server/timesheet-approval-scope';
import { getEffectiveRole } from '@/lib/utils/view-as';
import {
  applyApprovedAbsenceTimesheetEffects,
  removeAbsenceFromTimesheetRows,
  resolveAbsenceTimesheetImpacts,
} from '@/lib/utils/absence-timesheet-impact';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: absenceId } = await params;
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

    const body = (await request.json().catch(() => ({}))) as { action?: string };
    const action = body.action === 'remove' ? 'remove' : 'apply';

    const admin = createAdminClient();
    const { data: absence, error: absenceError } = await admin
      .from('absences')
      .select(`
        id,
        profile_id,
        date,
        end_date,
        reason_id,
        duration_days,
        is_half_day,
        half_day_session,
        status,
        notes,
        allow_timesheet_work_on_leave,
        absence_reasons (name, is_paid)
      `)
      .eq('id', absenceId)
      .maybeSingle();
    if (absenceError || !absence) {
      return NextResponse.json({ error: 'Absence not found' }, { status: 404 });
    }

    const typedAbsence = absence as unknown as {
      id: string;
      profile_id: string;
      date: string;
      end_date: string | null;
      reason_id: string;
      duration_days: number | null;
      is_half_day: boolean | null;
      half_day_session: 'AM' | 'PM' | null;
      status: string;
      notes: string | null;
      allow_timesheet_work_on_leave: boolean | null;
      absence_reasons: { name: string | null; is_paid: boolean | null } | null;
    };

    const { data: profile } = await admin
      .from('profiles')
      .select('team_id')
      .eq('id', typedAbsence.profile_id)
      .maybeSingle();

    const canAuthorise = await canCurrentActorAuthoriseTimesheetTarget(
      {
        profileId: typedAbsence.profile_id,
        teamId: profile?.team_id || null,
      },
      { effectiveRole }
    );
    if (!canAuthorise && typedAbsence.profile_id !== effectiveRole.user_id) {
      return NextResponse.json({ error: 'You cannot change this employee’s timesheet hours' }, { status: 403 });
    }

    const reason = {
      reasonName: typedAbsence.absence_reasons?.name || 'Leave',
      isPaid: Boolean(typedAbsence.absence_reasons?.is_paid),
    };

    if (action === 'remove') {
      const impacts = await resolveAbsenceTimesheetImpacts(admin, {
        profileId: typedAbsence.profile_id,
        startDate: typedAbsence.date,
        endDate: typedAbsence.end_date,
        isHalfDay: typedAbsence.is_half_day,
      });
      await removeAbsenceFromTimesheetRows(admin, {
        absenceId: typedAbsence.id,
        actorUserId: effectiveRole.user_id,
        profileId: typedAbsence.profile_id,
        startDate: typedAbsence.date,
        endDate: typedAbsence.end_date,
        isHalfDay: typedAbsence.is_half_day,
        halfDaySession: typedAbsence.half_day_session,
        allowTimesheetWorkOnLeave: typedAbsence.allow_timesheet_work_on_leave,
        impacts,
        ...reason,
      });
      return NextResponse.json({ success: true });
    }

    await applyApprovedAbsenceTimesheetEffects(admin, {
      absenceId: typedAbsence.id,
      actorUserId: effectiveRole.user_id,
      profileId: typedAbsence.profile_id,
      startDate: typedAbsence.date,
      endDate: typedAbsence.end_date,
      isHalfDay: typedAbsence.is_half_day,
      halfDaySession: typedAbsence.half_day_session,
      allowTimesheetWorkOnLeave: typedAbsence.allow_timesheet_work_on_leave,
      returnReason: 'Approved',
      ...reason,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update timesheet hours';
    const locked = /locked timesheets/i.test(message);
    if (!locked) {
      await logServerError({
        error: error as Error,
        request,
        componentName: '/api/absence/[id]/timesheet-effects',
        additionalData: { endpoint: '/api/absence/[id]/timesheet-effects', absenceId },
      });
    }
    return NextResponse.json({ error: message }, { status: locked ? 409 : 500 });
  }
}
