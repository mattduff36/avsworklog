import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  validateAppSession,
  createAdminClient,
  revokeInventoryKioskDevice,
} = vi.hoisted(() => ({
  validateAppSession: vi.fn(),
  createAdminClient: vi.fn(),
  revokeInventoryKioskDevice: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  validateAppSession,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient,
}));

vi.mock('@/lib/server/inventory-kiosk-devices', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/inventory-kiosk-devices')>(
    '@/lib/server/inventory-kiosk-devices',
  );
  return {
    ...actual,
    revokeInventoryKioskDevice,
  };
});

import {
  issueInventoryKioskDeviceCommand,
  recordInventoryKioskDeviceHeartbeat,
} from '@/lib/server/inventory-kiosk-remote';
import { InventoryKioskDeviceError } from '@/lib/server/inventory-kiosk-devices';

function mockAdmin(handlers: Record<string, unknown>) {
  createAdminClient.mockReturnValue(handlers);
}

describe('Yard kiosk remote recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires confirmation before destructive commands', async () => {
    await expect(
      issueInventoryKioskDeviceCommand({
        managerUserId: 'manager-1',
        deviceId: 'device-1',
        commandType: 'reset_workflow',
        confirmedDestructive: false,
      }),
    ).rejects.toBeInstanceOf(InventoryKioskDeviceError);
  });

  it('returns revoked when the session has no active kiosk device', async () => {
    validateAppSession.mockResolvedValue({
      status: 'active',
      session: { kiosk_device_id: null },
      profileId: 'kiosk-user',
    });

    const result = await recordInventoryKioskDeviceHeartbeat({
      phase: 'mode',
      offline: false,
    });

    expect(result.revoked).toBe(true);
    expect(result.commands).toEqual([]);
  });

  it('issues idempotent commands for an active device', async () => {
    const insertSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'command-1',
        device_id: 'device-1',
        command_type: 'ping',
        status: 'pending',
        issued_at: '2026-07-20T12:00:00.000Z',
        expires_at: '2026-07-20T12:05:00.000Z',
        accepted_at: null,
        completed_at: null,
        failed_at: null,
        result_code: null,
        error_message: null,
      },
      error: null,
    });

    const maybeSingleExisting = vi.fn().mockResolvedValue({ data: null, error: null });
    const maybeSingleDevice = vi.fn().mockResolvedValue({
      data: {
        id: 'device-1',
        revoked_at: null,
      },
      error: null,
    });

    const from = vi.fn((table: string) => {
      if (table === 'inventory_kiosk_devices') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: maybeSingleDevice,
              }),
            }),
          }),
        };
      }
      if (table === 'inventory_kiosk_device_commands') {
        return {
          update: () => ({
            in: () => ({
              lt: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            }),
          }),
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: maybeSingleExisting,
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: insertSingle,
            }),
          }),
        };
      }
      return {};
    });

    mockAdmin({ from });

    const command = await issueInventoryKioskDeviceCommand({
      managerUserId: 'manager-1',
      deviceId: 'device-1',
      commandType: 'ping',
      confirmedDestructive: false,
      idempotencyKey: 'ping-1',
    });

    expect(command.id).toBe('command-1');
    expect(command.command_type).toBe('ping');
    expect(insertSingle).toHaveBeenCalled();
  });
});
