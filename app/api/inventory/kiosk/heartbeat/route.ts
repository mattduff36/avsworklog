import { NextRequest, NextResponse } from 'next/server';
import { InventoryKioskDeviceError } from '@/lib/server/inventory-kiosk-devices';
import {
  acknowledgeInventoryKioskDeviceCommand,
  recordInventoryKioskDeviceEvent,
  recordInventoryKioskDeviceHeartbeat,
} from '@/lib/server/inventory-kiosk-remote';
import type { YardKioskHeartbeatInput } from '@/lib/inventory/kiosk-remote-types';

function errorResponse(error: unknown) {
  const status = error instanceof InventoryKioskDeviceError ? error.status : 500;
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : 'Heartbeat failed',
      code: status === 401 ? 'SESSION_EXPIRED' : 'SERVICE_UNAVAILABLE',
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as YardKioskHeartbeatInput & {
      ack?: {
        command_id?: string;
        status?: 'accepted' | 'completed' | 'failed';
        result_code?: string | null;
        error_message?: string | null;
      };
      event?: {
        event_type?: string;
        error_code?: string | null;
        diagnostic_id?: string | null;
        message?: string | null;
      };
    };

    const heartbeat = await recordInventoryKioskDeviceHeartbeat({
      phase: body.phase,
      offline: body.offline,
      app_version: body.app_version,
      deployment_id: body.deployment_id,
      last_error_code: body.last_error_code,
      diagnostic_id: body.diagnostic_id,
    });

    if (heartbeat.revoked) {
      return NextResponse.json(
        {
          revoked: true,
          commands: [],
          code: 'DEVICE_REVOKED',
        },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (body.ack?.command_id && body.ack.status) {
      await acknowledgeInventoryKioskDeviceCommand({
        commandId: body.ack.command_id,
        status: body.ack.status,
        resultCode: body.ack.result_code,
        errorMessage: body.ack.error_message,
      });
    }

    if (body.event?.event_type) {
      await recordInventoryKioskDeviceEvent({
        deviceId: heartbeat.device?.id || null,
        eventType: body.event.event_type,
        errorCode: body.event.error_code,
        diagnosticId: body.event.diagnostic_id,
        message: body.event.message,
      });
    }

    return NextResponse.json(
      {
        success: true,
        revoked: false,
        device_id: heartbeat.device?.id || null,
        commands: heartbeat.commands,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
