import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INVENTORY_CHECK_WARNING_REQUIRED } from '@/lib/inventory/move-check-warning';

const yardId = '11111111-1111-4111-8111-111111111111';
const counterpartId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const actorId = '44444444-4444-4444-8444-444444444444';
const hardwareId = '77777777-7777-4777-8777-777777777777';

const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}));

import {
  InventoryKioskError,
  submitYardKioskBasket,
  validateYardKioskSubmitPayload,
  type InventoryKioskAccessResult,
} from '@/lib/server/inventory-kiosk';

const access: InventoryKioskAccessResult = {
  allowed: true,
  status: 200,
  userId: actorId,
  yard: {
    id: yardId,
    name: 'Yard',
    description: null,
    location_type: 'yard',
    source_type: 'system',
    external_reference: null,
    is_active: true,
  },
};

function createAdminMock() {
  const rpc = vi.fn().mockResolvedValue({
    data: [{
      kiosk_batch_id: '55555555-5555-4555-8555-555555555555',
      movement_batch_id: '66666666-6666-4666-8666-666666666666',
      hardware_batch_id: null,
      serialized_count: 1,
      hardware_line_count: 0,
    }],
    error: null,
  });
  const from = vi.fn((table: string) => {
    if (table === 'inventory_locations') {
      const locationChain = {
        eq: () => locationChain,
        neq: () => locationChain,
        not: () => locationChain,
        single: async () => ({
          data: {
            id: counterpartId,
            name: 'Van 1',
            description: null,
            location_type: 'van',
            source_type: 'fleet',
            external_reference: null,
            is_active: true,
          },
          error: null,
        }),
      };
      return {
        select: () => locationChain,
      };
    }
    if (table === 'inventory_items') {
      return {
        select: () => ({
          in: () => {
            let eqCount = 0;
            const itemChain = {
              eq: () => {
                eqCount += 1;
                if (eqCount === 2) {
                  return Promise.resolve({
                    data: [{
                      id: itemId,
                      item_number: 'TOOL-001',
                      name: 'Breaker',
                      category: 'tools',
                      last_checked_at: null,
                      check_interval_days: 180,
                    }],
                    error: null,
                  });
                }
                return itemChain;
              },
            };
            return itemChain;
          },
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  return { admin: { from, rpc }, rpc };
}

function requestPayload() {
  return {
    direction: 'take',
    counterpart_location_id: counterpartId,
    serialized_item_ids: [itemId],
    hardware_lines: [{ item_id: hardwareId, quantity: 1 }],
  };
}

describe('Yard kiosk inventory check warning contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('INV-KIOSK-07 returns a warning before the transfer RPC', async () => {
    const { admin, rpc } = createAdminMock();
    createAdminClientMock.mockReturnValue(admin);

    await expect(submitYardKioskBasket(access, requestPayload())).rejects.toMatchObject({
      status: 409,
      code: INVENTORY_CHECK_WARNING_REQUIRED,
      warningItems: [expect.objectContaining({ id: itemId })],
      moveItemIds: [itemId, hardwareId],
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('INV-KIOSK-07 executes only after a matching confirmation', async () => {
    const { admin, rpc } = createAdminMock();
    createAdminClientMock.mockReturnValue(admin);

    await expect(submitYardKioskBasket(access, {
      ...requestPayload(),
      check_warning_confirmation: {
        warning_item_ids: [itemId],
        move_item_ids: [itemId, hardwareId],
      },
    })).resolves.toMatchObject({
      serialized_count: 1,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed warning confirmation ids', () => {
    expect(() => validateYardKioskSubmitPayload({
      ...requestPayload(),
      check_warning_confirmation: {
        warning_item_ids: ['not-a-uuid'],
        move_item_ids: [itemId, hardwareId],
      },
    })).toThrow(InventoryKioskError);
  });
});
