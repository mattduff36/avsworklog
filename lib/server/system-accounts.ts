import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { isSystemAccountProfile, type SystemAccountCandidate } from '@/lib/utils/system-accounts';

type SystemAccountAdminClient = Pick<SupabaseClient<Database>, 'from'>;

export async function getSystemAccountIds(admin: SystemAccountAdminClient): Promise<Set<string>> {
  const ids = new Set<string>();

  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id')
    .eq('is_system_account', true);
  if (profilesError) {
    throw new Error(profilesError.message || 'Failed to load system account profiles');
  }
  for (const row of profiles || []) {
    if (row.id) ids.add(row.id);
  }

  const { data: kioskConfig, error: kioskError } = await admin
    .from('inventory_kiosk_config')
    .select('kiosk_user_id')
    .eq('id', 1)
    .maybeSingle();
  if (kioskError) {
    throw new Error(kioskError.message || 'Failed to load kiosk system account');
  }
  if (kioskConfig?.kiosk_user_id) {
    ids.add(kioskConfig.kiosk_user_id);
  }

  return ids;
}

export async function filterOperationalProfiles<T extends { id?: string | null }>(
  admin: SystemAccountAdminClient,
  rows: T[]
): Promise<T[]> {
  const systemIds = await getSystemAccountIds(admin);
  return rows.filter((row) => {
    if (isSystemAccountProfile(row as SystemAccountCandidate)) return false;
    if (row.id && systemIds.has(row.id)) return false;
    return true;
  });
}
