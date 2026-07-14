import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventoryManagerAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { DELETE } from '@/app/api/inventory/hardware/[id]/route';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { createAdminClient } from '@/lib/supabase/admin';

function buildDeleteContext(id = 'item-1') {
  return {
    params: Promise.resolve({ id }),
  };
}

function buildAdminClient({
  balanceCount = 0,
  transactionCount = 0,
}: {
  balanceCount?: number;
  transactionCount?: number;
} = {}) {
  const currentSingle = vi.fn().mockResolvedValue({
    data: { id: 'item-1' },
    error: null,
  });
  const currentEq = vi.fn(() => ({ single: currentSingle }));
  const currentSelect = vi.fn(() => ({ eq: currentEq }));
  const deleteEq = vi.fn().mockResolvedValue({ error: null });
  const deleteItem = vi.fn(() => ({ eq: deleteEq }));
  const balanceEq = vi.fn().mockResolvedValue({ count: balanceCount, error: null });
  const balanceSelect = vi.fn(() => ({ eq: balanceEq }));
  const transactionEq = vi.fn().mockResolvedValue({ count: transactionCount, error: null });
  const transactionSelect = vi.fn(() => ({ eq: transactionEq }));

  const from = vi.fn((table: string) => {
    if (table === 'inventory_hardware_items') {
      return { select: currentSelect, delete: deleteItem };
    }
    if (table === 'inventory_hardware_balances') {
      return { select: balanceSelect };
    }
    return { select: transactionSelect };
  });

  return {
    client: { from },
    deleteItem,
    deleteEq,
  };
}

describe('Inventory Hardware item route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires manager access to delete a catalogue item', async () => {
    vi.mocked(requireInventoryManagerAccess).mockResolvedValue({
      allowed: false,
      status: 403,
      error: 'Manager or admin access required',
    });

    const response = await DELETE(
      new NextRequest('http://localhost/api/inventory/hardware/item-1', { method: 'DELETE' }),
      buildDeleteContext(),
    );

    expect(response.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects deletion when stock balances or audit history reference the item', async () => {
    vi.mocked(requireInventoryManagerAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });
    const { client, deleteItem } = buildAdminClient({ balanceCount: 1 });
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    const response = await DELETE(
      new NextRequest('http://localhost/api/inventory/hardware/item-1', { method: 'DELETE' }),
      buildDeleteContext(),
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toMatch(/balances or audit history/i);
    expect(deleteItem).not.toHaveBeenCalled();
  });

  it('permanently deletes an unused catalogue item', async () => {
    vi.mocked(requireInventoryManagerAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });
    const { client, deleteEq } = buildAdminClient();
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    const response = await DELETE(
      new NextRequest('http://localhost/api/inventory/hardware/item-1', { method: 'DELETE' }),
      buildDeleteContext(),
    );

    expect(response.status).toBe(200);
    expect(deleteEq).toHaveBeenCalledWith('id', 'item-1');
  });
});
