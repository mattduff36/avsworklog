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
  type YardKioskControlAction,
  type YardKioskControlLeaseView,
  type YardKioskHeartbeatInput,
  type YardKioskRemoteCommandStatus,
  type YardKioskRemoteCommandType,
  type YardKioskRemoteCommandView,
  type YardKioskWorkflowSnapshot,
} from '@/lib/inventory/kiosk-remote-types';
import { getYardKioskErrorDefinition, listYardKioskErrorCatalogue } from '@/lib/inventory/kiosk-errors';
import type { Database } from '@/types/database';

type DeviceRow = Database['public']['Tables']['inventory_kiosk_devices']['Row'];
type CommandRow = Database['public']['Tables']['inventory_kiosk_device_commands']['Row'];
type EventRow = Database['public']['Tables']['inventory_kiosk_device_events']['Row'];

const COMMAND_TTL_MS = 5 * 60 * 1000;
const CONTROL_COMMAND_TTL_MS = 20_000;
const CONTROL_LEASE_MS = 20_000;
const MAX_SNAPSHOT_BYTES = 512 * 1024;
const MAX_CONTROL_ACTION_BYTES = 2 * 1024;
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
  workflow_snapshot: YardKioskWorkflowSnapshot | null;
  workflow_state_version: number;
  last_snapshot_at: string | null;
  control_lease: YardKioskControlLeaseView;
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
    payload: row.payload,
  };
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function serializedByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function controlLeaseForDevice(device: DeviceRow): YardKioskControlLeaseView {
  const expiresAt = device.control_lease_expires_at;
  return {
    session_id: device.control_session_id,
    holder_user_id: device.control_holder_user_id,
    acquired_at: device.control_acquired_at,
    expires_at: expiresAt,
    is_active: Boolean(expiresAt && new Date(expiresAt).getTime() > Date.now()),
  };
}

export function validateYardKioskWorkflowSnapshot(
  input: unknown,
): YardKioskWorkflowSnapshot {
  if (
    !input
    || typeof input !== 'object'
    || Array.isArray(input)
    || serializedByteLength(input) > MAX_SNAPSHOT_BYTES
  ) {
    throw new InventoryKioskDeviceError('Invalid or oversized kiosk workflow snapshot');
  }

  const snapshot = input as Partial<YardKioskWorkflowSnapshot>;
  if (
    snapshot.schema_version !== 1
    || !Number.isSafeInteger(snapshot.revision)
    || Number(snapshot.revision) < 0
    || !snapshot.state
    || typeof snapshot.state !== 'object'
    || Array.isArray(snapshot.state)
    || !snapshot.bootstrap
    || typeof snapshot.bootstrap !== 'object'
    || !Array.isArray(snapshot.locations)
    || typeof snapshot.offline !== 'boolean'
    || !snapshot.location_ui
    || !snapshot.item_ui
    || typeof snapshot.recorded_at !== 'string'
    || Number.isNaN(Date.parse(snapshot.recorded_at))
  ) {
    throw new InventoryKioskDeviceError('Invalid kiosk workflow snapshot');
  }

  const locationUi = snapshot.location_ui;
  const itemUi = snapshot.item_ui;
  if (
    typeof locationUi.query !== 'string'
    || locationUi.query.length > 200
    || !['all', 'manual', 'vans', 'sites'].includes(locationUi.active_filter)
    || !Number.isSafeInteger(locationUi.page_index)
    || locationUi.page_index < 0
    || typeof locationUi.include_legacy_quotes !== 'boolean'
    || !Array.isArray(locationUi.recent_ids)
    || !Array.isArray(locationUi.pinned_ids)
    || locationUi.recent_ids.length > 100
    || locationUi.pinned_ids.length > 100
    || locationUi.recent_ids.some((id) => !isUuid(id))
    || locationUi.pinned_ids.some((id) => !isUuid(id))
    || !Number.isSafeInteger(itemUi.page_index)
    || itemUi.page_index < 0
    || (itemUi.hardware_item_id !== null && !isUuid(itemUi.hardware_item_id))
    || !Number.isSafeInteger(itemUi.hardware_quantity)
    || itemUi.hardware_quantity < 0
  ) {
    throw new InventoryKioskDeviceError('Invalid kiosk workflow controls');
  }

  return snapshot as YardKioskWorkflowSnapshot;
}

