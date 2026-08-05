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

  it('returns sessionExpired when the session has no kiosk device link', async () => {
    validateAppSession.mockResolvedValue({
      status: 'active',
      session: { kiosk_device_id: null },
      profileId: 'kiosk-user',
      secretRotated: false,
      failureReason: null,
      kioskDeviceIdHint: null,
      cookieValue: null,
      cookieExpiresAt: null,
    });

    const result = await recordInventoryKioskDeviceHeartbeat({
      phase: 'mode',
      offline: false,
    });

    expect(result.revoked).toBe(false);
    expect(result.sessionExpired).toBe(true);
    expect(result.commands).toEqual([]);
    expect(result.diagnosticId.startsWith('YK-')).toBe(true);
  });

  it('returns sessionExpired for an invalid app session', async () => {
    validateAppSession.mockResolvedValue({
      status: 'invalid',
      session: null,
      profileId: null,
      secretRotated: false,
      failureReason: 'secret_mismatch',
      kioskDeviceIdHint: null,
      cookieValue: null,
      cookieExpiresAt: null,
    });

    const result = await recordInventoryKioskDeviceHeartbeat({
      phase: 'mode',
      offline: false,
    });

    expect(result.revoked).toBe(false);
    expect(result.sessionExpired).toBe(true);
  });

  it('returns DEVICE_REVOKED when the linked device is revoked', async () => {
    validateAppSession.mockResolvedValue({
      status: 'invalid',
      session: null,
      profileId: null,
      secretRotated: false,
      failureReason: 'kiosk_device_inactive',
      kioskDeviceIdHint: 'device-1',
      cookieValue: null,
      cookieExpiresAt: null,
    });

    const maybeSingleDevice = vi.fn().mockResolvedValue({
      data: {
        id: 'device-1',
        kiosk_user_id: 'kiosk-user',
        revoked_at: '2026-08-05T12:00:00.000Z',
      },
      error: null,
    });
    const insertEvent = vi.fn().mockResolvedValue({ error: null });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const updateDevice = vi.fn(() => ({
      eq: updateEq,
    }));

    mockAdmin({
      from: vi.fn((table: string) => {
        if (table === 'inventory_kiosk_devices') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: maybeSingleDevice,
              }),
            }),
            update: updateDevice,
          };
        }
        if (table === 'inventory_kiosk_device_events') {
          return { insert: insertEvent };
        }
        return {};
      }),
    });

    const result = await recordInventoryKioskDeviceHeartbeat({
      phase: 'mode',
      offline: false,
    });

    expect(result.revoked).toBe(true);
    expect(result.sessionExpired).toBe(false);
    expect(insertEvent).toHaveBeenCalledWith(expect.objectContaining({
      device_id: 'device-1',
      event_type: 'heartbeat_auth_failure',
      error_code: 'DEVICE_REVOKED',
      diagnostic_id: result.diagnosticId,
      message: 'Trusted Yard kiosk device is missing or revoked.',
    }));
    expect(updateDevice).toHaveBeenCalledWith({
      last_error_code: 'DEVICE_REVOKED',
      last_diagnostic_id: result.diagnosticId,
    });
    expect(updateEq).toHaveBeenCalledWith('id', 'device-1');
  });

  it('returns DEVICE_REVOKED after a manager revoke that marks the app session revoked', async () => {
    validateAppSession.mockResolvedValue({
      status: 'invalid',
      session: null,
      profileId: null,
      secretRotated: false,
      failureReason: 'session_revoked',
      kioskDeviceIdHint: 'device-1',
      cookieValue: null,
      cookieExpiresAt: null,
    });

    mockAdmin({
      from: vi.fn((table: string) => {
        if (table === 'inventory_kiosk_devices') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'device-1',
                    kiosk_user_id: 'kiosk-user',
                    revoked_at: '2026-08-05T12:00:00.000Z',
                  },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'inventory_kiosk_device_events') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) };
        }
        return {};
      }),
    });

    const result = await recordInventoryKioskDeviceHeartbeat({
      phase: 'mode',
      offline: false,
    });

    expect(result.revoked).toBe(true);
    expect(result.sessionExpired).toBe(false);
  });

  it('returns SESSION_EXPIRED when the device profile mismatches the session', async () => {
    validateAppSession.mockResolvedValue({
      status: 'active',
      session: { kiosk_device_id: 'device-1' },
      profileId: 'kiosk-user',
      secretRotated: false,
      failureReason: null,
      kioskDeviceIdHint: null,
      cookieValue: null,
      cookieExpiresAt: null,
    });

    mockAdmin({
      from: vi.fn((table: string) => {
        if (table === 'inventory_kiosk_devices') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'device-1',
                    kiosk_user_id: 'other-user',
                    revoked_at: null,
                    workflow_state_version: 1,
                  },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        }
        if (table === 'inventory_kiosk_device_events') {
          return { insert: vi.fn().mockResolvedValue({ error: null }) };
        }
        return {};
      }),
    });

    const result = await recordInventoryKioskDeviceHeartbeat({
      phase: 'mode',
      offline: false,
    });

    expect(result.revoked).toBe(false);
    expect(result.sessionExpired).toBe(true);
  });

  it('keeps auth outcome when diagnostic persistence fails', async () => {
    validateAppSession.mockResolvedValue({
      status: 'invalid',
      session: null,
      profileId: null,
      secretRotated: false,
      failureReason: 'session_expired',
      kioskDeviceIdHint: null,
      cookieValue: null,
      cookieExpiresAt: null,
    });

    mockAdmin({
      from: vi.fn(() => ({
        insert: vi.fn().mockRejectedValue(new Error('events down')),
      })),
    });

    const result = await recordInventoryKioskDeviceHeartbeat({
      phase: 'mode',
      offline: false,
    });

    expect(result.sessionExpired).toBe(true);
    expect(result.revoked).toBe(false);
    expect(result.diagnosticId.startsWith('YK-')).toBe(true);
  });

  it('returns a successful heartbeat for an active linked device', async () => {
    validateAppSession.mockResolvedValue({
      status: 'active',
      session: { kiosk_device_id: 'device-1' },
      profileId: 'kiosk-user',
      secretRotated: false,
      failureReason: null,
      kioskDeviceIdHint: null,
      cookieValue: null,
      cookieExpiresAt: null,
    });

    const device = {
      id: 'device-1',
      kiosk_user_id: 'kiosk-user',
      revoked_at: null,
      workflow_state_version: 1,
      control_session_id: null,
      control_holder_user_id: null,
      control_acquired_at: null,
      control_lease_expires_at: null,
    };

    const resolved = { error: null };
    const leaseChain = {
      eq: vi.fn(() => Promise.resolve(resolved)),
      then: (resolve: (value: typeof resolved) => unknown) => resolve(resolved),
    };

    mockAdmin({
      from: vi.fn((table: string) => {
        if (table === 'inventory_kiosk_devices') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({ data: device, error: null }),
              }),
            }),
            update: () => ({
              eq: () => ({
                is: () => ({
                  select: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: device, error: null }),
                  }),
                }),
              }),
              not: () => ({
                lt: () => leaseChain,
              }),
            }),
          };
        }
        if (table === 'inventory_kiosk_device_commands') {
          const commandExpireChain = {
            eq: vi.fn(() => Promise.resolve(resolved)),
            then: (resolve: (value: typeof resolved) => unknown) => resolve(resolved),
          };
          return {
            update: () => ({
              in: () => ({
                lt: () => commandExpireChain,
              }),
            }),
            select: () => ({
              eq: () => ({
                in: () => ({
                  gt: () => ({
                    order: () => ({
                      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    });

    const result = await recordInventoryKioskDeviceHeartbeat({
      phase: 'mode',
      offline: false,
    });

    expect(result.revoked).toBe(false);
    expect(result.sessionExpired).toBe(false);
    expect(result.device?.id).toBe('device-1');
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
