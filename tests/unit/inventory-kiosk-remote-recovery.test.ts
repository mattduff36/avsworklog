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
  validateYardKioskControlAction,
  validateYardKioskWorkflowSnapshot,
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

  it('validates bounded workflow snapshots and control actions', () => {
    const snapshot = {
      schema_version: 1 as const,
      revision: 4,
      state: { phase: 'mode', stock: [], basket: [] },
      bootstrap: {
        configured: true as const,
        yard: {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Yard',
          description: null,
          location_type: 'yard' as const,
          source_type: null,
          external_reference: null,
          primary_user_names: [],
          secondary_user_names: [],
        },
        locations: [],
        categories: [],
      },
      locations: [],
      offline: false,
      location_ui: {
        query: '',
        active_filter: 'all' as const,
        page_index: 0,
        include_legacy_quotes: false,
        recent_ids: [],
        pinned_ids: [],
      },
      item_ui: {
        page_index: 0,
        hardware_item_id: null,
        hardware_quantity: 1,
      },
      recorded_at: '2026-07-22T12:00:00.000Z',
    };

    expect(validateYardKioskWorkflowSnapshot(snapshot)).toEqual(snapshot);
    expect(validateYardKioskControlAction({
      type: 'select_location',
      location_id: '22222222-2222-4222-8222-222222222222',
    })).toEqual({
      type: 'select_location',
      location_id: '22222222-2222-4222-8222-222222222222',
    });
    expect(() => validateYardKioskControlAction({
      type: 'set_hardware_quantity',
      item_id: 'not-a-uuid',
      quantity: 2,
    })).toThrow('Unsupported or invalid kiosk control action');
    expect(() => validateYardKioskWorkflowSnapshot({
      ...snapshot,
      state: { payload: 'x'.repeat(600 * 1024) },
    })).toThrow('Invalid or oversized kiosk workflow snapshot');
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
