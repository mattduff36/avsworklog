import 'server-only';

import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateAppSession } from '@/lib/server/app-auth/session';
import {
  InventoryKioskDeviceError,
  revokeInventoryKioskDevice,
} from '@/lib/server/inventory-kiosk-devices';
import {
  YARD_KIOSK_DESTRUCTIVE_COMMANDS,
  YARD_KIOSK_ONLINE_THRESHOLD_MS,
  type YardKioskHeartbeatInput,
  type YardKioskRemoteCommandStatus,
  type YardKioskRemoteCommandType,
  type YardKioskRemoteCommandView,
} from '@/lib/inventory/kiosk-remote-types';
import { getYardKioskErrorDefinition, listYardKioskErrorCatalogue } from '@/lib/inventory/kiosk-errors';
import type { Database } from '@/types/database';

type DeviceRow = Database['public']['Tables']['inventory_kiosk_devices']['Row'];
type CommandRow = Database['public']['Tables']['inventory_kiosk_device_commands']['Row'];
type EventRow = Database['public']['Tables']['inventory_kiosk_device_events']['Row'];

const COMMAND_TTL_MS = 5 * 60 * 1000;
const ALLOWED_COMMANDS = new Set<YardKioskRemoteCommandType>([
  'ping',
  'refresh_status',
  'refresh_session',
  'reload_app',
  'reset_workflow',
  'logout',
  'clear_credentials',
]);

export interface YardKioskDeviceOperationalView {
  id: string;
  device_label: string;
  last_seen_at: string | null;
  last_authenticated_at: string | null;
  last_heartbeat_at: string | null;
  last_phase: string | null;
  last_app_version: string | null;
  last_deployment_id: string | null;
  last_error_code: string | null;
  last_diagnostic_id: string | null;
  revoked_at: string | null;
  created_at: string;
  presence: 'online' | 'stale' | 'offline' | 'revoked';
  pending_commands: YardKioskRemoteCommandView[];
}

function toCommandView(row: CommandRow): YardKioskRemoteCommandView {
  return {
    id: row.id,
    device_id: row.device_id,
    command_type: row.command_type,
    status: row.status,
    issued_at: row.issued_at,
    expires_at: row.expires_at,
    accepted_at: row.accepted_at,
    completed_at: row.completed_at,
    failed_at: row.failed_at,
    result_code: row.result_code,
    error_message: row.error_message,
  };
}

function presenceForDevice(device: DeviceRow): YardKioskDeviceOperationalView['presence'] {
  if (device.revoked_at) return 'revoked';
  if (!device.last_heartbeat_at) return 'offline';
  const age = Date.now() - new Date(device.last_heartbeat_at).getTime();
  if (age <= YARD_KIOSK_ONLINE_THRESHOLD_MS) return 'online';
  if (age <= 5 * 60 * 1000) return 'stale';
  return 'offline';
}

async function expireStaleCommands(deviceId?: string): Promise<void> {
  const admin = createAdminClient();
  let query = admin
    .from('inventory_kiosk_device_commands')
    .update({ status: 'expired' })
    .in('status', ['pending', 'accepted'])
    .lt('expires_at', new Date().toISOString());
  if (deviceId) {
    query = query.eq('device_id', deviceId);
  }
  const { error } = await query;
  if (error) throw new InventoryKioskDeviceError(error.message, 500);
}

export async function resolveActiveKioskDeviceFromSession(): Promise<DeviceRow | null> {
  const session = await validateAppSession();
  if (session.status !== 'active' || !session.session?.kiosk_device_id) {
    return null;
  }

  const { data, error } = await createAdminClient()
    .from('inventory_kiosk_devices')
    .select('*')
    .eq('id', session.session.kiosk_device_id)
    .eq('kiosk_user_id', session.profileId || '')
    .is('revoked_at', null)
    .maybeSingle();

  if (error) throw new InventoryKioskDeviceError(error.message, 500);
  return (data as DeviceRow | null) || null;
}

export async function recordInventoryKioskDeviceHeartbeat(
  input: YardKioskHeartbeatInput,
): Promise<{
  device: DeviceRow | null;
  commands: YardKioskRemoteCommandView[];
  revoked: boolean;
}> {
  const device = await resolveActiveKioskDeviceFromSession();
  if (!device) {
    return { device: null, commands: [], revoked: true };
  }

  await expireStaleCommands(device.id);
  const nowIso = new Date().toISOString();
  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from('inventory_kiosk_devices')
    .update({
      last_seen_at: nowIso,
      last_heartbeat_at: nowIso,
      last_phase: input.phase || null,
      last_app_version: input.app_version || null,
      last_deployment_id: input.deployment_id || null,
      last_error_code: input.last_error_code || null,
      last_diagnostic_id: input.diagnostic_id || null,
      diagnostics: {
        offline: Boolean(input.offline),
        recorded_at: nowIso,
      },
    })
    .eq('id', device.id)
    .is('revoked_at', null)
    .select('*')
    .maybeSingle();

  if (error) throw new InventoryKioskDeviceError(error.message, 500);
  if (!updated) {
    return { device, commands: [], revoked: true };
  }

  const { data: commands, error: commandError } = await admin
    .from('inventory_kiosk_device_commands')
    .select('*')
    .eq('device_id', device.id)
    .in('status', ['pending', 'accepted'])
    .gt('expires_at', nowIso)
    .order('issued_at', { ascending: true })
    .limit(20);

  if (commandError) throw new InventoryKioskDeviceError(commandError.message, 500);

  return {
    device: updated as DeviceRow,
    commands: ((commands || []) as CommandRow[]).map(toCommandView),
    revoked: false,
  };
}

