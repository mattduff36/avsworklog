import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { isDeletedUserName } from '@/lib/users/deleted-user';
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

export async function getDeletedUserIds(admin: SystemAccountAdminClient): Promise<Set<string>> {
  const ids = new Set<string>();
  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id, full_name')
    .ilike('full_name', '%(Deleted User)%');
  if (error) {
    throw new Error(error.message || 'Failed to load deleted user profiles');
  }
  for (const row of profiles || []) {
    if (row.id && isDeletedUserName(row.full_name)) {
      ids.add(row.id);
    }
  }
  return ids;
}

export async function getReportHiddenProfileIds(admin: SystemAccountAdminClient): Promise<Set<string>> {
  const [systemIds, deletedIds] = await Promise.all([
    getSystemAccountIds(admin),
    getDeletedUserIds(admin),
  ]);
  const hidden = new Set(systemIds);
  for (const id of deletedIds) hidden.add(id);
  return hidden;
}

export function isHiddenReportSubject(
  profileId: string | null | undefined,
  employee: { full_name?: string | null; is_system_account?: boolean | null } | null | undefined,
  hiddenProfileIds: Set<string>
): boolean {
  if (!profileId || hiddenProfileIds.has(profileId)) return true;
  if (isSystemAccountProfile(employee || {})) return true;
  return isDeletedUserName(employee?.full_name);
}

export function filterHiddenReportSubjects<T extends {
  profile_id?: string | null;
  user_id?: string | null;
  employee?: { full_name?: string | null; is_system_account?: boolean | null } | null;
  inspector?: { full_name?: string | null; is_system_account?: boolean | null } | null;
}>(
  rows: T[],
  hiddenProfileIds: Set<string>,
  getProfileId: (row: T) => string | null | undefined = (row) => row.profile_id ?? row.user_id
): T[] {
  return rows.filter((row) => {
    const employee = row.employee ?? row.inspector ?? null;
    return !isHiddenReportSubject(getProfileId(row), employee, hiddenProfileIds);
  });
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