export function validateYardKioskControlAction(input: unknown): YardKioskControlAction {
  if (
    !input
    || typeof input !== 'object'
    || Array.isArray(input)
    || serializedByteLength(input) > MAX_CONTROL_ACTION_BYTES
  ) {
    throw new InventoryKioskDeviceError('Invalid or oversized kiosk control action');
  }

  const action = input as Record<string, unknown>;
  const type = action.type;
  if (typeof type !== 'string') {
    throw new InventoryKioskDeviceError('Kiosk control action type is required');
  }

  if (['back', 'forward', 'clear_basket', 'dismiss_error', 'reset', 'close_hardware_quantity'].includes(type)) {
    return { type } as YardKioskControlAction;
  }
  if (type === 'select_direction' && (action.direction === 'take' || action.direction === 'return')) {
    return { type, direction: action.direction };
  }
  if (['select_location', 'toggle_location_pin', 'add_serialized', 'open_hardware_quantity'].includes(type) && isUuid(action[type === 'select_location' || type === 'toggle_location_pin' ? 'location_id' : 'item_id'])) {
    return type === 'select_location' || type === 'toggle_location_pin'
      ? { type, location_id: action.location_id as string }
      : { type, item_id: action.item_id as string } as YardKioskControlAction;
  }
  if (type === 'remove_line' && (action.kind === 'serialized' || action.kind === 'hardware') && isUuid(action.item_id)) {
    return { type, kind: action.kind, item_id: action.item_id };
  }
  if (type === 'set_hardware_quantity' && isUuid(action.item_id) && Number.isSafeInteger(action.quantity) && Number(action.quantity) >= 0) {
    return { type, item_id: action.item_id, quantity: Number(action.quantity) };
  }
  if (type === 'set_hardware_dialog_quantity' && Number.isSafeInteger(action.quantity) && Number(action.quantity) >= 0) {
    return { type, quantity: Number(action.quantity) };
  }
  if (
    (type === 'set_location_search' || type === 'set_item_search')
    && typeof action.query === 'string'
    && action.query.length <= 200
  ) {
    return { type, query: action.query } as YardKioskControlAction;
  }
  if (type === 'set_location_filter' && ['all', 'manual', 'vans', 'sites'].includes(String(action.filter))) {
    return { type, filter: action.filter } as YardKioskControlAction;
  }
  if (type === 'set_item_category' && typeof action.category === 'string' && /^[a-z0-9_-]{1,80}$/i.test(action.category)) {
    return { type, category: action.category };
  }
  if ((type === 'set_location_page' || type === 'set_item_page') && Number.isSafeInteger(action.page_index) && Number(action.page_index) >= 0) {
    return { type, page_index: Number(action.page_index) } as YardKioskControlAction;
  }
  if (type === 'set_include_legacy_quotes' && typeof action.enabled === 'boolean') {
    return { type, enabled: action.enabled };
  }

  throw new InventoryKioskDeviceError('Unsupported or invalid kiosk control action');
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

async function expireStaleControlLeases(deviceId?: string): Promise<void> {
  const admin = createAdminClient();
  let query = admin
    .from('inventory_kiosk_devices')
    .update({
      control_holder_user_id: null,
      control_session_id: null,
      control_acquired_at: null,
      control_lease_expires_at: null,
    })
    .not('control_session_id', 'is', null)
    .lt('control_lease_expires_at', new Date().toISOString());
  if (deviceId) query = query.eq('id', deviceId);
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
  controlLease: YardKioskControlLeaseView | null;
}> {
  const device = await resolveActiveKioskDeviceFromSession();
  if (!device) {
    return { device: null, commands: [], revoked: true, controlLease: null };
  }

  await Promise.all([
    expireStaleCommands(device.id),
    expireStaleControlLeases(device.id),
  ]);
  const nowIso = new Date().toISOString();
  const admin = createAdminClient();
  const snapshot = input.workflow_snapshot === undefined
    ? null
    : validateYardKioskWorkflowSnapshot(input.workflow_snapshot);
  const shouldStoreSnapshot = Boolean(
    snapshot && snapshot.revision >= device.workflow_state_version,
  );
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
      ...(shouldStoreSnapshot && snapshot ? {
        last_workflow_snapshot: snapshot,
        workflow_state_version: snapshot.revision,
        last_snapshot_at: nowIso,
      } : {}),
    })
    .eq('id', device.id)
    .is('revoked_at', null)
    .select('*')
    .maybeSingle();

  if (error) throw new InventoryKioskDeviceError(error.message, 500);
  if (!updated) {
    return { device, commands: [], revoked: true, controlLease: null };
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
    controlLease: controlLeaseForDevice(updated as DeviceRow),
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

export async function getInventoryKioskControlState(): Promise<{
  device: YardKioskDeviceOperationalView | null;
}> {
  const devices = await listInventoryKioskOperationalDevices();
  return {
    device: devices.find((device) => !device.revoked_at) || null,
  };
}

export async function takeInventoryKioskControl(input: {
  managerUserId: string;
  deviceId: string;
  controlSessionId: string;
}): Promise<YardKioskControlLeaseView> {
  if (!isUuid(input.deviceId) || !isUuid(input.controlSessionId)) {
    throw new InventoryKioskDeviceError('Invalid kiosk control session');
  }

  await expireStaleControlLeases(input.deviceId);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + CONTROL_LEASE_MS).toISOString();
  const { data, error } = await createAdminClient()
    .from('inventory_kiosk_devices')
    .update({
      control_holder_user_id: input.managerUserId,
      control_session_id: input.controlSessionId,
      control_acquired_at: nowIso,
      control_lease_expires_at: expiresAt,
    })
    .eq('id', input.deviceId)
    .is('revoked_at', null)
    .or(
      `control_session_id.is.null,control_lease_expires_at.lt.${nowIso},control_session_id.eq.${input.controlSessionId}`,
    )
    .select('*')
    .maybeSingle();

  if (error) throw new InventoryKioskDeviceError(error.message, 500);
  if (!data) {
    throw new InventoryKioskDeviceError(
      'Another manager is currently controlling this Yard kiosk',
      409,
    );
  }

  await recordInventoryKioskDeviceEvent({
    deviceId: input.deviceId,
    eventType: 'control_lease_taken',
    message: 'A manager took remote control of the Yard kiosk.',
    details: {
      manager_user_id: input.managerUserId,
      control_session_id: input.controlSessionId,
      expires_at: expiresAt,
    },
  });

  return controlLeaseForDevice(data as DeviceRow);
}

