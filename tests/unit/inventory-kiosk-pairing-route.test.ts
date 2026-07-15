import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  joinInventoryKioskPairing,
  getInventoryKioskPairingStatus,
} = vi.hoisted(() => ({
  joinInventoryKioskPairing: vi.fn(),
  getInventoryKioskPairingStatus: vi.fn(),
}));

vi.mock('@/lib/server/inventory-kiosk-devices', () => ({
  InventoryKioskDeviceError: class InventoryKioskDeviceError extends Error {
    status: number;

    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  },
  joinInventoryKioskPairing,
  getInventoryKioskPairingStatus,
}));

import {
  KIOSK_DEVICE_COOKIE_NAME,
  KIOSK_PAIRING_COOKIE_NAME,
} from '@/lib/server/inventory-kiosk-device-cookies';
import {
  GET as getPairingStatus,
  POST as joinPairing,
} from '@/app/api/inventory/kiosk/pairing/route';

const pairing = {
  id: 'pairing-1',
  device_label: 'Yard Tablet 1',
  confirmation_code: '123456',
  status: 'active' as const,
  candidate_seen_at: '2026-07-15T16:00:00.000Z',
  expires_at: '2026-07-15T16:05:00.000Z',
};

describe('Inventory kiosk public pairing route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the raw pairing credential out of JSON and stores it HttpOnly', async () => {
    joinInventoryKioskPairing.mockResolvedValue({
      status: 'pairing',
      pairing,
      deviceToken: 'raw-pairing-secret',
    });

    const response = await joinPairing(
      new NextRequest('http://localhost/api/inventory/kiosk/pairing', {
        method: 'POST',
      }),
    );
    const payload = await response.json();
    const pairingCookie = response.cookies.get(KIOSK_PAIRING_COOKIE_NAME);

    expect(payload).toEqual({
      status: 'pairing',
      pairing,
    });
    expect(JSON.stringify(payload)).not.toContain('raw-pairing-secret');
    expect(pairingCookie?.value).toBe('raw-pairing-secret');
    expect(pairingCookie?.httpOnly).toBe(true);
    expect(pairingCookie?.sameSite).toBe('strict');
    expect(pairingCookie?.path).toBe('/');
  });

  it('exchanges a confirmed pairing cookie for a persistent device cookie', async () => {
    getInventoryKioskPairingStatus.mockResolvedValue({
      status: 'paired',
      deviceToken: 'raw-pairing-secret',
    });
    const request = new NextRequest(
      'http://localhost/api/inventory/kiosk/pairing',
      {
        headers: {
          Cookie: `${KIOSK_PAIRING_COOKIE_NAME}=raw-pairing-secret`,
        },
      },
    );

    const response = await getPairingStatus(request);
    const payload = await response.json();
    const deviceCookie = response.cookies.get(KIOSK_DEVICE_COOKIE_NAME);
    const expiredPairingCookie = response.cookies.get(KIOSK_PAIRING_COOKIE_NAME);

    expect(getInventoryKioskPairingStatus).toHaveBeenCalledWith(
      'raw-pairing-secret',
    );
    expect(payload).toEqual({
      status: 'paired',
      pairing: null,
    });
    expect(deviceCookie?.value).toBe('raw-pairing-secret');
    expect(deviceCookie?.httpOnly).toBe(true);
    expect(deviceCookie?.sameSite).toBe('strict');
    expect(expiredPairingCookie?.value).toBe('');
    expect(expiredPairingCookie?.maxAge).toBe(0);
  });
});
