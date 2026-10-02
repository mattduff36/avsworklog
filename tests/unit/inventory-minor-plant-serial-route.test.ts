import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventoryManagerAccess: vi.fn(),
  requireInventoryAccess: vi.fn(),
  normalizeInventoryItemNumber: (value: string) => value.trim().toLowerCase(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/server/inventory-locations', () => ({
  pickInventoryLocationRelation: vi.fn(),
  withEnrichedInventoryLocation: vi.fn(async (_admin: unknown, item: unknown) => item),
  withEnrichedInventoryLocations: vi.fn(),
}));

vi.mock('@/lib/server/inventory-move', () => ({
  InventoryMoveError: class InventoryMoveError extends Error {},
  assertInventoryMoveCheckConfirmation: vi.fn(),
  moveInventoryItems: vi.fn(),
  prepareInventoryMove: vi.fn(),
  toInventoryMoveErrorResponse: vi.fn(),
}));

import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { POST } from '@/app/api/inventory/route';
import { PATCH } from '@/app/api/inventory/[id]/route';

describe('minor plant serial number routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireInventoryManagerAccess).mockResolvedValue({
      allowed: true,
      userId: 'user-1',
      status: 200,
    });
  });

  it('rejects an invalid serial number before creating an item', async () => {
    const response = await POST(new NextRequest('http://localhost/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_number: 'MP-1',
        name: 'Fuel station',
        location_id: 'loc-1',
        category: 'minor_plant',
        serial_number: 'AB-123',
      }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Serial Number must contain only letters and numbers',
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects an invalid serial number before updating an item', async () => {
    const response = await PATCH(new NextRequest('http://localhost/api/inventory/item-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: 'minor_plant',
        serial_number: 'AB-123',
      }),
    }), { params: Promise.resolve({ id: 'item-1' }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Serial Number must contain only letters and numbers',
    });
    expect(createAdminClient).toHaveBeenCalled();
  });
});
