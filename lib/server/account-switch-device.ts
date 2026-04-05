import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';

const DEVICE_ID_MIN_LENGTH = 16;
const DEVICE_ID_MAX_LENGTH = 200;

export interface AccountSwitchDeviceRow {
  id: string;
  profile_id: string;
  device_id_hash: string;
  device_label: string | null;
  trusted_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountSwitchDeviceCredentialRow {
  profile_id: string;
  device_id: string;
  pin_hash: string;
  pin_failed_attempts: number;
  pin_locked_until: string | null;
  pin_last_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountSwitchDeviceProfileSummary {
  device_id: string;
  profile_id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  role_name: string | null;
  last_authenticated_at: string | null;
  last_locked_at: string | null;
  pin_last_changed_at: string | null;
  pin_failed_attempts: number;
  pin_locked_until: string | null;
}

interface AccountSwitchDeviceListRow {
  id: string;
  profile_id: string;
  last_authenticated_at?: string | null;
  last_locked_at?: string | null;
}

interface AccountSwitchProfileRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  role_id?: string | null;
}

interface AccountSwitchRoleRow {
  id: string;
  name: string | null;
}

export function normalizeAccountSwitchDeviceId(rawDeviceId: string): string {
  const trimmed = rawDeviceId.trim();
  if (trimmed.length < DEVICE_ID_MIN_LENGTH || trimmed.length > DEVICE_ID_MAX_LENGTH) {
    throw new Error('Invalid device identifier');
  }
  return trimmed;
}

export function parseAccountSwitchDeviceId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  try {
    return normalizeAccountSwitchDeviceId(input);
  } catch {
    return null;
  }
}

export function hashAccountSwitchDeviceId(rawDeviceId: string): string {
  const normalized = normalizeAccountSwitchDeviceId(rawDeviceId);
  const pepper = process.env.ACCOUNT_SWITCH_DEVICE_PEPPER || 'account-switch-device-pepper-v1';
  return createHash('sha256').update(`${pepper}:${normalized}`).digest('hex');
}

export async function getAccountSwitchDevice(
  profileId: string,
  rawDeviceId: string
): Promise<AccountSwitchDeviceRow | null> {
  const supabaseAdmin = createAdminClient();
  const deviceIdHash = hashAccountSwitchDeviceId(rawDeviceId);
  const { data, error } = await supabaseAdmin
    .from('account_switch_devices')
    .select('*')
    .eq('profile_id', profileId)
    .eq('device_id_hash', deviceIdHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as AccountSwitchDeviceRow | null;
}

export async function upsertAccountSwitchDevice({
  profileId,
  rawDeviceId,
  deviceLabel,
}: {
  profileId: string;
  rawDeviceId: string;
  deviceLabel?: string | null;
}): Promise<AccountSwitchDeviceRow> {
  const supabaseAdmin = createAdminClient();
  const nowIso = new Date().toISOString();
  const deviceIdHash = hashAccountSwitchDeviceId(rawDeviceId);

  const { data, error } = await supabaseAdmin
    .from('account_switch_devices')
    .upsert(
      {
        profile_id: profileId,
        device_id_hash: deviceIdHash,
        device_label: deviceLabel || null,
        trusted_at: nowIso,
        last_seen_at: nowIso,
        revoked_at: null,
      },
      {
        onConflict: 'profile_id,device_id_hash',
      }
    )
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to register account switch device');
  }

  return data as AccountSwitchDeviceRow;
}

export async function getAccountSwitchDeviceCredential({
  profileId,
  rawDeviceId,
}: {
  profileId: string;
  rawDeviceId: string;
}): Promise<{ device: AccountSwitchDeviceRow; credential: AccountSwitchDeviceCredentialRow | null } | null> {
  const device = await getAccountSwitchDevice(profileId, rawDeviceId);
  if (!device) return null;

  const supabaseAdmin = createAdminClient();
  const { data, error } = await supabaseAdmin
    .from('account_switch_device_credentials')
    .select('*')
    .eq('profile_id', profileId)
    .eq('device_id', device.id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return {
    device,
    credential: (data as AccountSwitchDeviceCredentialRow | null) || null,
  };
}

export async function upsertAccountSwitchDeviceCredential({
  profileId,
  rawDeviceId,
  pinHash,
}: {
  profileId: string;
  rawDeviceId: string;
  pinHash: string;
}): Promise<AccountSwitchDeviceCredentialRow> {
  const device = await upsertAccountSwitchDevice({
    profileId,
    rawDeviceId,
  });

  const supabaseAdmin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('account_switch_device_credentials')
    .upsert(
      {
        profile_id: profileId,
        device_id: device.id,
        pin_hash: pinHash,
        pin_failed_attempts: 0,
        pin_locked_until: null,
        pin_last_changed_at: nowIso,
      },
      {
        onConflict: 'profile_id,device_id',
      }
    )
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to save device PIN credential');
  }

  return data as AccountSwitchDeviceCredentialRow;
}

