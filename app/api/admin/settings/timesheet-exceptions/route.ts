import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSettingsAccess } from '@/lib/server/admin-settings-access';
import {
  addTimesheetTypeExceptionRow,
  getTimesheetTypeExceptionMatrix,
} from '@/lib/server/timesheet-type-exceptions';

export async function GET() {
  const access = await requireAdminSettingsAccess();
  if (access.response) return access.response;

  try {
    const matrix = await getTimesheetTypeExceptionMatrix();
    return NextResponse.json({ success: true, ...matrix });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load timesheet type exceptions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const access = await requireAdminSettingsAccess();
  if (access.response) return access.response;

  let profileId = '';
  try {
    const body = (await request.json()) as { profile_id?: string };
    profileId = (body.profile_id || '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!profileId) {
    return NextResponse.json({ error: 'profile_id is required' }, { status: 400 });
  }

  try {
    await addTimesheetTypeExceptionRow(profileId, access.userId);
    const matrix = await getTimesheetTypeExceptionMatrix();
    return NextResponse.json({ success: true, ...matrix });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add timesheet exception row' },
      { status: 500 }
    );
  }
}
