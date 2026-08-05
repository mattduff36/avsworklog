import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { previewTimesheetPayroll } from '@/lib/server/timesheet-payroll';
import { filterTimesheetRowsForReportScope } from '@/lib/server/reports-timesheet-scope';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import type { PayrollDayInput } from '@/lib/payroll/types';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = (await request.json()) as {
      userId?: string;
      weekEnding?: string;
      days?: PayrollDayInput[];
    };
    if (!body.userId || !body.weekEnding || !Array.isArray(body.days)) {
      return NextResponse.json({ error: 'Employee, week and day inputs are required' }, { status: 400 });
    }

    if (body.userId !== user.id) {
      const canApprove = await canEffectiveRoleAccessModule('approvals');
      if (!canApprove) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const admin = createAdminClient();
      const { data: profile } = await admin
        .from('profiles')
        .select('id, team_id')
        .eq('id', body.userId)
        .maybeSingle();
      if (!profile) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
      const scoped = await filterTimesheetRowsForReportScope([{
        user_id: profile.id,
        employee: { team_id: profile.team_id },
      }]);
      if (scoped.length !== 1) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      ...(await previewTimesheetPayroll({
        userId: body.userId,
        weekEnding: body.weekEnding,
        days: body.days,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Payroll preview failed' },
      { status: 409 }
    );
  }
}
