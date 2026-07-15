import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  validateAppSession,
  activateInventoryKioskDevice,
  hasActiveInventoryKioskPairing,
  trackServerUsageEvent,
} = vi.hoisted(() => ({
  validateAppSession: vi.fn(),
  activateInventoryKioskDevice: vi.fn(),
  hasActiveInventoryKioskPairing: vi.fn(),
  trackServerUsageEvent: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  validateAppSession,
}));

vi.mock('@/lib/server/inventory-kiosk-devices', () => ({
  activateInventoryKioskDevice,
  hasActiveInventoryKioskPairing,
}));

vi.mock('@/lib/server/user-analytics', () => ({
  trackServerUsageEvent,
}));

import { APP_SESSION_COOKIE_NAME } from '@/lib/server/app-auth/constants';
import {
  KIOSK_DEVICE_COOKIE_NAME,
} from '@/lib/server/inventory-kiosk-device-cookies';
import { GET as activateKiosk } from '@/app/yard-kiosk/activate/route';

describe('Yard kiosk trusted-device activation route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAppSession.mockResolvedValue({
      status: 'missing',
      session: null,
    });
    hasActiveInventoryKioskPairing.mockResolvedValue(false);
    trackServerUsageEvent.mockResolvedValue(undefined);
  });

  it('issues the dedicated app session and rotates the device cookie', async () => {
    activateInventoryKioskDevice.mockResolvedValue({
      device: {
        id: 'device-1',
        kiosk_user_id: 'kiosk-user-1',
      },
      nextToken: 'rotated-device-secret',
      appSession: {
        row: { id: 'session-1' },
        cookieValue: 'signed-app-session',
        cookieExpiresAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    const request = new NextRequest('http://localhost/yard-kiosk/activate', {
      headers: {
        Cookie: `${KIOSK_DEVICE_COOKIE_NAME}=current-device-secret`,
      },
    });

    const response = await activateKiosk(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/yard-kiosk');
    expect(activateInventoryKioskDevice).toHaveBeenCalledWith(
      'current-device-secret',
    );
    expect(response.cookies.get(APP_SESSION_COOKIE_NAME)?.value).toBe(
      'signed-app-session',
    );
    expect(response.cookies.get(KIOSK_DEVICE_COOKIE_NAME)?.value).toBe(
      'rotated-device-secret',
    );
    expect(trackServerUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'auth_login_success',
        userId: 'kiosk-user-1',
        appSessionId: 'session-1',
      }),
    );
  });

  it('routes an unpaired browser into an active manager pairing window', async () => {
    activateInventoryKioskDevice.mockResolvedValue(null);
    hasActiveInventoryKioskPairing.mockResolvedValue(true);

    const response = await activateKiosk(
      new NextRequest('http://localhost/yard-kiosk/activate'),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost/yard-kiosk/pair',
    );
  });

  it('preserves normal login when no pairing window or device credential exists', async () => {
    activateInventoryKioskDevice.mockResolvedValue(null);

    const response = await activateKiosk(
      new NextRequest('http://localhost/yard-kiosk/activate'),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost/login?redirect=%2Fyard-kiosk',
    );
  });

  it('never replaces an existing valid session', async () => {
    validateAppSession.mockResolvedValue({
      status: 'active',
      session: { id: 'existing-session' },
    });

    const response = await activateKiosk(
      new NextRequest('http://localhost/yard-kiosk/activate'),
    );

    expect(response.headers.get('location')).toBe('http://localhost/yard-kiosk');
    expect(activateInventoryKioskDevice).not.toHaveBeenCalled();
  });
});
