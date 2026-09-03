import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { approveTimesheetWithPayrollSnapshot } from '@/lib/server/timesheet-payroll';
import {
  canCurrentActorAuthoriseTimesheetTarget,
  canCurrentActorMarkTimesheetPayrollReceived,
} from '@/lib/server/timesheet-approval-scope';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      return NextResponse.json({ error: 'Approvals access required' }, { status: 403 });
    }

    let idempotencyKey = '';
    let expectedStatus: string | undefined;
    try {
      const body = (await request.json()) as { idempotency_key?: string; expected_status?: string };
      idempotencyKey = (body.idempotency_key || '').trim();
      expectedStatus = body.expected_status?.trim() || undefined;
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    if (!UUID_PATTERN.test(idempotencyKey)) {
      return NextResponse.json({ error: 'A valid idempotency_key is required' }, { status: 400 });
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

    const typedTarget = target as unknown as {
      id: string;
      user_id: string;
      employee: { team_id?: string | null } | null;
    };
    const canAuthoriseTarget = await canCurrentActorAuthoriseTimesheetTarget(
      {
        profileId: typedTarget.user_id,
        teamId: typedTarget.employee?.team_id || null,
      },
      { effectiveRole }
    );
    if (!canAuthoriseTarget) {
      return NextResponse.json({ error: 'You cannot approve this employee’s timesheet' }, { status: 403 });
    }

    const canMarkPayrollReceived = await canCurrentActorMarkTimesheetPayrollReceived({
      effectiveRole,
    });
    if (!canMarkPayrollReceived) {
      return NextResponse.json(
        { error: 'Only Accounts or Admin can mark a timesheet as Payroll Received' },
        { status: 403 }
      );
    }

    const result = await approveTimesheetWithPayrollSnapshot({
      timesheetId,
      actorId: effectiveRole.user_id,
      idempotencyKey,
      expectedStatus,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to approve timesheet';
    const expected = /not found|cannot be approved|cannot be marked Payroll Received|configuration|idempotency|status changed/i.test(message);
    if (!expected) {
      await logServerError({
        error: error as Error,
        request,
        componentName: '/api/timesheets/[id]/approve',
        additionalData: { endpoint: '/api/timesheets/[id]/approve', timesheetId },
      });
    }
    return NextResponse.json({ error: message }, { status: expected ? 409 : 500 });
  }
}
