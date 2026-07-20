import { NextRequest, NextResponse } from 'next/server';
import { setAppSessionCookieInResponse } from '@/lib/server/app-auth/cookies';
import { clearAllAuthCookies } from '@/lib/server/app-auth/response';
import { validateAppSession } from '@/lib/server/app-auth/session';
import {
  expireKioskDeviceCookie,
  getKioskDeviceCookie,
  setKioskDeviceCookie,
} from '@/lib/server/inventory-kiosk-device-cookies';
import {
  InventoryKioskDeviceError,
  activateInventoryKioskDevice,
  hasActiveInventoryKioskPairing,
} from '@/lib/server/inventory-kiosk-devices';
import { trackServerUsageEvent } from '@/lib/server/user-analytics';

function redirectTo(request: NextRequest, pathname: string): NextResponse {
  return NextResponse.redirect(new URL(pathname, request.url), 307);
}

function redirectWithClearedAuth(
  request: NextRequest,
  pathname: string,
  options: { expireDeviceCookie?: boolean } = {},
): NextResponse {
  const response = redirectTo(request, pathname);
  // Stale JWT cookies otherwise look "authenticated" in middleware while
  // validateAppSession rejects them, creating ERR_TOO_MANY_REDIRECTS.
  clearAllAuthCookies(request, response);
  if (options.expireDeviceCookie) {
    expireKioskDeviceCookie(response);
  }
  return response;
}

export async function GET(request: NextRequest) {
  const currentSession = await validateAppSession();
  if (currentSession.status === 'active') {
    return redirectTo(request, '/yard-kiosk');
  }

  const rawDeviceToken = getKioskDeviceCookie(request);
  try {
    const activation = await activateInventoryKioskDevice(rawDeviceToken);
    if (!activation) {
      const target = await hasActiveInventoryKioskPairing()
        ? '/yard-kiosk/pair'
        : '/yard-kiosk/recover?code=DEVICE_UNPAIRED';
      return redirectWithClearedAuth(request, target, {
        expireDeviceCookie: Boolean(rawDeviceToken),
      });
    }

    await trackServerUsageEvent({
      eventName: 'auth_login_success',
      userId: activation.device.kiosk_user_id,
      appSessionId: activation.appSession.row.id,
      request,
      path: '/yard-kiosk',
      metadata: {
        method: 'kiosk_device',
        kiosk_device_id: activation.device.id,
      },
    });

    const response = redirectTo(request, '/yard-kiosk');
    clearAllAuthCookies(request, response);
    setAppSessionCookieInResponse(
      response,
      activation.appSession.cookieValue,
      activation.appSession.cookieExpiresAt,
    );
    setKioskDeviceCookie(response, activation.nextToken);
    return response;
  } catch (error) {
    console.error('Yard kiosk trusted-device activation failed:', error);
    const isCredentialRace = error instanceof InventoryKioskDeviceError
      && error.status === 409;
    return redirectWithClearedAuth(
      request,
      isCredentialRace
        ? '/yard-kiosk/recover?code=DEVICE_CREDENTIAL_USED'
        : '/yard-kiosk/recover?code=ACTIVATION_FAILED',
      {
        // Keep the device cookie on a credential race so Try again can succeed.
        expireDeviceCookie: !isCredentialRace,
      },
    );
  }
}
