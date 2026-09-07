import { createAdminClient } from '@/lib/supabase/admin';

export interface TimesheetModuleSettings {
  bankHolidaySelfOverrideEnabled: boolean;
}

const DEFAULT_SETTINGS: TimesheetModuleSettings = {
  bankHolidaySelfOverrideEnabled: true,
};

export async function loadTimesheetModuleSettings(): Promise<TimesheetModuleSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('timesheet_module_settings')
    .select('bank_holiday_self_override_enabled')
    .eq('id', true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return DEFAULT_SETTINGS;

  return {
    bankHolidaySelfOverrideEnabled: data.bank_holiday_self_override_enabled !== false,
  };
}

export async function saveTimesheetModuleSettings(
  enabled: boolean,
  actorUserId: string
): Promise<TimesheetModuleSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('timesheet_module_settings')
    .upsert({
      id: true,
      bank_holiday_self_override_enabled: enabled,
      updated_by: actorUserId,
    })
    .select('bank_holiday_self_override_enabled')
    .single();

  if (error) throw error;

  return {
    bankHolidaySelfOverrideEnabled: data.bank_holiday_self_override_enabled !== false,
  };
}