export async function renewInventoryKioskControl(input: {
  managerUserId: string;
  deviceId: string;
  controlSessionId: string;
}): Promise<YardKioskControlLeaseView> {
  if (!isUuid(input.deviceId) || !isUuid(input.controlSessionId)) {
    throw new InventoryKioskDeviceError('Invalid kiosk control session');
  }

  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CONTROL_LEASE_MS).toISOString();
  const { data, error } = await createAdminClient()
    .from('inventory_kiosk_devices')
    .update({ control_lease_expires_at: expiresAt })
    .eq('id', input.deviceId)
    .eq('control_holder_user_id', input.managerUserId)
    .eq('control_session_id', input.controlSessionId)
    .gt('control_lease_expires_at', nowIso)
    .is('revoked_at', null)
    .select('*')
    .maybeSingle();

  if (error) throw new InventoryKioskDeviceError(error.message, 500);
  if (!data) {
    throw new InventoryKioskDeviceError('The Yard kiosk control lease expired', 409);
  }
  return controlLeaseForDevice(data as DeviceRow);
}

export async function releaseInventoryKioskControl(input: {
  managerUserId: string;
  deviceId: string;
  controlSessionId: string;
}): Promise<void> {
  if (!isUuid(input.deviceId) || !isUuid(input.controlSessionId)) {
    throw new InventoryKioskDeviceError('Invalid kiosk control session');
  }

  const { data, error } = await createAdminClient()
    .from('inventory_kiosk_devices')
    .update({
      control_holder_user_id: null,
      control_session_id: null,
      control_acquired_at: null,
      control_lease_expires_at: null,
    })
    .eq('id', input.deviceId)
    .eq('control_holder_user_id', input.managerUserId)
    .eq('control_session_id', input.controlSessionId)
    .select('id')
    .maybeSingle();

  if (error) throw new InventoryKioskDeviceError(error.message, 500);
  if (!data) return;

  await recordInventoryKioskDeviceEvent({
    deviceId: input.deviceId,
    eventType: 'control_lease_released',
    message: 'A manager released remote control of the Yard kiosk.',
    details: {
      manager_user_id: input.managerUserId,
      control_session_id: input.controlSessionId,
    },
  });
}

