import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  canCurrentActorAuthoriseTimesheetTarget,
  canCurrentActorMarkTimesheetPayrollReceived,
} from '@/lib/server/timesheet-approval-scope';
import {
  TimesheetPayrollEditError,
  applyTimesheetPayrollEdit,
} from '@/lib/server/timesheet-payroll-edit';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { AdjustableTimesheetEntryInput } from '@/lib/server/timesheet-adjust';

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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as {
      reason?: unknown;
      idempotency_key?: unknown;
      expected_status?: unknown;
      expected_updated_at?: unknown;
      expected_snapshot_id?: unknown;
      client_pay_impact?: unknown;
      entries?: AdjustableTimesheetEntryInput[];
    };

    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : '';
    const expectedStatus = typeof body.expected_status === 'string' ? body.expected_status.trim() : '';
    const expectedUpdatedAt =
      typeof body.expected_updated_at === 'string' ? body.expected_updated_at.trim() : '';
    const expectedSnapshotIdRaw = body.expected_snapshot_id;
    let expectedSnapshotId: string | null;
    if (expectedSnapshotIdRaw === null) {
      expectedSnapshotId = null;
    } else if (typeof expectedSnapshotIdRaw === 'string' && UUID_PATTERN.test(expectedSnapshotIdRaw.trim())) {
      expectedSnapshotId = expectedSnapshotIdRaw.trim();
    } else {
      return NextResponse.json(
        { error: 'expected_snapshot_id must be a UUID or null' },
        { status: 400 }
      );
    }
    const clientPayImpact = body.client_pay_impact === true;
    const entries = Array.isArray(body.entries) ? body.entries : [];

    if (!reason) {
      return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
    }
    if (!UUID_PATTERN.test(idempotencyKey)) {
      return NextResponse.json({ error: 'A valid idempotency_key is required' }, { status: 400 });
    }
    if (!expectedStatus || !expectedUpdatedAt) {
      return NextResponse.json({ error: 'expected_status and expected_updated_at are required' }, { status: 400 });
    }

    const canMarkPayroll = await canCurrentActorMarkTimesheetPayrollReceived({ effectiveRole });
    if (!canMarkPayroll) {
      return NextResponse.json(
        { error: 'Only Accounts or Admin can edit a timesheet after submission' },
        { status: 403 }
      );
    }

    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin
      .from('timesheets')
      .select('id, user_id, employee:profiles!timesheets_user_id_fkey(team_id)')
      .eq('id', timesheetId)
      .maybeSingle();
    const typedTarget = target as unknown as {
      id: string;
      user_id: string;
      employee: { team_id?: string | null } | null;
    } | null;
    if (targetError || !typedTarget) {
      return NextResponse.json({ error: 'Timesheet not found' }, { status: 404 });
    }
    if (typedTarget.user_id === effectiveRole.user_id) {
      return NextResponse.json({ error: 'You cannot payroll-edit your own timesheet' }, { status: 403 });
    }

    const canAuthoriseTarget = await canCurrentActorAuthoriseTimesheetTarget(
      {
        profileId: typedTarget.user_id,
        teamId: typedTarget.employee?.team_id || null,
      },
      { effectiveRole }
    );
    if (!canAuthoriseTarget) {
      return NextResponse.json({ error: 'You cannot edit this employee’s timesheet' }, { status: 403 });
    }

    const result = await applyTimesheetPayrollEdit({
      timesheetId,
      actorId: effectiveRole.user_id,
      reason,
      idempotencyKey,
      expectedStatus,
      expectedUpdatedAt,
      expectedSnapshotId,
      clientPayImpact,
      entries,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof TimesheetPayrollEditError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to edit timesheet';
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/timesheets/[id]/payroll-edit',
      additionalData: { endpoint: '/api/timesheets/[id]/payroll-edit', timesheetId },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
