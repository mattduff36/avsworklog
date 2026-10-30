import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventoryAccess: vi.fn(),
  requireInventoryManagerAccess: vi.fn(),
  normalizeInventoryItemNumber: (value: string) => value.toUpperCase().replace(/\s+/g, '').trim(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/server/inventory-locations', () => ({
  pickInventoryLocationRelation: vi.fn(),
  withEnrichedInventoryLocation: vi.fn(),
  withEnrichedInventoryLocations: vi.fn(),
}));

vi.mock('@/lib/server/inventory-source-location-hints', () => ({
  loadInventorySourceLocationHints: vi.fn(),
}));

import { requireInventoryAccess } from '@/lib/server/inventory-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { withEnrichedInventoryLocations } from '@/lib/server/inventory-locations';
import { loadInventorySourceLocationHints } from '@/lib/server/inventory-source-location-hints';
import { GET } from '@/app/api/inventory/route';

function retiredCountRequest(): NextRequest {
  return new NextRequest('http://localhost/api/inventory?status=retired&count=exact');
}

function countClient(result: { count: number | null; error: { message: string } | null }) {
  const eq = vi.fn(async () => result);
  const select = vi.fn(() => ({ eq }));
  return {
    eq,
    select,
    client: {
      from(table: string) {
        if (table !== 'inventory_items') throw new Error(`unexpected table ${table}`);
        return { select };
      },
    },
  };
}

describe('GET /api/inventory retired count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the exact retired count for a manager without loading rows', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      userId: 'manager-1',
      status: 200,
      isManagerOrAdmin: true,
    });
    const admin = countClient({ count: 4, error: null });
    vi.mocked(createAdminClient).mockReturnValue(admin.client as never);

    const response = await GET(retiredCountRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 4 });
    expect(admin.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(admin.eq).toHaveBeenCalledWith('status', 'retired');
    expect(withEnrichedInventoryLocations).not.toHaveBeenCalled();
    expect(loadInventorySourceLocationHints).not.toHaveBeenCalled();
  });

  it('returns an empty count without an inventory payload', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      userId: 'manager-1',
      status: 200,
      isManagerOrAdmin: true,
    });
    vi.mocked(createAdminClient).mockReturnValue(countClient({ count: 0, error: null }).client as never);

    const response = await GET(retiredCountRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 0 });
  });

  it('denies retired counts before querying when inventory access is missing', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: false,
      status: 401,
      error: 'Unauthorized',
    });

    const response = await GET(retiredCountRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(withEnrichedInventoryLocations).not.toHaveBeenCalled();
  });

  it('denies retired counts for authenticated non-managers', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      userId: 'staff-1',
      status: 200,
      isManagerOrAdmin: false,
    });

    const response = await GET(retiredCountRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Manager or admin access required' });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(withEnrichedInventoryLocations).not.toHaveBeenCalled();
  });
});
