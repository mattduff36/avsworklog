import { NextRequest, NextResponse } from 'next/server';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import {
  InventoryKioskDeviceError,
  cancelInventoryKioskPairing,
  confirmInventoryKioskPairing,
  getInventoryKioskDeviceAdminState,
  revokeInventoryKioskDevice,
  startInventoryKioskPairing,
} from '@/lib/server/inventory-kiosk-devices';
import {
  cancelInventoryKioskDeviceCommand,
  issueInventoryKioskDeviceCommand,
  listInventoryKioskOperationalDevices,
} from '@/lib/server/inventory-kiosk-remote';
import type { YardKioskRemoteCommandType } from '@/lib/inventory/kiosk-remote-types';

interface DeviceActionBody {
  action?:
    | 'start_pairing'
    | 'cancel_pairing'
    | 'confirm_pairing'
    | 'revoke_device'
    | 'issue_command'
    | 'cancel_command';
  device_label?: unknown;
  pairing_id?: string;
  confirmation_code?: unknown;
  device_id?: string;
  command_type?: YardKioskRemoteCommandType;
  command_id?: string;
  idempotency_key?: string;
  confirmed_destructive?: boolean;
}

function errorResponse(error: unknown) {
  const status = error instanceof InventoryKioskDeviceError ? error.status : 500;
  return NextResponse.json(
    {
      error: error instanceof Error
        ? error.message
        : 'Unable to update Yard kiosk devices',
    },
    { status },
  );
}

async function requireManager() {
  const access = await requireInventoryManagerAccess();
  if (!access.allowed || !access.userId) {
    return {
      userId: null,
      response: NextResponse.json(
        { error: access.error || 'Unauthorized' },
        { status: access.status },
      ),
    };
  }
  return { userId: access.userId, response: null };
}

async function loadEnrichedState() {
  const [state, operational] = await Promise.all([
    getInventoryKioskDeviceAdminState(),
    listInventoryKioskOperationalDevices(),
  ]);
  const byId = new Map(operational.map((device) => [device.id, device]));
  return {
    ...state,
    devices: state.devices.map((device) => {
      const live = byId.get(device.id);
      return {
        ...device,
        last_heartbeat_at: live?.last_heartbeat_at || null,
        last_phase: live?.last_phase || null,
        last_app_version: live?.last_app_version || null,
        last_error_code: live?.last_error_code || null,
        last_diagnostic_id: live?.last_diagnostic_id || null,
        presence: live?.presence || (device.revoked_at ? 'revoked' : 'offline'),
        pending_commands: live?.pending_commands || [],
      };
    }),
  };
}

export async function GET() {
  const manager = await requireManager();
  if (manager.response) return manager.response;

  try {
    const state = await loadEnrichedState();
    return NextResponse.json({ success: true, ...state });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const manager = await requireManager();
  if (manager.response) return manager.response;
  if (!manager.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as DeviceActionBody;

    if (body.action === 'start_pairing') {
      const state = await startInventoryKioskPairing(
        manager.userId,
        body.device_label,
      );
      return NextResponse.json({ success: true, ...state });
    }

    if (body.action === 'cancel_pairing') {
      await cancelInventoryKioskPairing();
    } else if (body.action === 'confirm_pairing') {
      if (!body.pairing_id) {
        return NextResponse.json(
          { error: 'pairing_id is required' },
          { status: 400 },
        );
      }
      await confirmInventoryKioskPairing(
        manager.userId,
        body.pairing_id,
        body.confirmation_code,
      );
    } else if (body.action === 'revoke_device') {
      if (!body.device_id) {
        return NextResponse.json(
          { error: 'device_id is required' },
          { status: 400 },
        );
      }
      await issueInventoryKioskDeviceCommand({
        managerUserId: manager.userId,
        deviceId: body.device_id,
        commandType: 'logout',
        confirmedDestructive: true,
        idempotencyKey: `revoke-logout:${body.device_id}`,
      }).catch(() => undefined);
      await revokeInventoryKioskDevice(manager.userId, body.device_id);
    } else if (body.action === 'issue_command') {
      if (!body.device_id || !body.command_type) {
        return NextResponse.json(
          { error: 'device_id and command_type are required' },
          { status: 400 },
        );
      }
      await issueInventoryKioskDeviceCommand({
        managerUserId: manager.userId,
        deviceId: body.device_id,
        commandType: body.command_type,
        idempotencyKey: body.idempotency_key,
        confirmedDestructive: Boolean(body.confirmed_destructive),
      });
    } else if (body.action === 'cancel_command') {
      if (!body.command_id) {
        return NextResponse.json(
          { error: 'command_id is required' },
          { status: 400 },
        );
      }
      await cancelInventoryKioskDeviceCommand(manager.userId, body.command_id);
    } else {
      return NextResponse.json(
        { error: 'Unsupported Yard kiosk device action' },
        { status: 400 },
      );
    }

    const state = await loadEnrichedState();
    return NextResponse.json({ success: true, ...state });
  } catch (error) {
    return errorResponse(error);
  }
}
