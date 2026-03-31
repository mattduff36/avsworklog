import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import {
  deleteTimesheetTypeExceptionRow,
  getTimesheetTypeExceptionMatrix,
  upsertTimesheetTypeException,
} from '@/lib/server/timesheet-type-exceptions';
import { normalizeTimesheetExceptionType } from '@/types/timesheet-type-exceptions';

function isActorAdmin(effectiveRole: {
  is_actual_super_admin: boolean;
  is_super_admin: boolean;
  role_name: string | null;
}): boolean {
  return effectiveRole.is_actual_super_admin || effectiveRole.is_super_admin || effectiveRole.role_name === 'admin';
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const canAccessSettings = await canEffectiveRoleAccessModule('admin-settings');
  const effectiveRole = await getEffectiveRole();
  if (!canAccessSettings || !isActorAdmin(effectiveRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { profileId } = await params;
  if (!profileId) {
    return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
  }

  let nextTimesheetType: 'civils' | 'plant' | null;
  try {
    const body = (await request.json()) as { timesheet_type?: unknown };
    if (!Object.prototype.hasOwnProperty.call(body, 'timesheet_type')) {
      return NextResponse.json({ error: 'timesheet_type is required' }, { status: 400 });
    }
    if (body.timesheet_type === null) {
      nextTimesheetType = null;
    } else {
      nextTimesheetType = normalizeTimesheetExceptionType(body.timesheet_type);
      if (nextTimesheetType === null) {
        return NextResponse.json({ error: 'Invalid timesheet_type value' }, { status: 400 });
      }
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    await upsertTimesheetTypeException({
      profile_id: profileId,
      timesheet_type: nextTimesheetType,
      actor_id: user.id,
    });
    const matrix = await getTimesheetTypeExceptionMatrix();
    return NextResponse.json({ success: true, ...matrix });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update timesheet exception row' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const canAccessSettings = await canEffectiveRoleAccessModule('admin-settings');
  const effectiveRole = await getEffectiveRole();
  if (!canAccessSettings || !isActorAdmin(effectiveRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { profileId } = await params;
  if (!profileId) {
    return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
  }

  try {
    await deleteTimesheetTypeExceptionRow(profileId);
    const matrix = await getTimesheetTypeExceptionMatrix();
    return NextResponse.json({ success: true, ...matrix });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete timesheet exception row' },
      { status: 500 }
    );
  }
}
