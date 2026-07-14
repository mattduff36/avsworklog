import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventoryAccess: vi.fn(),
  requireInventoryManagerAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/server/inventory-hardware', () => ({
  getResponsibleHardwareLocationIds: vi.fn(),
}));

import { GET, POST } from '@/app/api/inventory/hardware/route';
import { requireInventoryAccess, requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getResponsibleHardwareLocationIds } from '@/lib/server/inventory-hardware';

function buildResolvedQuery(data: unknown[]) {
  const result = { data, error: null };
  const query = {
    select: vi.fn(),
    order: vi.fn(),
    eq: vi.fn(),
    gt: vi.fn(),
    in: vi.fn(),
    then: (
      resolve: (value: typeof result) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  query.select.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.gt.mockReturnValue(query);
  query.in.mockReturnValue(query);
  return query;
}

describe('Inventory Hardware catalogue route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps zero-stock catalogue items while loading only positive location balances', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });

    const itemQuery = buildResolvedQuery([
      { id: 'cones', name: 'Cones', is_active: true },
      { id: 'fencing', name: 'Heras fencing', is_active: true },
    ]);
    const balanceQuery = buildResolvedQuery([
      { hardware_item_id: 'cones', location_id: 'yard', quantity: 5 },
    ]);
    vi.mocked(createAdminClient).mockReturnValue({
      from(table: string) {
        return table === 'inventory_hardware_items' ? itemQuery : balanceQuery;
      },
    } as never);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(itemQuery.order).toHaveBeenNthCalledWith(1, 'name', { ascending: true });
    expect(itemQuery.order).toHaveBeenNthCalledWith(2, 'id', { ascending: true });
    expect(balanceQuery.gt).toHaveBeenCalledWith('quantity', 0);
    expect(payload.items[0].total_quantity).toBe(5);
    expect(payload.items[0].can_delete).toBe(false);
    expect(payload.items[1]).toMatchObject({
      id: 'fencing',
      total_quantity: 0,
      can_delete: true,
    });
    expect(payload.balances).toHaveLength(1);
  });

  it('returns company-wide positive source balances to employees', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'employee-1',
      isManagerOrAdmin: false,
    });
    vi.mocked(getResponsibleHardwareLocationIds).mockResolvedValue(['van-location']);

    const itemQuery = buildResolvedQuery([
      { id: 'cones', name: 'Cones', is_active: true },
    ]);
    const balanceQuery = buildResolvedQuery([
      { hardware_item_id: 'cones', location_id: 'yard-location', quantity: 20 },
      { hardware_item_id: 'cones', location_id: 'van-location', quantity: 2 },
    ]);
    vi.mocked(createAdminClient).mockReturnValue({
      from(table: string) {
        return table === 'inventory_hardware_items' ? itemQuery : balanceQuery;
      },
    } as never);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(balanceQuery.in).not.toHaveBeenCalled();
    expect(payload.balances).toHaveLength(2);
    expect(payload.responsible_location_ids).toEqual(['van-location']);
  });

  it('does not accept or persist a client-provided sort order', async () => {
    vi.mocked(requireInventoryManagerAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'manager-1',
      isManagerOrAdmin: true,
    });

    const single = vi.fn().mockResolvedValue({
      data: { id: 'cones', name: 'Cones', is_active: true },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ insert })),
    } as never);

    const response = await POST(new NextRequest('http://localhost/api/inventory/hardware', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cones', sort_order: 999 }),
    }));

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith({
      name: 'Cones',
      created_by: 'manager-1',
      updated_by: 'manager-1',
    });
  });
});
