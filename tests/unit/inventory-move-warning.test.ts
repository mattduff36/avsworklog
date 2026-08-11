import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InventoryMoveError,
  assertInventoryMoveCheckConfirmation,
  moveInventoryItems,
  toInventoryMoveErrorResponse,
  type PreparedInventoryMove,
} from '@/lib/server/inventory-move';
import { INVENTORY_CHECK_WARNING_REQUIRED } from '@/lib/inventory/move-check-warning';

const itemId = '11111111-1111-4111-8111-111111111111';
const destinationId = '22222222-2222-4222-8222-222222222222';
const sourceId = '33333333-3333-4333-8333-333333333333';

function preparedMove(): PreparedInventoryMove {
  return {
    destinationLocationId: destinationId,
    scope: 'single',
    groupId: null,
    itemIds: [itemId],
    destinationLocation: {
      id: destinationId,
      name: 'Van 1',
      location_type: 'van',
      is_active: true,
    },
    warningItems: [{
      id: itemId,
      item_number: 'TOOL-001',
      name: 'Breaker',
      check_status: 'needs_check',
    }],
  };
}

function createAdminMock() {
  const rpc = vi.fn().mockResolvedValue({
    data: [{ movement_batch_id: '44444444-4444-4444-8444-444444444444' }],
    error: null,
  });
  const from = vi.fn((table: string) => {
    if (table === 'inventory_locations') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: destinationId,
                name: 'Van 1',
                location_type: 'van',
                is_active: true,
              },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === 'inventory_items') {
      return {
        select: () => ({
          in: () => ({
            eq: async () => ({
              data: [{
                id: itemId,
                item_number: 'TOOL-001',
                name: 'Breaker',
                category: 'tools',
                last_checked_at: null,
                check_interval_days: 180,
                location: {
                  id: sourceId,
                  name: 'Yard',
                  location_type: 'yard',
                },
              }],
              error: null,
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  return { admin: { from, rpc }, rpc };
}

describe('Inventory move check warning contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('INV-WARN-02 returns a typed warning and performs no movement RPC', async () => {
    const { admin, rpc } = createAdminMock();

    await expect(moveInventoryItems(admin as never, {
      itemIds: [itemId],
      destinationLocationId: destinationId,
      movedBy: '55555555-5555-4555-8555-555555555555',
    })).rejects.toMatchObject({
      status: 409,
      code: INVENTORY_CHECK_WARNING_REQUIRED,
      warningItems: [expect.objectContaining({ id: itemId })],
      moveItemIds: [itemId],
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('INV-WARN-03 accepts only a confirmation bound to current warning and move ids', () => {
    const prepared = preparedMove();

    expect(() => assertInventoryMoveCheckConfirmation(prepared, {
      warning_item_ids: [itemId],
      move_item_ids: [itemId],
    })).not.toThrow();

    expect(() => assertInventoryMoveCheckConfirmation(prepared, {
      warning_item_ids: [itemId],
      move_item_ids: [destinationId],
    })).toThrowError(InventoryMoveError);

    expect(() => assertInventoryMoveCheckConfirmation(prepared, {
      warning_item_ids: [itemId, destinationId],
      move_item_ids: [itemId],
    })).toThrowError(InventoryMoveError);
  });

  it('INV-WARN-03 moves after a valid bound confirmation', async () => {
    const { admin, rpc } = createAdminMock();

    await expect(moveInventoryItems(admin as never, {
      itemIds: [itemId],
      destinationLocationId: destinationId,
      movedBy: '55555555-5555-4555-8555-555555555555',
      checkWarningConfirmation: {
        warning_item_ids: [itemId],
        move_item_ids: [itemId],
      },
    })).resolves.toEqual({
      moved_count: 1,
      movement_batch_id: '44444444-4444-4444-8444-444444444444',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('INV-WARN-02 serializes the public warning response contract', () => {
    const error = new InventoryMoveError('Confirm warning', 409, {
      code: INVENTORY_CHECK_WARNING_REQUIRED,
      warningItems: preparedMove().warningItems,
      moveItemIds: [itemId],
    });

    expect(toInventoryMoveErrorResponse(error)).toEqual({
      status: 409,
      body: {
        error: 'Confirm warning',
        code: INVENTORY_CHECK_WARNING_REQUIRED,
        warning_items: preparedMove().warningItems,
        move_item_ids: [itemId],
      },
    });
  });

  it('rejects malformed confirmation arrays as a validation error', () => {
    expect(() => assertInventoryMoveCheckConfirmation(preparedMove(), {
      warning_item_ids: [123],
      move_item_ids: [itemId],
    })).toThrowError(expect.objectContaining({
      name: 'InventoryMoveError',
      status: 400,
    }));
  });

  it('INV-MOVE-04 preflights item edits before the update write', () => {
    const routeSource = readFileSync(
      join(process.cwd(), 'app/api/inventory/[id]/route.ts'),
      'utf8',
    );

    expect(routeSource.indexOf('prepareInventoryMove(admin, moveInput)')).toBeGreaterThan(-1);
    expect(routeSource.indexOf('prepareInventoryMove(admin, moveInput)'))
      .toBeLessThan(routeSource.indexOf('.update(update)'));
  });
});
