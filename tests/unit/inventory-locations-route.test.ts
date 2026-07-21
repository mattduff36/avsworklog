import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventoryAccess: vi.fn(),
  requireInventoryManagerAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/server/inventory-locations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/inventory-locations')>(
    '@/lib/server/inventory-locations',
  );
  return {
    ...actual,
    listInventoryLocations: vi.fn(),
    enrichInventoryLocations: vi.fn(),
  };
});

import { requireInventoryAccess } from '@/lib/server/inventory-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  enrichInventoryLocations,
  listInventoryLocations,
} from '@/lib/server/inventory-locations';
import { GET } from '@/app/api/inventory/locations/route';

function buildLocation(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    is_active: true,
    linked_van_id: null,
    linked_hgv_id: null,
    linked_plant_id: null,
    location_type: 'yard' as const,
    source_type: 'system' as const,
    source_id: null,
    external_reference: null,
    sync_status: 'synced' as const,
    source_synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    updated_by: null,
  };
}

function buildYardLookupQuery<T>(data: T[]) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data, error: null });
  return query;
}

describe('inventory locations route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'admin-user',
      isManagerOrAdmin: true,
    });
  });

  it('returns the first paginated directory page without requiring search text', async () => {
    const yard = buildLocation('yard-location', 'Main Yard');
    const admin = {};
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    vi.mocked(listInventoryLocations).mockResolvedValue({
      locations: [yard],
      total: 51,
    });
    vi.mocked(enrichInventoryLocations).mockResolvedValue([{
      ...yard,
      item_count: 2,
      assigned_user_names: [],
      linked_asset_type: null,
      linked_asset_label: null,
      linked_asset_nickname: null,
    }]);

    const response = await GET(new NextRequest(
      'http://localhost/api/inventory/locations?limit=50&offset=0',
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(listInventoryLocations).toHaveBeenCalledWith(admin, {
      search: '',
      includeLegacyQuotes: false,
      limit: 50,
      offset: 0,
    });
    expect(payload.locations).toEqual([
      expect.objectContaining({ id: yard.id, item_count: 2 }),
    ]);
    expect(payload.pagination).toEqual({
      offset: 0,
      limit: 50,
      total: 51,
      has_more: true,
    });
  });

  it('accepts one-character search, offset, limit, and legacy opt-in', async () => {
    const admin = {};
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    vi.mocked(listInventoryLocations).mockResolvedValue({
      locations: [],
      total: 0,
    });
    vi.mocked(enrichInventoryLocations).mockResolvedValue([]);

    const response = await GET(new NextRequest(
      'http://localhost/api/inventory/locations?search=v&limit=25&offset=50&includeLegacyQuotes=true',
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(listInventoryLocations).toHaveBeenCalledWith(admin, {
      search: 'v',
      includeLegacyQuotes: true,
      limit: 25,
      offset: 50,
    });
    expect(payload.pagination).toEqual({
      offset: 50,
      limit: 25,
      total: 0,
      has_more: false,
    });
  });

  it('returns one exact active Yard lookup by stable id', async () => {
    const yard = buildLocation('yard-stable-id', 'Yard');
    const locationQuery = buildYardLookupQuery([yard]);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => locationQuery),
    } as never);

    const response = await GET(new NextRequest(
      'http://localhost/api/inventory/locations?lookup=yard',
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(locationQuery.eq).toHaveBeenNthCalledWith(1, 'name', 'Yard');
    expect(locationQuery.eq).toHaveBeenNthCalledWith(2, 'location_type', 'yard');
    expect(locationQuery.eq).toHaveBeenNthCalledWith(3, 'is_active', true);
    expect(locationQuery.order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: true });
    expect(locationQuery.order).toHaveBeenNthCalledWith(2, 'id', { ascending: true });
    expect(locationQuery.limit).toHaveBeenCalledWith(2);
    expect(payload.location).toEqual(expect.objectContaining({
      id: 'yard-stable-id',
      name: 'Yard',
      is_active: true,
    }));
  });

  it('leaves the Yard lookup unselected when matching rows are ambiguous', async () => {
    const locationQuery = buildYardLookupQuery([
      buildLocation('yard-one', 'Yard'),
      buildLocation('yard-two', 'Yard'),
    ]);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => locationQuery),
    } as never);

    const response = await GET(new NextRequest(
      'http://localhost/api/inventory/locations?lookup=yard',
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.location).toBeNull();
  });
});
