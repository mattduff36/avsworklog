import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { setAppSessionCookieInResponse } from '@/lib/server/app-auth/cookies';
import { clearAllAuthCookies } from '@/lib/server/app-auth/response';
import { expireKioskPairingCookie } from '@/lib/server/inventory-kiosk-device-cookies';
import {
  authenticateInventoryKioskHardware,
  InventoryKioskHardwareError,
} from '@/lib/server/inventory-kiosk-device-auth';

const authenticationSchema = z.object({
  device_id: z.string().uuid(),
  challenge_id: z.string().uuid(),
  challenge: z.string().min(40).max(48),
  expires_at: z.string().datetime({ offset: true }),
  signature: z.string().min(64).max(256),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const body = authenticationSchema.parse(await request.json());
    const authentication = await authenticateInventoryKioskHardware({
      deviceId: body.device_id,
      challengeId: body.challenge_id,
      challenge: body.challenge,
      expiresAt: body.expires_at,
      signature: body.signature,
    });
    const response = NextResponse.json(
      {
        authenticated: true,
        device_id: authentication.device.id,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
    clearAllAuthCookies(request, response);
    expireKioskPairingCookie(response);
    setAppSessionCookieInResponse(
      response,
      authentication.appSession.cookieValue,
      authentication.appSession.cookieExpiresAt,
    );
    return response;
  } catch (error) {
    const status = error instanceof InventoryKioskHardwareError
      ? error.status
      : error instanceof z.ZodError
        ? 400
        : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to authenticate kiosk hardware',
        code: error instanceof InventoryKioskHardwareError
          ? error.code
          : 'ANDROID_AUTHENTICATION_FAILED',
      },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