export async function issueInventoryKioskControlAction(input: {
  managerUserId: string;
  deviceId: string;
  controlSessionId: string;
  action: unknown;
  idempotencyKey?: string;
}): Promise<YardKioskRemoteCommandView> {
  if (!isUuid(input.deviceId) || !isUuid(input.controlSessionId)) {
    throw new InventoryKioskDeviceError('Invalid kiosk control session');
  }
  const action = validateYardKioskControlAction(input.action);
  const nowIso = new Date().toISOString();
  const admin = createAdminClient();
  const { data: device, error: deviceError } = await admin
    .from('inventory_kiosk_devices')
    .select('id')
    .eq('id', input.deviceId)
    .eq('control_holder_user_id', input.managerUserId)
    .eq('control_session_id', input.controlSessionId)
    .gt('control_lease_expires_at', nowIso)
    .is('revoked_at', null)
    .maybeSingle();

  if (deviceError) throw new InventoryKioskDeviceError(deviceError.message, 500);
  if (!device) {
    throw new InventoryKioskDeviceError('Take control before using the Yard kiosk', 409);
  }

  const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
  if (idempotencyKey.length > 160) {
    throw new InventoryKioskDeviceError('Invalid kiosk action idempotency key');
  }
  const { data: existing, error: existingError } = await admin
    .from('inventory_kiosk_device_commands')
    .select('*')
    .eq('device_id', input.deviceId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existingError) throw new InventoryKioskDeviceError(existingError.message, 500);
  if (existing) return toCommandView(existing as CommandRow);

  const { data: inserted, error } = await admin
    .from('inventory_kiosk_device_commands')
    .insert({
      device_id: input.deviceId,
      command_type: 'control_action',
      status: 'pending',
      payload: {
        control_session_id: input.controlSessionId,
        action,
      },
      idempotency_key: idempotencyKey,
      issued_by: input.managerUserId,
      expires_at: new Date(Date.now() + CONTROL_COMMAND_TTL_MS).toISOString(),
    })
    .select('*')
    .single();

  if (error) throw new InventoryKioskDeviceError(error.message, 500);
  await recordInventoryKioskDeviceEvent({
    deviceId: input.deviceId,
    eventType: 'control_action_issued',
    message: 'A manager issued a validated Yard kiosk control action.',
    details: {
      manager_user_id: input.managerUserId,
      control_session_id: input.controlSessionId,
      command_id: inserted.id,
      action_type: action.type,
    },
  });

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
  await Promise.all([
    expireStaleCommands(),
    expireStaleControlLeases(),
  ]);
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
    workflow_snapshot:
      device.last_workflow_snapshot?.schema_version === 1
        ? device.last_workflow_snapshot as unknown as YardKioskWorkflowSnapshot
        : null,
    workflow_state_version: device.workflow_state_version,
    last_snapshot_at: device.last_snapshot_at,
    control_lease: controlLeaseForDevice(device),
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
