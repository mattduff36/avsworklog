import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  recordInventoryKioskDeviceHeartbeat,
  acknowledgeInventoryKioskDeviceCommand,
  recordInventoryKioskDeviceEvent,
  applyValidationCookieIfNeeded,
} = vi.hoisted(() => ({
  recordInventoryKioskDeviceHeartbeat: vi.fn(),
  acknowledgeInventoryKioskDeviceCommand: vi.fn(),
  recordInventoryKioskDeviceEvent: vi.fn(),
  applyValidationCookieIfNeeded: vi.fn(),
}));

vi.mock('@/lib/server/inventory-kiosk-remote', () => ({
  recordInventoryKioskDeviceHeartbeat,
  acknowledgeInventoryKioskDeviceCommand,
  recordInventoryKioskDeviceEvent,
}));

vi.mock('@/lib/server/app-auth/response', () => ({
  applyValidationCookieIfNeeded,
}));

import { POST as heartbeatPost } from '@/app/api/inventory/kiosk/heartbeat/route';

describe('Yard kiosk heartbeat route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns mutually exclusive DEVICE_REVOKED payload', async () => {
    recordInventoryKioskDeviceHeartbeat.mockResolvedValue({
      device: null,
      commands: [],
      revoked: true,
      sessionExpired: false,
      controlLease: null,
      diagnosticId: 'YK-REVOKED-TEST',
      sessionValidation: null,
    });

    const response = await heartbeatPost(
      new NextRequest('http://localhost/api/inventory/kiosk/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ phase: 'mode' }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.code).toBe('DEVICE_REVOKED');
    expect(payload.revoked).toBe(true);
    expect(payload.sessionExpired).toBe(false);
    expect(payload.diagnostic_id).toBe('YK-REVOKED-TEST');
  });

  it('returns mutually exclusive SESSION_EXPIRED payload', async () => {
    recordInventoryKioskDeviceHeartbeat.mockResolvedValue({
      device: null,
      commands: [],
      revoked: false,
      sessionExpired: true,
      controlLease: null,
      diagnosticId: 'YK-SESSION-TEST',
      sessionValidation: null,
    });

    const response = await heartbeatPost(
      new NextRequest('http://localhost/api/inventory/kiosk/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ phase: 'mode' }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.code).toBe('SESSION_EXPIRED');
    expect(payload.revoked).toBe(false);
    expect(payload.sessionExpired).toBe(true);
    expect(payload.diagnostic_id).toBe('YK-SESSION-TEST');
  });

  it('applies a rotated session cookie on successful heartbeat', async () => {
    const sessionValidation = {
      status: 'active',
      cookieValue: 'rotated-cookie',
      cookieExpiresAt: new Date('2026-10-01T00:00:00.000Z'),
      secretRotated: true,
    };
    recordInventoryKioskDeviceHeartbeat.mockResolvedValue({
      device: { id: 'device-1' },
      commands: [],
      revoked: false,
      sessionExpired: false,
      controlLease: null,
      diagnosticId: 'YK-OK-TEST',
      sessionValidation,
    });

    const response = await heartbeatPost(
      new NextRequest('http://localhost/api/inventory/kiosk/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ phase: 'mode' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(applyValidationCookieIfNeeded).toHaveBeenCalledWith(
      expect.anything(),
      sessionValidation,
    );
  });
});
