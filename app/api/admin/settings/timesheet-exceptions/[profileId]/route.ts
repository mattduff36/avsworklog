import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSettingsAccess } from '@/lib/server/admin-settings-access';
import {
  deleteTimesheetTypeExceptionRow,
  getTimesheetTypeExceptionMatrix,
  upsertTimesheetTypeException,
} from '@/lib/server/timesheet-type-exceptions';
import {
  normalizeTimesheetExceptionOverrideType,
  type TimesheetExceptionOverrideType,
} from '@/types/timesheet-type-exceptions';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const access = await requireAdminSettingsAccess();
  if (access.response) return access.response;

  const { profileId } = await params;
  if (!profileId) {
    return NextResponse.json({ error: 'profileId is required' }, { status: 400 });
  }

  let nextTimesheetType: TimesheetExceptionOverrideType | null;
  try {
    const body = (await request.json()) as { timesheet_type?: unknown };
    if (!Object.prototype.hasOwnProperty.call(body, 'timesheet_type')) {
      return NextResponse.json({ error: 'timesheet_type is required' }, { status: 400 });
    }
    if (body.timesheet_type === null) {
      nextTimesheetType = null;
    } else {
      nextTimesheetType = normalizeTimesheetExceptionOverrideType(body.timesheet_type);
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
      actor_id: access.userId,
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
  const access = await requireAdminSettingsAccess();
  if (access.response) return access.response;

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