export async function updateAccountSwitchDeviceCredentialState({
  profileId,
  rawDeviceId,
  pinFailedAttempts,
  pinLockedUntil,
}: {
  profileId: string;
  rawDeviceId: string;
  pinFailedAttempts: number;
  pinLockedUntil: string | null;
}): Promise<void> {
  const device = await getAccountSwitchDevice(profileId, rawDeviceId);
  if (!device) {
    throw new Error('Device registration not found');
  }

  const supabaseAdmin = createAdminClient();
  const { error } = await supabaseAdmin
    .from('account_switch_device_credentials')
    .update({
      pin_failed_attempts: pinFailedAttempts,
      pin_locked_until: pinLockedUntil,
    })
    .eq('profile_id', profileId)
    .eq('device_id', device.id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function clearAccountSwitchDeviceCredentialLock({
  profileId,
  rawDeviceId,
}: {
  profileId: string;
  rawDeviceId: string;
}): Promise<void> {
  await updateAccountSwitchDeviceCredentialState({
    profileId,
    rawDeviceId,
    pinFailedAttempts: 0,
    pinLockedUntil: null,
  });
}

export async function clearAccountSwitchDevicePin({
  profileId,
  rawDeviceId,
}: {
  profileId: string;
  rawDeviceId: string;
}): Promise<boolean> {
  const device = await getAccountSwitchDevice(profileId, rawDeviceId);
  if (!device) {
    return false;
  }

  const supabaseAdmin = createAdminClient();
  const { error } = await supabaseAdmin
    .from('account_switch_device_credentials')
    .delete()
    .eq('profile_id', profileId)
    .eq('device_id', device.id);

  if (error) {
    throw new Error(error.message);
  }

  return true;
}

export async function listAccountSwitchDeviceProfiles(
  rawDeviceId: string
): Promise<AccountSwitchDeviceProfileSummary[]> {
  const supabaseAdmin = createAdminClient();
  const deviceIdHash = hashAccountSwitchDeviceId(rawDeviceId);

  const deviceResult = await supabaseAdmin
    .from('account_switch_devices')
    .select('id, profile_id')
    .eq('device_id_hash', deviceIdHash)
    .is('revoked_at', null);

  if (deviceResult.error) {
    throw new Error(deviceResult.error.message);
  }

  const normalizedDeviceRows = (deviceResult.data as AccountSwitchDeviceListRow[] | null) || [];
  const deviceIds = normalizedDeviceRows.map((row) => row.id).filter(Boolean);
  if (deviceIds.length === 0) {
    return [];
  }

  const profileIds = Array.from(new Set(normalizedDeviceRows.map((row) => row.profile_id).filter(Boolean)));
  const { data: profileRows, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, avatar_url, role_id')
    .in('id', profileIds);

  if (profileError) {
    throw new Error(profileError.message);
  }

  const normalizedProfileRows = (profileRows as AccountSwitchProfileRow[] | null) || [];
  const roleIds = Array.from(
    new Set(normalizedProfileRows.map((row) => row.role_id).filter((value): value is string => Boolean(value)))
  );
  const roleById = new Map<string, AccountSwitchRoleRow>();

  if (roleIds.length > 0) {
    const { data: roleRows, error: roleError } = await supabaseAdmin
      .from('roles')
      .select('id, name')
      .in('id', roleIds);

    if (roleError) {
      throw new Error(roleError.message);
    }

    ((roleRows as AccountSwitchRoleRow[] | null) || []).forEach((role) => {
      roleById.set(role.id, role);
    });
  }

  const profileById = new Map<string, AccountSwitchProfileRow>();
  normalizedProfileRows.forEach((profile) => {
    profileById.set(profile.id, profile);
  });

  const { data: credentialRows, error: credentialError } = await supabaseAdmin
    .from('account_switch_device_credentials')
    .select(`
      device_id,
      profile_id,
      pin_last_changed_at,
      pin_failed_attempts,
      pin_locked_until
    `)
    .in('device_id', deviceIds);

  if (credentialError) {
    throw new Error(credentialError.message);
  }

  const credentialByDeviceId = new Map(
    (credentialRows || []).map((row) => [row.device_id, row])
  );

  return normalizedDeviceRows
    .reduce<AccountSwitchDeviceProfileSummary[]>((acc, deviceRow) => {
      const credential = credentialByDeviceId.get(deviceRow.id);
      if (!credential) {
        return acc;
      }

      const profileValue = profileById.get(deviceRow.profile_id) || null;
      const roleValue = profileValue?.role_id ? roleById.get(profileValue.role_id) || null : null;

      acc.push({
        device_id: deviceRow.id,
        profile_id: deviceRow.profile_id,
        full_name: profileValue?.full_name || null,
        avatar_url: profileValue?.avatar_url || null,
        email: null,
        role_name: roleValue?.name || null,
        last_authenticated_at: null,
        last_locked_at: null,
        pin_last_changed_at: credential.pin_last_changed_at || null,
        pin_failed_attempts: credential.pin_failed_attempts || 0,
        pin_locked_until: credential.pin_locked_until || null,
      });
      return acc;
    }, [])
    .sort((left, right) => {
      const leftTime = left.last_authenticated_at ? new Date(left.last_authenticated_at).getTime() : 0;
      const rightTime = right.last_authenticated_at ? new Date(right.last_authenticated_at).getTime() : 0;
      return rightTime - leftTime;
    });
}
