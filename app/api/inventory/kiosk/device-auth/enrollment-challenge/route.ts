import { NextRequest, NextResponse } from 'next/server';
import { getKioskPairingCookie } from '@/lib/server/inventory-kiosk-device-cookies';
import {
  InventoryKioskHardwareError,
  issueInventoryKioskEnrollmentChallenge,
} from '@/lib/server/inventory-kiosk-device-auth';

export async function POST(request: NextRequest) {
  try {
    const challenge = await issueInventoryKioskEnrollmentChallenge(
      getKioskPairingCookie(request),
    );
    return NextResponse.json(challenge, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const status = error instanceof InventoryKioskHardwareError ? error.status : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to create enrollment challenge',
        code: error instanceof InventoryKioskHardwareError
          ? error.code
          : 'HARDWARE_CHALLENGE_FAILED',
      },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
