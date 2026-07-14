import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/inventory-auth', () => ({
  requireInventoryAccess: vi.fn(),
  requireInventoryManagerAccess: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { requireInventoryAccess } from '@/lib/server/inventory-auth';
import { createAdminClient } from '@/lib/supabase/admin';
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
    location_type: 'yard',
    source_type: 'system',
    source_id: null,
    external_reference: null,
    sync_status: 'synced',
    source_synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    updated_by: null,
  };
}

function buildSearchQuery<T>(data: T[]) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    ilike: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.neq.mockReturnValue(query);
  query.ilike.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data, error: null });
  return query;
}

function buildFilteredQuery<T>(data: T[]) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockResolvedValue({ data, error: null });
  return query;
}

describe('inventory locations route', () => {
  it('returns no locations below the three-character search threshold', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'admin-user',
      isManagerOrAdmin: true,
    });

    const response = await GET(new NextRequest('http://localhost/api/inventory/locations?search=ya'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.locations).toEqual([]);
    expect(payload.minimum_search_characters).toBe(3);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('filters and limits matching locations in the database query', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'admin-user',
      isManagerOrAdmin: true,
    });

    const yard = buildLocation('yard-location', 'Main Yard');
    const locationQuery = buildSearchQuery([yard]);
    const itemQuery = buildFilteredQuery([
      { location_id: yard.id },
      { location_id: yard.id },
    ]);
    const userAssignmentsQuery = buildFilteredQuery([]);
    const siteAssignmentsQuery = buildFilteredQuery([]);

    const admin = {
      from(table: string) {
        if (table === 'inventory_locations') return locationQuery;
        if (table === 'inventory_items') return itemQuery;
        if (table === 'inventory_user_locations') return userAssignmentsQuery;
        if (table === 'inventory_user_site_locations') return siteAssignmentsQuery;
        throw new Error(`Unexpected table ${table}`);
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const response = await GET(new NextRequest(
      'http://localhost/api/inventory/locations?search=yard&limit=25',
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(locationQuery.ilike).toHaveBeenCalledWith('name', '%yard%');
    expect(locationQuery.neq).toHaveBeenCalledWith('source_type', 'legacy_quote');
    expect(locationQuery.order).toHaveBeenNthCalledWith(1, 'name', { ascending: true });
    expect(locationQuery.order).toHaveBeenNthCalledWith(2, 'id', { ascending: true });
    expect(locationQuery.limit).toHaveBeenCalledWith(25);
    expect(itemQuery.in).toHaveBeenCalledWith('location_id', [yard.id]);
    expect(payload.locations).toEqual([
      expect.objectContaining({ id: yard.id, item_count: 2 }),
    ]);
  });

  it('includes legacy quote locations only with explicit opt-in', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'admin-user',
      isManagerOrAdmin: true,
    });
    const legacySite = {
      ...buildLocation('legacy-site', 'Legacy quote - 1234'),
      location_type: 'site',
      source_type: 'legacy_quote',
    };
    const locationQuery = buildSearchQuery([legacySite]);
    const emptyQuery = buildFilteredQuery([]);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'inventory_locations') return locationQuery;
        return emptyQuery;
      }),
    } as never);

    const response = await GET(new NextRequest(
      'http://localhost/api/inventory/locations?search=legacy&includeLegacyQuotes=true',
    ));

    expect(response.status).toBe(200);
    expect(locationQuery.neq).not.toHaveBeenCalled();
  });

  it('returns one exact active Yard lookup by stable id', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'admin-user',
      isManagerOrAdmin: true,
    });
    const yard = buildLocation('yard-stable-id', 'Yard');
    const locationQuery = buildSearchQuery([yard]);
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
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      status: 200,
      userId: 'admin-user',
      isManagerOrAdmin: true,
    });
    const locationQuery = buildSearchQuery([
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
