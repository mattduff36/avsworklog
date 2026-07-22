import { NextRequest, NextResponse } from 'next/server';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { InventoryKioskDeviceError } from '@/lib/server/inventory-kiosk-devices';
import {
  getInventoryKioskControlState,
  issueInventoryKioskControlAction,
  releaseInventoryKioskControl,
  renewInventoryKioskControl,
  takeInventoryKioskControl,
} from '@/lib/server/inventory-kiosk-remote';

interface KioskControlBody {
  operation?: 'take' | 'renew' | 'release' | 'action';
  device_id?: string;
  control_session_id?: string;
  control_action?: unknown;
  idempotency_key?: string;
}

function errorResponse(error: unknown) {
  const status = error instanceof InventoryKioskDeviceError ? error.status : 500;
  return NextResponse.json(
    {
      error: error instanceof Error
        ? error.message
        : 'Unable to control the Yard kiosk',
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function requireManager() {
  const access = await requireInventoryManagerAccess();
  if (!access.allowed || !access.userId) {
    return {
      userId: null,
      response: NextResponse.json(
        { error: access.error || 'Unauthorized' },
        { status: access.status, headers: { 'Cache-Control': 'no-store' } },
      ),
    };
  }
  return { userId: access.userId, response: null };
}

export async function GET() {
  const manager = await requireManager();
  if (manager.response) return manager.response;

  try {
    const state = await getInventoryKioskControlState();
    return NextResponse.json(
      { success: true, ...state },
      { headers: { 'Cache-Control': 'no-store' } },
    );
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
    const body = await request.json() as KioskControlBody;
    if (!body.device_id || !body.control_session_id) {
      return NextResponse.json(
        { error: 'device_id and control_session_id are required' },
        { status: 400 },
      );
    }

    if (body.operation === 'take') {
      const controlLease = await takeInventoryKioskControl({
        managerUserId: manager.userId,
        deviceId: body.device_id,
        controlSessionId: body.control_session_id,
      });
      return NextResponse.json({ success: true, control_lease: controlLease });
    }

    if (body.operation === 'renew') {
      const controlLease = await renewInventoryKioskControl({
        managerUserId: manager.userId,
        deviceId: body.device_id,
        controlSessionId: body.control_session_id,
      });
      return NextResponse.json({ success: true, control_lease: controlLease });
    }

    if (body.operation === 'release') {
      await releaseInventoryKioskControl({
        managerUserId: manager.userId,
        deviceId: body.device_id,
        controlSessionId: body.control_session_id,
      });
      return NextResponse.json({ success: true });
    }

    if (body.operation === 'action') {
      const command = await issueInventoryKioskControlAction({
        managerUserId: manager.userId,
        deviceId: body.device_id,
        controlSessionId: body.control_session_id,
        action: body.control_action,
        idempotencyKey: body.idempotency_key,
      });
      return NextResponse.json({ success: true, command });
    }

    return NextResponse.json(
      { error: 'Unsupported Yard kiosk control operation' },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
