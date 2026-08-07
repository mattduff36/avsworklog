import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventoryManagerAccess: vi.fn(),
  normalizeInventoryItemNumber: (value: string) => value.trim().toLowerCase(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/server/inventory-locations', () => ({
  withEnrichedInventoryLocation: vi.fn(async (_admin, item) => item),
}));

vi.mock('@/lib/server/inventory-move', () => ({
  InventoryMoveError: class InventoryMoveError extends Error {},
  moveInventoryItems: vi.fn(),
  toInventoryMoveErrorResponse: vi.fn(),
}));

import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { PATCH } from '@/app/api/inventory/[id]/route';

describe('INV-CHECK-PATCH-001 inventory item last checked protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireInventoryManagerAccess).mockResolvedValue({
      allowed: true,
      userId: 'user-1',
      status: 200,
    });
  });

  it('rejects last_checked_at updates when check history exists', async () => {
    const admin = {
      from(table: string) {
        if (table === 'inventory_check_history') {
          return {
            select() {
              return {
                eq() {
                  return Promise.resolve({ count: 2, error: null });
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await PATCH(
      new NextRequest('http://localhost/api/inventory/item-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_checked_at: '2026-06-01' }),
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVENTORY_LAST_CHECKED_HISTORY_LOCKED',
    });
  });

  it('allows last_checked_at updates for legacy items without history', async () => {
    const updatedRows: Array<Record<string, unknown>> = [];
    const admin = {
      from(table: string) {
        if (table === 'inventory_check_history') {
          return {
            select() {
              return {
                eq() {
                  return Promise.resolve({ count: 0, error: null });
                },
              };
            },
          };
        }

        if (table === 'inventory_items') {
          return {
            update(payload: Record<string, unknown>) {
              updatedRows.push(payload);
              return {
                eq() {
                  return {
                    select() {
                      return {
                        async single() {
                          return {
                            data: {
                              id: 'item-1',
                              location_id: 'loc-1',
                              last_checked_at: payload.last_checked_at,
                              minor_plant_detail: null,
                              location: { id: 'loc-1', name: 'Yard' },
                            },
                            error: null,
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }

        throw new Error(`Unexpected table ${table}`);
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await PATCH(
      new NextRequest('http://localhost/api/inventory/item-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_checked_at: '2026-06-01' }),
      }),
      { params: Promise.resolve({ id: 'item-1' }) },
    );

    expect(response.status).toBe(200);
    expect(updatedRows[0]).toMatchObject({
      last_checked_at: '2026-06-01',
      updated_by: 'user-1',
    });
  });
});