export async function acknowledgeInventoryKioskDeviceCommand(input: {
  commandId: string;
  status: 'accepted' | 'completed' | 'failed';
  resultCode?: string | null;
  errorMessage?: string | null;
}): Promise<YardKioskRemoteCommandView> {
  const device = await resolveActiveKioskDeviceFromSession();
  if (!device) {
    throw new InventoryKioskDeviceError('This kiosk device is not signed in', 401);
  }

  await expireStaleCommands(device.id);
  const admin = createAdminClient();
  const { data: existing, error: loadError } = await admin
    .from('inventory_kiosk_device_commands')
    .select('*')
    .eq('id', input.commandId)
    .eq('device_id', device.id)
    .maybeSingle();

  if (loadError) throw new InventoryKioskDeviceError(loadError.message, 500);
  if (!existing) {
    throw new InventoryKioskDeviceError('Command not found', 404);
  }

  const row = existing as CommandRow;
  if (row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled') {
    return toCommandView(row);
  }
  if (row.status === 'expired') {
    throw new InventoryKioskDeviceError('Command expired', 409);
  }

  const nowIso = new Date().toISOString();
  const patch: Database['public']['Tables']['inventory_kiosk_device_commands']['Update'] = {
    status: input.status,
    result_code: input.resultCode || null,
    error_message: input.errorMessage || null,
  };
  if (input.status === 'accepted') patch.accepted_at = nowIso;
  if (input.status === 'completed') {
    patch.completed_at = nowIso;
    if (!row.accepted_at) patch.accepted_at = nowIso;
  }
  if (input.status === 'failed') {
    patch.failed_at = nowIso;
    if (!row.accepted_at) patch.accepted_at = nowIso;
  }

  const { data: updated, error } = await admin
    .from('inventory_kiosk_device_commands')
    .update(patch)
    .eq('id', row.id)
    .eq('device_id', device.id)
    .select('*')
    .maybeSingle();

  if (error) throw new InventoryKioskDeviceError(error.message, 500);
  if (!updated) throw new InventoryKioskDeviceError('Command update failed', 500);
  return toCommandView(updated as CommandRow);
}

export async function issueInventoryKioskDeviceCommand(input: {
  managerUserId: string;
  deviceId: string;
  commandType: YardKioskRemoteCommandType;
  idempotencyKey?: string;
  confirmedDestructive?: boolean;
}): Promise<YardKioskRemoteCommandView> {
  if (!ALLOWED_COMMANDS.has(input.commandType)) {
    throw new InventoryKioskDeviceError('Unsupported kiosk command', 400);
  }
  if (
    YARD_KIOSK_DESTRUCTIVE_COMMANDS.includes(input.commandType)
    && !input.confirmedDestructive
  ) {
    throw new InventoryKioskDeviceError(
      'Confirm this action before continuing. It may clear the current basket or sign the tablet out.',
      400,
    );
  }

  const admin = createAdminClient();
  const { data: device, error: deviceError } = await admin
    .from('inventory_kiosk_devices')
    .select('*')
    .eq('id', input.deviceId)
    .is('revoked_at', null)
    .maybeSingle();

  if (deviceError) throw new InventoryKioskDeviceError(deviceError.message, 500);
  if (!device) {
    throw new InventoryKioskDeviceError('Trusted kiosk device not found', 404);
  }

  await expireStaleCommands(input.deviceId);
  const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
  const { data: existing } = await admin
    .from('inventory_kiosk_device_commands')
    .select('*')
    .eq('device_id', input.deviceId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existing) return toCommandView(existing as CommandRow);

  const { data: inserted, error } = await admin
    .from('inventory_kiosk_device_commands')
    .insert({
      device_id: input.deviceId,
      command_type: input.commandType,
      status: 'pending',
      payload: {},
      idempotency_key: idempotencyKey,
      issued_by: input.managerUserId,
      expires_at: new Date(Date.now() + COMMAND_TTL_MS).toISOString(),
    })
    .select('*')
    .single();

  if (error) throw new InventoryKioskDeviceError(error.message, 500);

  if (input.commandType === 'clear_credentials') {
    await revokeInventoryKioskDevice(input.managerUserId, input.deviceId);
  }

  return toCommandView(inserted as CommandRow);
}

