import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSettingsAccess } from '@/lib/server/admin-settings-access';
import {
  loadTimesheetModuleSettings,
  saveTimesheetModuleSettings,
} from '@/lib/server/timesheet-module-settings';

export async function GET() {
  const access = await requireAdminSettingsAccess();
  if (access.response) return access.response;

  try {
    return NextResponse.json({ success: true, ...(await loadTimesheetModuleSettings()) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load timesheet settings' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const access = await requireAdminSettingsAccess();
  if (access.response) return access.response;

  try {
    const body = (await request.json()) as { bankHolidaySelfOverrideEnabled?: unknown };
    if (typeof body.bankHolidaySelfOverrideEnabled !== 'boolean') {
      return NextResponse.json(
        { error: 'bankHolidaySelfOverrideEnabled is required' },
        { status: 400 }
      );
    }
    const settings = await saveTimesheetModuleSettings(
      body.bankHolidaySelfOverrideEnabled,
      access.userId
    );
    return NextResponse.json({ success: true, ...settings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save timesheet settings' },
      { status: 400 }
    );
  }
}
