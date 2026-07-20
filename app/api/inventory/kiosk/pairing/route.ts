import { NextRequest, NextResponse } from 'next/server';
import {
  expireKioskPairingCookie,
  getKioskPairingCookie,
  setKioskDeviceCookie,
  setKioskPairingCookie,
} from '@/lib/server/inventory-kiosk-device-cookies';
import {
  InventoryKioskDeviceError,
  getInventoryKioskPairingStatus,
  joinInventoryKioskPairing,
} from '@/lib/server/inventory-kiosk-devices';
import {
  createYardKioskDiagnosticId,
  mapPairingStatusToYardKioskErrorCode,
} from '@/lib/inventory/kiosk-errors';

function toPublicPayload(
  result: Awaited<ReturnType<typeof joinInventoryKioskPairing>>,
  diagnosticId: string,
) {
  const code = mapPairingStatusToYardKioskErrorCode(
    result.status,
    result.message,
  );
  return {
    status: result.status,
    pairing: result.pairing || null,
    message: result.message,
    code: code || undefined,
    diagnostic_id: diagnosticId,
  };
}

function readDiagnosticId(request: NextRequest): string {
  return request.headers.get('x-yard-kiosk-diagnostic-id')
    || createYardKioskDiagnosticId();
}

function errorResponse(error: unknown, diagnosticId: string) {
  const status = error instanceof InventoryKioskDeviceError ? error.status : 500;
  const message = error instanceof Error
    ? error.message
    : 'Unable to pair this Yard kiosk device';
  return NextResponse.json(
    {
      status: 'unavailable',
      error: message,
      code: mapPairingStatusToYardKioskErrorCode('unavailable', message),
      diagnostic_id: diagnosticId,
    },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export async function POST(request: NextRequest) {
  const diagnosticId = readDiagnosticId(request);
  try {
    const currentToken = getKioskPairingCookie(request);
    const result = await joinInventoryKioskPairing(currentToken);
    const response = NextResponse.json(toPublicPayload(result, diagnosticId), {
      headers: { 'Cache-Control': 'no-store' },
    });

    if (result.deviceToken && result.pairing) {
      setKioskPairingCookie(
        response,
        result.deviceToken,
        new Date(result.pairing.expires_at),
      );
    } else if (result.status === 'unavailable' || result.status === 'expired') {
      // Drop stale pairing cookies so the next Try again can claim cleanly
      // when a manager opens a fresh unpaired window.
      expireKioskPairingCookie(response);
    }
    return response;
  } catch (error) {
    return errorResponse(error, diagnosticId);
  }
}

export async function GET(request: NextRequest) {
  const diagnosticId = readDiagnosticId(request);
  try {
    const result = await getInventoryKioskPairingStatus(
      getKioskPairingCookie(request),
    );
    const response = NextResponse.json(toPublicPayload(result, diagnosticId), {
      headers: { 'Cache-Control': 'no-store' },
    });

    if (result.status === 'paired' && result.deviceToken) {
      setKioskDeviceCookie(response, result.deviceToken);
      expireKioskPairingCookie(response);
    } else if (result.status === 'expired' || result.status === 'unavailable') {
      expireKioskPairingCookie(response);
    }
    return response;
  } catch (error) {
    return errorResponse(error, diagnosticId);
  }
}
