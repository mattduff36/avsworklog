import type { NextRequest, NextResponse } from 'next/server';

const KIOSK_DEVICE_COOKIE_LOGICAL_NAME = 'yard_kiosk_device';
const KIOSK_PAIRING_COOKIE_LOGICAL_NAME = 'yard_kiosk_pairing';

export const KIOSK_DEVICE_COOKIE_NAME =
  process.env.NODE_ENV === 'production'
    ? `__Host-${KIOSK_DEVICE_COOKIE_LOGICAL_NAME}`
    : KIOSK_DEVICE_COOKIE_LOGICAL_NAME;

export const KIOSK_PAIRING_COOKIE_NAME =
  process.env.NODE_ENV === 'production'
    ? `__Host-${KIOSK_PAIRING_COOKIE_LOGICAL_NAME}`
    : KIOSK_PAIRING_COOKIE_LOGICAL_NAME;

export const KIOSK_DEVICE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

type CookieResponse = Pick<NextResponse, 'cookies'>;

function getCookieValue(
  request: NextRequest,
  primaryName: string,
  logicalName: string,
): string | null {
  return (
    request.cookies.get(primaryName)?.value
    || request.cookies.get(logicalName)?.value
    || null
  );
}

function getCookieAttributes(expires: Date) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
    priority: 'high' as const,
  };
}

export function getKioskDeviceCookie(request: NextRequest): string | null {
  return getCookieValue(
    request,
    KIOSK_DEVICE_COOKIE_NAME,
    KIOSK_DEVICE_COOKIE_LOGICAL_NAME,
  );
}

export function getKioskPairingCookie(request: NextRequest): string | null {
  return getCookieValue(
    request,
    KIOSK_PAIRING_COOKIE_NAME,
    KIOSK_PAIRING_COOKIE_LOGICAL_NAME,
  );
}

export function setKioskDeviceCookie(
  response: CookieResponse,
  value: string,
): void {
  const expiresAt = new Date(Date.now() + KIOSK_DEVICE_COOKIE_MAX_AGE_SECONDS * 1000);
  response.cookies.set(
    KIOSK_DEVICE_COOKIE_NAME,
    value,
    getCookieAttributes(expiresAt),
  );
}

export function setKioskPairingCookie(
  response: CookieResponse,
  value: string,
  expiresAt: Date,
): void {
  response.cookies.set(
    KIOSK_PAIRING_COOKIE_NAME,
    value,
    getCookieAttributes(expiresAt),
  );
}

function expireCookie(
  response: CookieResponse,
  primaryName: string,
  logicalName: string,
): void {
  const cookieNames = primaryName === logicalName
    ? [primaryName]
    : [primaryName, logicalName];

  cookieNames.forEach((cookieName) => {
    response.cookies.set(cookieName, '', {
      ...getCookieAttributes(new Date(0)),
      maxAge: 0,
    });
  });
}

export function expireKioskDeviceCookie(response: CookieResponse): void {
  expireCookie(
    response,
    KIOSK_DEVICE_COOKIE_NAME,
    KIOSK_DEVICE_COOKIE_LOGICAL_NAME,
  );
}

export function expireKioskPairingCookie(response: CookieResponse): void {
  expireCookie(
    response,
    KIOSK_PAIRING_COOKIE_NAME,
    KIOSK_PAIRING_COOKIE_LOGICAL_NAME,
  );
}
