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

function toPublicPayload(result: Awaited<ReturnType<typeof joinInventoryKioskPairing>>) {
  return {
    status: result.status,
    pairing: result.pairing || null,
    message: result.message,
  };
}

function errorResponse(error: unknown) {
  const status = error instanceof InventoryKioskDeviceError ? error.status : 500;
  return NextResponse.json(
    {
      status: 'unavailable',
      error: error instanceof Error
        ? error.message
        : 'Unable to pair this Yard kiosk device',
    },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export async function POST(request: NextRequest) {
  try {
    const currentToken = getKioskPairingCookie(request);
    const result = await joinInventoryKioskPairing(currentToken);
    const response = NextResponse.json(toPublicPayload(result), {
      headers: { 'Cache-Control': 'no-store' },
    });

    if (result.deviceToken && result.pairing) {
      setKioskPairingCookie(
        response,
        result.deviceToken,
        new Date(result.pairing.expires_at),
      );
    }
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const result = await getInventoryKioskPairingStatus(
      getKioskPairingCookie(request),
    );
    const response = NextResponse.json(toPublicPayload(result), {
      headers: { 'Cache-Control': 'no-store' },
    });

    if (result.status === 'paired' && result.deviceToken) {
      setKioskDeviceCookie(response, result.deviceToken);
      expireKioskPairingCookie(response);
    } else if (result.status === 'expired') {
      expireKioskPairingCookie(response);
    }
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