export async function cancelInventoryKioskDeviceCommand(
  managerUserId: string,
  commandId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('inventory_kiosk_device_commands')
    .update({
      status: 'cancelled',
      error_message: `Cancelled by ${managerUserId}`,
    })
    .eq('id', commandId)
    .in('status', ['pending', 'accepted']);
  if (error) throw new InventoryKioskDeviceError(error.message, 500);
}

export async function recordInventoryKioskDeviceEvent(input: {
  deviceId?: string | null;
  eventType: string;
  errorCode?: string | null;
  diagnosticId?: string | null;
  message?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await createAdminClient()
    .from('inventory_kiosk_device_events')
    .insert({
      device_id: input.deviceId || null,
      event_type: input.eventType.slice(0, 80),
      error_code: input.errorCode || null,
      diagnostic_id: input.diagnosticId || null,
      message: input.message || null,
      details: input.details || {},
    });
  if (error) throw new InventoryKioskDeviceError(error.message, 500);
}

export async function listInventoryKioskOperationalDevices(): Promise<YardKioskDeviceOperationalView[]> {
  await expireStaleCommands();
  const admin = createAdminClient();
  const { data: devices, error } = await admin
    .from('inventory_kiosk_devices')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new InventoryKioskDeviceError(error.message, 500);

  const deviceRows = (devices || []) as DeviceRow[];
  const activeIds = deviceRows.filter((d) => !d.revoked_at).map((d) => d.id);
  let commandsByDevice = new Map<string, YardKioskRemoteCommandView[]>();

  if (activeIds.length > 0) {
    const { data: commands, error: commandError } = await admin
      .from('inventory_kiosk_device_commands')
      .select('*')
      .in('device_id', activeIds)
      .in('status', ['pending', 'accepted'])
      .gt('expires_at', new Date().toISOString())
      .order('issued_at', { ascending: false });
    if (commandError) throw new InventoryKioskDeviceError(commandError.message, 500);

    commandsByDevice = ((commands || []) as CommandRow[]).reduce((map, row) => {
      const list = map.get(row.device_id) || [];
      list.push(toCommandView(row));
      map.set(row.device_id, list);
      return map;
    }, new Map<string, YardKioskRemoteCommandView[]>());
  }

  return deviceRows.map((device) => ({
    id: device.id,
    device_label: device.device_label,
    last_seen_at: device.last_seen_at,
    last_authenticated_at: device.last_authenticated_at,
    last_heartbeat_at: device.last_heartbeat_at,
    last_phase: device.last_phase,
    last_app_version: device.last_app_version,
    last_deployment_id: device.last_deployment_id,
    last_error_code: device.last_error_code,
    last_diagnostic_id: device.last_diagnostic_id,
    revoked_at: device.revoked_at,
    created_at: device.created_at,
    presence: presenceForDevice(device),
    pending_commands: commandsByDevice.get(device.id) || [],
  }));
}

export async function getInventoryKioskDebugSnapshot(options: {
  diagnosticId?: string | null;
} = {}) {
  const devices = await listInventoryKioskOperationalDevices();
  const admin = createAdminClient();
  let eventsQuery = admin
    .from('inventory_kiosk_device_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (options.diagnosticId) {
    eventsQuery = eventsQuery.eq('diagnostic_id', options.diagnosticId);
  }
  const [{ data: events, error: eventsError }, { data: commands, error: commandsError }] =
    await Promise.all([
      eventsQuery,
      admin
        .from('inventory_kiosk_device_commands')
        .select('*')
        .order('issued_at', { ascending: false })
        .limit(100),
    ]);

  if (eventsError) throw new InventoryKioskDeviceError(eventsError.message, 500);
  if (commandsError) throw new InventoryKioskDeviceError(commandsError.message, 500);

  const catalogue = listYardKioskErrorCatalogue().map((entry) => ({
    ...entry,
    likelyCause: entry.whatHappened,
    howToFix: entry.whatToDoNext,
  }));

  return {
    devices,
    events: (events || []) as EventRow[],
    commands: ((commands || []) as CommandRow[]).map(toCommandView),
    error_catalogue: catalogue,
    guidance: devices.flatMap((device) => {
      if (!device.last_error_code) return [];
      try {
        const definition = getYardKioskErrorDefinition(
          device.last_error_code as Parameters<typeof getYardKioskErrorDefinition>[0],
        );
        return [{
          device_id: device.id,
          device_label: device.device_label,
          code: definition.code,
          likely_cause: definition.whatHappened,
          how_to_fix: definition.whatToDoNext,
          diagnostic_id: device.last_diagnostic_id,
        }];
      } catch {
        return [];
      }
    }),
  };
}

export type { YardKioskRemoteCommandStatus };
