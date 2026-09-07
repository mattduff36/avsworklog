import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  canCurrentActorAuthoriseTimesheetTarget,
  canCurrentActorMarkTimesheetPayrollReceived,
} from '@/lib/server/timesheet-approval-scope';
import {
  TimesheetPayrollRecalculateError,
  applyTimesheetPayrollRecalculate,
} from '@/lib/server/timesheet-payroll-recalculate';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isIsoTimestamp(value: string): boolean {
  return ISO_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}
const ALLOWED_BODY_KEYS = new Set([
  'reason',
  'idempotency_key',
  'expected_status',
  'expected_updated_at',
  'expected_snapshot_id',
]);

function hasUnknownFields(body: Record<string, unknown>): boolean {
  return Object.keys(body).some((key) => !ALLOWED_BODY_KEYS.has(key));
}

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
    if (effectiveRole.is_viewing_as) {
      return NextResponse.json(
        { error: 'Payroll snapshots cannot be recalculated while viewing as another role' },
        { status: 403 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || hasUnknownFields(body)) {
      return NextResponse.json({ error: 'Unexpected request fields' }, { status: 400 });
    }

    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : '';
    const expectedStatus = typeof body.expected_status === 'string' ? body.expected_status.trim() : '';
    const expectedUpdatedAt =
      typeof body.expected_updated_at === 'string' ? body.expected_updated_at.trim() : '';
    const expectedSnapshotId =
      typeof body.expected_snapshot_id === 'string' ? body.expected_snapshot_id.trim() : '';

    if (!reason) {
      return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
    }
    if (!UUID_PATTERN.test(idempotencyKey)) {
      return NextResponse.json({ error: 'A valid idempotency_key is required' }, { status: 400 });
    }
    if (expectedStatus !== 'approved' && expectedStatus !== 'processed') {
      return NextResponse.json(
        { error: 'Only Payroll Received or Complete timesheets can be recalculated.' },
        { status: 400 }
      );
    }
    if (!expectedUpdatedAt || !isIsoTimestamp(expectedUpdatedAt)) {
      return NextResponse.json(
        { error: 'expected_updated_at must be an ISO-8601 timestamp' },
        { status: 400 }
      );
    }
    if (!UUID_PATTERN.test(expectedSnapshotId)) {
      return NextResponse.json({ error: 'expected_snapshot_id must be a UUID' }, { status: 400 });
    }

    const canMarkPayroll = await canCurrentActorMarkTimesheetPayrollReceived({ effectiveRole });
    if (!canMarkPayroll) {
      return NextResponse.json(
        { error: 'Only Accounts or Admin can recalculate a payroll snapshot' },
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
      return NextResponse.json({ error: 'You cannot recalculate your own timesheet' }, { status: 403 });
    }

    const canAuthoriseTarget = await canCurrentActorAuthoriseTimesheetTarget(
      {
        profileId: typedTarget.user_id,
        teamId: typedTarget.employee?.team_id || null,
      },
      { effectiveRole }
    );
    if (!canAuthoriseTarget) {
      return NextResponse.json({ error: 'You cannot recalculate this employee’s timesheet' }, { status: 403 });
    }

    const result = await applyTimesheetPayrollRecalculate({
      timesheetId,
      actorId: effectiveRole.user_id,
      reason,
      idempotencyKey,
      expectedStatus,
      expectedUpdatedAt,
      expectedSnapshotId,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof TimesheetPayrollRecalculateError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to recalculate payroll';
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/timesheets/[id]/payroll-recalculate',
      additionalData: { endpoint: '/api/timesheets/[id]/payroll-recalculate', timesheetId },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
