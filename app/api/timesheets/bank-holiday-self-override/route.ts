import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { isMissingTimesheetModuleSettingsError } from '@/lib/utils/timesheet-bank-holiday-work';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const canAccessTimesheets = await canEffectiveRoleAccessModule('timesheets');
  if (!canAccessTimesheets) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error: settingsError } = await supabase
    .from('timesheet_module_settings')
    .select('bank_holiday_self_override_enabled')
    .eq('id', true)
    .maybeSingle();

  if (settingsError) {
    if (isMissingTimesheetModuleSettingsError(settingsError)) {
      return NextResponse.json({
        success: true,
        bankHolidaySelfOverrideEnabled: false,
      });
    }
    return NextResponse.json({ error: 'Failed to load timesheet settings' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    bankHolidaySelfOverrideEnabled: data?.bank_holiday_self_override_enabled !== false,
  });
}
