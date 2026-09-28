import { NextRequest, NextResponse } from 'next/server';
import { applyValidationCookieIfNeeded } from '@/lib/server/app-auth/response';
import { InventoryKioskDeviceError } from '@/lib/server/inventory-kiosk-devices';
import {
  InventoryKioskHardwareError,
  verifyInventoryKioskRequestProof,
} from '@/lib/server/inventory-kiosk-device-auth';
import {
  acknowledgeInventoryKioskDeviceCommand,
  recordInventoryKioskDeviceEvent,
  recordInventoryKioskDeviceHeartbeat,
} from '@/lib/server/inventory-kiosk-remote';
import type { YardKioskHeartbeatInput } from '@/lib/inventory/kiosk-remote-types';

function errorResponse(
  error: unknown,
  proof: Awaited<ReturnType<typeof verifyInventoryKioskRequestProof>> | null,
) {
  const status = error instanceof InventoryKioskDeviceError
    || error instanceof InventoryKioskHardwareError
    ? error.status
    : 500;
  const response = NextResponse.json(
    {
      error: error instanceof Error ? error.message : 'Heartbeat failed',
      code: error instanceof InventoryKioskHardwareError
        ? error.code
        : status === 401
          ? 'SESSION_EXPIRED'
          : 'SERVICE_UNAVAILABLE',
      revoked: error instanceof InventoryKioskHardwareError
        && error.code === 'DEVICE_REVOKED',
      sessionExpired: status === 401
        && !(error instanceof InventoryKioskHardwareError
          && error.code === 'DEVICE_REVOKED'),
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
  if (proof) applyValidationCookieIfNeeded(response, proof.sessionValidation);
  return response;
}

export async function POST(request: NextRequest) {
  let proof: Awaited<ReturnType<typeof verifyInventoryKioskRequestProof>> | null = null;
  try {
    const bodyText = await request.text();
    proof = await verifyInventoryKioskRequestProof(request, bodyText);
    const body = JSON.parse(bodyText) as YardKioskHeartbeatInput & {
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

    const heartbeat = await recordInventoryKioskDeviceHeartbeat(
      {
        phase: body.phase,
        offline: body.offline,
        app_version: body.app_version,
        deployment_id: body.deployment_id,
        last_error_code: body.last_error_code,
        diagnostic_id: body.diagnostic_id,
        workflow_snapshot: body.workflow_snapshot,
      },
      { sessionValidation: proof.sessionValidation },
    );

    if (heartbeat.revoked) {
      const response = NextResponse.json(
        {
          revoked: true,
          sessionExpired: false,
          commands: [],
          code: 'DEVICE_REVOKED',
          diagnostic_id: heartbeat.diagnosticId,
        },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
      applyValidationCookieIfNeeded(response, proof.sessionValidation);
      return response;
    }

    if (heartbeat.sessionExpired) {
      const response = NextResponse.json(
        {
          revoked: false,
          sessionExpired: true,
          commands: [],
          code: 'SESSION_EXPIRED',
          diagnostic_id: heartbeat.diagnosticId,
        },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
      applyValidationCookieIfNeeded(response, proof.sessionValidation);
      return response;
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

    const response = NextResponse.json(
      {
        success: true,
        revoked: false,
        sessionExpired: false,
        device_id: heartbeat.device?.id || null,
        commands: heartbeat.commands,
        control_lease: heartbeat.controlLease,
        diagnostic_id: heartbeat.diagnosticId,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );

    if (heartbeat.sessionValidation) {
      applyValidationCookieIfNeeded(response, heartbeat.sessionValidation);
    }

    return response;
  } catch (error) {
    return errorResponse(error, proof);
  }
}
