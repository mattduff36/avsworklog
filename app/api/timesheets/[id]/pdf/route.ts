import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderToStream } from '@react-pdf/renderer';
import { TimesheetPDF } from '@/lib/pdf/timesheet-pdf';
import { PlantTimesheetV2PDF } from '@/lib/pdf/plant-timesheet-v2-pdf';
import { shouldUsePlantTimesheetV2Template } from '@/lib/pdf/timesheet-template-selector';
import type { Timesheet } from '@/types/timesheet';
import { logServerError } from '@/lib/utils/server-error-logger';
import { filterTimesheetRowsForReportScope } from '@/lib/server/reports-timesheet-scope';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import {
  type ApprovedAbsenceForTimesheet,
  getTimesheetWeekIsoBounds,
  resolveTimesheetOffDayStates,
} from '@/lib/utils/timesheet-off-days';
import { loadEmployeeWorkShiftPatternMap } from '@/lib/server/work-shifts';
import type { PayrollSnapshotPdfData } from '@/lib/pdf/payroll-snapshot-summary';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    type DbClient = { from: (t: string) => ReturnType<typeof supabase.from> };
    const db = supabase as unknown as DbClient;
    const admin = createAdminClient() as unknown as DbClient;

    // Get the current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: target, error: targetError } = await db
      .from('timesheets')
      .select('id, user_id, week_ending, employee:profiles!timesheets_user_id_fkey(team_id)')
      .eq('id', id)
      .single();
    if (targetError || !target) {
      return NextResponse.json({ error: 'Timesheet not found' }, { status: 404 });
    }

    const targetRow = target as unknown as {
      id: string;
      user_id: string;
      week_ending: string;
      employee: { team_id?: string | null } | null;
    };
    const isOwner = targetRow.user_id === user.id;
    if (!isOwner) {
      const [canAccessTimesheets, canAccessApprovals] = await Promise.all([
        canEffectiveRoleAccessModule('timesheets'),
        canEffectiveRoleAccessModule('approvals'),
      ]);
      if (!canAccessTimesheets && !canAccessApprovals) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      }
      const scoped = await filterTimesheetRowsForReportScope([targetRow]);
      if (scoped.length !== 1) {
        return NextResponse.json({ error: 'You cannot view this employee’s timesheet' }, { status: 403 });
      }
    }

    // Snapshot RLS is owner/admin-only; scoped elevated reads use the service role
    // only after filterTimesheetRowsForReportScope (or owner auth) has passed.
    const { data: timesheet, error: timesheetError } = await admin
      .from('timesheets')
      .select(`
        *,
        entries:timesheet_entries(
          *,
          timesheet_entry_job_codes(job_number, display_order)
        ),
        current_payroll_snapshot:timesheet_payroll_snapshots!timesheets_current_payroll_snapshot_id_fkey(
          revision,
          basic_minutes,
          overtime_minutes,
          double_time_minutes,
          paid_leave_units,
          unpaid_leave_units,
          operator_travel_minutes,
          ipr_units,
          subsistence_days,
          subsistence_day_names,
          rule_set:payroll_rule_sets!timesheet_payroll_snapshots_rule_set_id_fkey(name)
        )
      `)
      .eq('id', id)
      .single();
    const typedTimesheet = timesheet as {
      user_id: string;
      entries?: unknown[];
      current_payroll_snapshot?: PayrollSnapshotPdfData | null;
    } & Record<string, unknown>;

    if (timesheetError || !timesheet) {
      return NextResponse.json({ error: 'Timesheet not found' }, { status: 404 });
    }

    if (!typedTimesheet.current_payroll_snapshot) {
      const { data: applicableRollout, error: rolloutError } = await admin
        .from('payroll_rollout_activations')
        .select('id')
        .lte('effective_week_ending', targetRow.week_ending)
        .limit(1);
      if (rolloutError) {
        return NextResponse.json({ error: 'Unable to verify payroll rollout configuration' }, { status: 500 });
      }
      if ((applicableRollout || []).length > 0) {
        return NextResponse.json(
          { error: 'This post-cutover timesheet has no payroll snapshot. PDF generation is blocked.' },
          { status: 409 }
        );
      }
    }

    // Get employee name from profiles table (full_name is the correct field)
    const { data: employee, error: employeeError } = await db
      .from('profiles')
      .select('full_name')
      .eq('id', typedTimesheet.user_id)
      .single();

    if (employeeError) {
      console.error('Error fetching employee details:', employeeError);
    }

    const employeeName = employee?.full_name || null;

    console.log('PDF Generation Debug:', {
      timesheetId: id,
      userId: typedTimesheet.user_id,
      employeeName,
      hasEmployee: !!employee,
      employeeError: employeeError?.message
    });

    const typedTimesheetData = typedTimesheet as unknown as Timesheet;
    const shouldUsePlantV2Template = shouldUsePlantTimesheetV2Template(typedTimesheetData);
    const { startIso, endIso } = getTimesheetWeekIsoBounds(typedTimesheetData.week_ending);
    const { data: absenceData, error: absenceError } = await db
      .from('absences')
      .select('id, date, end_date, status, is_half_day, half_day_session, allow_timesheet_work_on_leave, absence_reasons(name,color,is_paid)')
      .eq('profile_id', typedTimesheet.user_id)
      .in('status', ['pending', 'approved', 'processed'])
      .lte('date', endIso);

    if (absenceError) {
      console.warn('Failed to resolve leave state for PDF generation:', absenceError);
    }

    const approvedAbsences = ((absenceData || []) as ApprovedAbsenceForTimesheet[]).filter((row) => {
      const rowEnd = row.end_date || row.date;
      return row.date <= endIso && rowEnd >= startIso;
    });
    const shiftPatternMap = await loadEmployeeWorkShiftPatternMap(
      supabase,
      [typedTimesheet.user_id],
      { ensureRecords: false }
    );
    // Keep shift-aware leave overlays so paid-leave hours in daily_total are not
    // misread as worked hours. Payroll money totals still come only from the snapshot.
    const offDayStates = resolveTimesheetOffDayStates(
      typedTimesheetData.week_ending,
      approvedAbsences,
      shiftPatternMap.get(typedTimesheet.user_id) || null
    );

    // Generate PDF
    const stream = await renderToStream(
      shouldUsePlantV2Template
        ? PlantTimesheetV2PDF({
            timesheet: typedTimesheetData,
            employeeName: employeeName,
            offDayStates,
            payrollSnapshot: typedTimesheet.current_payroll_snapshot,
          })
        : TimesheetPDF({
            timesheet: typedTimesheetData,
            employeeName: employeeName,
            offDayStates,
            payrollSnapshot: typedTimesheet.current_payroll_snapshot,
          })
    );

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Return PDF
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="timesheet-${id}.pdf"`,
      },
    });
  } catch (error) {
    console.error('PDF generation error:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/timesheets/[id]/pdf',
      additionalData: {
        endpoint: '/api/timesheets/[id]/pdf',
      },
    });
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}

