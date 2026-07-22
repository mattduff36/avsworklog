import 'server-only';

import { randomInt, timingSafeEqual } from 'node:crypto';
import { getAppSessionHashSecret } from '@/lib/server/app-auth/constants';
import { randomToken, sha256Hex } from '@/lib/server/app-auth/jwt';
import { issueAppSession } from '@/lib/server/app-auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/types/database';

const PAIRING_WINDOW_MS = 5 * 60 * 1000;
const DEVICE_LABEL_MAX_LENGTH = 100;

type PairingRow =
  Database['public']['Tables']['inventory_kiosk_pairing_sessions']['Row'];
type DeviceRow =
  Database['public']['Tables']['inventory_kiosk_devices']['Row'];

interface KioskConfigRow {
  kiosk_user_id: string;
  is_enabled: boolean;
}

export interface InventoryKioskPairingView {
  id: string;
  device_label: string;
  confirmation_code: string | null;
  status: PairingRow['status'];
  candidate_seen_at: string | null;
  expires_at: string;
}

export interface InventoryKioskDeviceView {
  id: string;
  device_label: string;
  last_seen_at: string | null;
  last_authenticated_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface InventoryKioskDeviceAdminState {
  active_pairing: InventoryKioskPairingView | null;
  devices: InventoryKioskDeviceView[];
}

export interface InventoryKioskPairingResult {
  status: 'pairing' | 'paired' | 'expired' | 'unavailable';
  pairing?: InventoryKioskPairingView;
  deviceToken?: string;
  message?: string;
}

export interface ActivatedInventoryKioskDevice {
  device: DeviceRow;
  deviceToken: string;
  appSession: Awaited<ReturnType<typeof issueAppSession>>;
}

export class InventoryKioskDeviceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'InventoryKioskDeviceError';
    this.status = status;
  }
}

function toPairingView(row: PairingRow): InventoryKioskPairingView {
  return {
    id: row.id,
    device_label: row.device_label,
    confirmation_code: row.confirmation_code,
    status: row.status,
    candidate_seen_at: row.candidate_seen_at,
    expires_at: row.expires_at,
  };
}

function toDeviceView(row: DeviceRow): InventoryKioskDeviceView {
  return {
    id: row.id,
    device_label: row.device_label,
    last_seen_at: row.last_seen_at,
    last_authenticated_at: row.last_authenticated_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
  };
}

function normalizeDeviceLabel(input: unknown): string {
  if (typeof input !== 'string') {
    throw new InventoryKioskDeviceError('Enter a name for this kiosk device');
  }
  const value = input.trim();
  if (!value || value.length > DEVICE_LABEL_MAX_LENGTH) {
    throw new InventoryKioskDeviceError(
      `Device name must be between 1 and ${DEVICE_LABEL_MAX_LENGTH} characters`,
    );
  }
  return value;
}

function createConfirmationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function codesMatch(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export async function hashInventoryKioskDeviceToken(token: string): Promise<string> {
  return sha256Hex(
    `${getAppSessionHashSecret()}:inventory-kiosk-device:${token}`,
  );
}

async function loadEnabledKioskConfig(): Promise<KioskConfigRow> {
  const { data, error } = await createAdminClient()
    .from('inventory_kiosk_config')
    .select('kiosk_user_id, is_enabled')
    .eq('id', 1)
    .maybeSingle();

  if (error) throw new InventoryKioskDeviceError(error.message, 500);
  if (!data || !data.is_enabled) {
    throw new InventoryKioskDeviceError(
      'The Yard kiosk is not configured or is disabled',
      503,
    );
  }
  return data as KioskConfigRow;
}

async function expireStalePairings(): Promise<void> {
  const { error } = await createAdminClient()
    .from('inventory_kiosk_pairing_sessions')
    .update({ status: 'expired' })
    .in('status', ['active', 'confirmed'])
    .lt('expires_at', new Date().toISOString());

  if (error) throw new InventoryKioskDeviceError(error.message, 500);
}

export async function hasActiveInventoryKioskPairing(): Promise<boolean> {
  await expireStalePairings();
  const { data, error } = await createAdminClient()
    .from('inventory_kiosk_pairing_sessions')
    .select('id')
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .limit(1);

  if (error) throw new InventoryKioskDeviceError(error.message, 500);
  return Boolean(data?.length);
}

export async function getInventoryKioskDeviceAdminState():
Promise<InventoryKioskDeviceAdminState> {
  const config = await loadEnabledKioskConfig();
  await expireStalePairings();
  const admin = createAdminClient();
  const [{ data: pairings, error: pairingError }, { data: devices, error: deviceError }] =
    await Promise.all([
      admin
        .from('inventory_kiosk_pairing_sessions')
        .select('*')
        .eq('kiosk_user_id', config.kiosk_user_id)
        .in('status', ['active', 'confirmed'])
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1),
      admin
        .from('inventory_kiosk_devices')
        .select('*')
        .eq('kiosk_user_id', config.kiosk_user_id)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

  if (pairingError) throw new InventoryKioskDeviceError(pairingError.message, 500);
  if (deviceError) throw new InventoryKioskDeviceError(deviceError.message, 500);

  return {
    active_pairing: pairings?.[0]
      ? toPairingView(pairings[0] as PairingRow)
      : null,
    devices: ((devices || []) as DeviceRow[]).map(toDeviceView),
  };
}

export async function startInventoryKioskPairing(
  managerUserId: string,
  rawDeviceLabel: unknown,
): Promise<InventoryKioskDeviceAdminState> {
  const config = await loadEnabledKioskConfig();
  const deviceLabel = normalizeDeviceLabel(rawDeviceLabel);
  const admin = createAdminClient();
  await expireStalePairings();

  const { error: cancelError } = await admin
    .from('inventory_kiosk_pairing_sessions')
    .update({ status: 'cancelled' })
    .eq('kiosk_user_id', config.kiosk_user_id)
    .in('status', ['active', 'confirmed']);
  if (cancelError) throw new InventoryKioskDeviceError(cancelError.message, 500);

  const { error } = await admin
    .from('inventory_kiosk_pairing_sessions')
    .insert({
      kiosk_user_id: config.kiosk_user_id,
      device_label: deviceLabel,
      started_by: managerUserId,
      status: 'active',
      expires_at: new Date(Date.now() + PAIRING_WINDOW_MS).toISOString(),
    });
  if (error) throw new InventoryKioskDeviceError(error.message, 500);

  return getInventoryKioskDeviceAdminState();
}

export async function cancelInventoryKioskPairing(): Promise<void> {
  const config = await loadEnabledKioskConfig();
  const { error } = await createAdminClient()
    .from('inventory_kiosk_pairing_sessions')
    .update({ status: 'cancelled' })
    .eq('kiosk_user_id', config.kiosk_user_id)
    .in('status', ['active', 'confirmed']);
  if (error) throw new InventoryKioskDeviceError(error.message, 500);
}

export async function joinInventoryKioskPairing(
  currentPairingToken: string | null,
): Promise<InventoryKioskPairingResult> {
  await expireStalePairings();
  const config = await loadEnabledKioskConfig();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('inventory_kiosk_pairing_sessions')
    .select('*')
    .eq('kiosk_user_id', config.kiosk_user_id)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw new InventoryKioskDeviceError(error.message, 500);
  const pairing = data?.[0] as PairingRow | undefined;
  if (!pairing) {
    return {
      status: 'unavailable',
      message: 'Ask an Inventory manager to start pairing this kiosk device.',
    };
  }

  if (pairing.pairing_token_hash) {
    if (
      currentPairingToken
      && await hashInventoryKioskDeviceToken(currentPairingToken)
        === pairing.pairing_token_hash
    ) {
      return { status: 'pairing', pairing: toPairingView(pairing) };
    }
    return {
      status: 'unavailable',
      message: 'Another browser is already using this pairing window.',
    };
  }

  const pairingToken = randomToken();
  const pairingTokenHash = await hashInventoryKioskDeviceToken(pairingToken);
  const confirmationCode = createConfirmationCode();
  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from('inventory_kiosk_pairing_sessions')
    .update({
      confirmation_code: confirmationCode,
      pairing_token_hash: pairingTokenHash,
      candidate_seen_at: nowIso,
    })
    .eq('id', pairing.id)
    .is('pairing_token_hash', null)
    .select('*')
    .maybeSingle();

  if (claimError) throw new InventoryKioskDeviceError(claimError.message, 500);
  if (!claimed) {
    return {
      status: 'unavailable',
      message: 'Another browser claimed this pairing window.',
    };
  }

  return {
    status: 'pairing',
    pairing: toPairingView(claimed as PairingRow),
    deviceToken: pairingToken,
  };
}

export async function getInventoryKioskPairingStatus(
  pairingToken: string | null,
): Promise<InventoryKioskPairingResult> {
  if (!pairingToken) return { status: 'unavailable' };
  await expireStalePairings();
  const pairingTokenHash = await hashInventoryKioskDeviceToken(pairingToken);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('inventory_kiosk_pairing_sessions')
    .select('*')
    .eq('pairing_token_hash', pairingTokenHash)
    .maybeSingle();

  if (error) throw new InventoryKioskDeviceError(error.message, 500);
  const pairing = data as PairingRow | null;
  if (!pairing || pairing.status === 'cancelled' || pairing.status === 'expired') {
    return { status: 'expired' };
  }
  if (pairing.status === 'active') {
    return { status: 'pairing', pairing: toPairingView(pairing) };
  }

  const { data: device, error: deviceError } = await admin
    .from('inventory_kiosk_devices')
    .select('*')
    .eq('pairing_session_id', pairing.id)
    .is('revoked_at', null)
    .maybeSingle();
  if (deviceError) throw new InventoryKioskDeviceError(deviceError.message, 500);
  if (!device) return { status: 'expired' };

  if (pairing.status === 'confirmed') {
    const { error: consumeError } = await admin
      .from('inventory_kiosk_pairing_sessions')
      .update({
        status: 'consumed',
        consumed_at: new Date().toISOString(),
      })
      .eq('id', pairing.id)
      .eq('status', 'confirmed');
    if (consumeError) throw new InventoryKioskDeviceError(consumeError.message, 500);
  }

  await admin
    .from('inventory_kiosk_devices')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', (device as DeviceRow).id);

  return { status: 'paired', deviceToken: pairingToken };
}

export async function confirmInventoryKioskPairing(
  managerUserId: string,
  pairingId: string,
  rawConfirmationCode: unknown,
): Promise<void> {
  const confirmationCode =
    typeof rawConfirmationCode === 'string' ? rawConfirmationCode.trim() : '';
  if (!/^[0-9]{6}$/.test(confirmationCode)) {
    throw new InventoryKioskDeviceError('Enter the six-digit code shown on the kiosk');
  }

  await expireStalePairings();
  const config = await loadEnabledKioskConfig();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('inventory_kiosk_pairing_sessions')
    .select('*')
    .eq('id', pairingId)
    .eq('kiosk_user_id', config.kiosk_user_id)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) throw new InventoryKioskDeviceError(error.message, 500);
  const pairing = data as PairingRow | null;
  if (!pairing) {
    throw new InventoryKioskDeviceError('This pairing window has expired', 409);
  }
  if (
    !pairing.confirmation_code
    || !pairing.pairing_token_hash
    || !codesMatch(pairing.confirmation_code, confirmationCode)
  ) {
    throw new InventoryKioskDeviceError('The confirmation code does not match');
  }

  const { data: existingDevice, error: existingError } = await admin
    .from('inventory_kiosk_devices')
    .select('id')
    .eq('pairing_session_id', pairing.id)
    .maybeSingle();
  if (existingError) throw new InventoryKioskDeviceError(existingError.message, 500);

  if (!existingDevice) {
    const { error: deviceError } = await admin
      .from('inventory_kiosk_devices')
      .insert({
        kiosk_user_id: pairing.kiosk_user_id,
        device_token_hash: pairing.pairing_token_hash,
        device_label: pairing.device_label,
        paired_by: managerUserId,
        pairing_session_id: pairing.id,
        last_seen_at: new Date().toISOString(),
      });
    if (deviceError) throw new InventoryKioskDeviceError(deviceError.message, 500);
  }

  const { error: confirmError } = await admin
    .from('inventory_kiosk_pairing_sessions')
    .update({
      status: 'confirmed',
      confirmed_by: managerUserId,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', pairing.id)
    .eq('status', 'active');
  if (confirmError) throw new InventoryKioskDeviceError(confirmError.message, 500);
}

export async function revokeInventoryKioskDevice(
  managerUserId: string,
  deviceId: string,
): Promise<void> {
  const config = await loadEnabledKioskConfig();
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from('inventory_kiosk_devices')
    .update({
      revoked_at: nowIso,
      revoked_by: managerUserId,
    })
    .eq('id', deviceId)
    .eq('kiosk_user_id', config.kiosk_user_id)
    .is('revoked_at', null);
  if (error) throw new InventoryKioskDeviceError(error.message, 500);

  const { error: sessionError } = await admin
    .from('app_auth_sessions')
    .update({
      revoked_at: nowIso,
      revoked_reason: 'kiosk_device_revoked',
    })
    .eq('kiosk_device_id', deviceId)
    .is('revoked_at', null);
  if (sessionError) throw new InventoryKioskDeviceError(sessionError.message, 500);
}

export async function activateInventoryKioskDevice(
  deviceToken: string | null,
): Promise<ActivatedInventoryKioskDevice | null> {
  if (!deviceToken) return null;
  const config = await loadEnabledKioskConfig();
  const currentHash = await hashInventoryKioskDeviceToken(deviceToken);
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from('inventory_kiosk_devices')
    .update({
      last_seen_at: nowIso,
      last_authenticated_at: nowIso,
    })
    .eq('device_token_hash', currentHash)
    .eq('kiosk_user_id', config.kiosk_user_id)
    .is('revoked_at', null)
    .select('*')
    .maybeSingle();

  if (error) throw new InventoryKioskDeviceError(error.message, 500);
  if (!data) return null;

  const device = data as DeviceRow;
  const appSession = await issueAppSession({
    profileId: device.kiosk_user_id,
    source: 'kiosk_device',
    rememberMe: true,
    kioskDeviceId: device.id,
    actorProfileId: device.kiosk_user_id,
  });

  return {
    device,
    deviceToken,
    appSession,
  };
}
