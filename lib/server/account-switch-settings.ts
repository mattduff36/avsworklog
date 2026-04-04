import { createAdminClient } from '@/lib/supabase/admin';

export interface AccountSwitchSettingsRow {
  profile_id: string;
  quick_switch_enabled: boolean;
  pin_hash: string | null;
  pin_failed_attempts: number;
  pin_locked_until: string | null;
  pin_last_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getAccountSwitchSettings(
  profileId: string
): Promise<AccountSwitchSettingsRow | null> {
  const supabaseAdmin = createAdminClient();
  const { data, error } = await supabaseAdmin
    .from('account_switch_settings')
    .select('*')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as AccountSwitchSettingsRow | null;
}

export async function ensureAccountSwitchSettings(
  profileId: string
): Promise<AccountSwitchSettingsRow> {
  const existing = await getAccountSwitchSettings(profileId);
  if (existing) return existing;

  const supabaseAdmin = createAdminClient();
  const { data, error } = await supabaseAdmin
    .from('account_switch_settings')
    .upsert(
      {
        profile_id: profileId,
      },
      {
        onConflict: 'profile_id',
      }
    )
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to create account switch settings');
  }

  return data as AccountSwitchSettingsRow;
}
