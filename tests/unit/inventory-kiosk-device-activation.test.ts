import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAdminClient, issueAppSession } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  issueAppSession: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient,
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  issueAppSession,
}));

vi.mock('@/lib/server/app-auth/constants', () => ({
  getAppSessionHashSecret: () => 'test-kiosk-hash-secret',
}));

import { activateInventoryKioskDevice } from '@/lib/server/inventory-kiosk-devices';

describe('Yard kiosk trusted-device activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the trusted-device credential stable across activation', async () => {
    const updateDevice = vi.fn();
    const maybeSingleDevice = vi.fn().mockResolvedValue({
      data: {
        id: 'device-1',
        kiosk_user_id: 'kiosk-user-1',
        revoked_at: null,
      },
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === 'inventory_kiosk_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: {
                  kiosk_user_id: 'kiosk-user-1',
                  is_enabled: true,
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'inventory_kiosk_devices') {
        return {
          update: (payload: Record<string, unknown>) => {
            updateDevice(payload);
            return {
              eq: () => ({
                eq: () => ({
                  is: () => ({
                    select: () => ({
                      maybeSingle: maybeSingleDevice,
                    }),
                  }),
                }),
              }),
            };
          },
        };
      }

      return {};
    });
    createAdminClient.mockReturnValue({ from });
    issueAppSession.mockResolvedValue({
      row: { id: 'session-1' },
      cookieValue: 'signed-session',
      cookieExpiresAt: new Date('2026-10-01T00:00:00.000Z'),
    });

    const activation = await activateInventoryKioskDevice(
      'stable-device-secret',
    );

    expect(activation?.deviceToken).toBe('stable-device-secret');
    expect(updateDevice).toHaveBeenCalledWith({
      last_seen_at: expect.any(String),
      last_authenticated_at: expect.any(String),
    });
    expect(updateDevice.mock.calls[0]?.[0]).not.toHaveProperty(
      'device_token_hash',
    );
  });
});
