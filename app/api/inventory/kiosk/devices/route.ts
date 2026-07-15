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

interface DeviceActionBody {
  action?: 'start_pairing' | 'cancel_pairing' | 'confirm_pairing' | 'revoke_device';
  device_label?: unknown;
  pairing_id?: string;
  confirmation_code?: unknown;
  device_id?: string;
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

export async function GET() {
  const manager = await requireManager();
  if (manager.response) return manager.response;

  try {
    const state = await getInventoryKioskDeviceAdminState();
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
      await revokeInventoryKioskDevice(manager.userId, body.device_id);
    } else {
      return NextResponse.json(
        { error: 'Unsupported Yard kiosk device action' },
        { status: 400 },
      );
    }

    const state = await getInventoryKioskDeviceAdminState();
    return NextResponse.json({ success: true, ...state });
  } catch (error) {
    return errorResponse(error);
  }
}
