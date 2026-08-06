import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { filterTimesheetRowsForReportScope } from '@/lib/server/reports-timesheet-scope';
import { canCurrentActorAuthoriseTimesheetTarget } from '@/lib/server/timesheet-approval-scope';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import type { PayrollSnapshotView } from '@/components/timesheets/PayrollSnapshotCard';

export async function GET(
  _request: NextRequest,
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
      .select('id, user_id, employee:profiles!timesheets_user_id_fkey(team_id)')
      .eq('id', timesheetId)
      .maybeSingle();
    if (targetError || !target) {
      return NextResponse.json({ error: 'Timesheet not found' }, { status: 404 });
    }

    const isOwner = target.user_id === user.id;
    if (!isOwner) {
      const typedTarget = target as {
        id: string;
        user_id: string;
        employee: { team_id?: string | null } | null;
      };
      const canAuthoriseTarget = await canCurrentActorAuthoriseTimesheetTarget({
        profileId: typedTarget.user_id,
        teamId: typedTarget.employee?.team_id || null,
      });

      if (!canAuthoriseTarget) {
        const canAccessTimesheets = await canEffectiveRoleAccessModule('timesheets');
        if (!canAccessTimesheets) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const scoped = await filterTimesheetRowsForReportScope([typedTarget]);
        if (scoped.length !== 1) {
          return NextResponse.json({ error: 'You cannot view this employee’s payroll data' }, { status: 403 });
        }
      }
    }

    const { data: current, error: currentError } = await admin
      .from('timesheets')
      .select(`
        current_payroll_snapshot:timesheet_payroll_snapshots!timesheets_current_payroll_snapshot_id_fkey(
          id,
          revision,
          approved_at,
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
      .eq('id', timesheetId)
      .maybeSingle();
    if (currentError) {
      return NextResponse.json({ error: currentError.message }, { status: 500 });
    }

    const { data: history, error: historyError } = await admin
      .from('timesheet_payroll_snapshots')
      .select(`
        id,
        revision,
        approved_at,
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
      `)
      .eq('timesheet_id', timesheetId)
      .order('revision', { ascending: false });
    if (historyError) {
      return NextResponse.json({ error: historyError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      current: ((current as { current_payroll_snapshot?: PayrollSnapshotView | null } | null)
        ?.current_payroll_snapshot) || null,
      history: (history || []) as PayrollSnapshotView[],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load payroll snapshots' },
      { status: 500 }
    );
  }
}
