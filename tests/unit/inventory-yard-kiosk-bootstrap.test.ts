import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import {
  getYardKioskBootstrap,
  type InventoryKioskAccessResult,
} from '@/lib/server/inventory-kiosk';

function buildLocationQuery(data: unknown[]) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    range: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.neq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data, error: null });
  query.range.mockImplementation((from: number, to: number) => Promise.resolve({
    data: data.slice(from, to + 1),
    error: null,
  }));
  return query;
}

function buildCategoryQuery(data: unknown[]) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order
    .mockReturnValueOnce(query)
    .mockResolvedValueOnce({ data, error: null });
  return query;
}

function buildAssignmentQuery(data: unknown[]) {
  const query = {
    select: vi.fn(),
    in: vi.fn(),
    limit: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.in.mockRejectedValue(new Error('Assignment IDs must not be encoded in the URL'));
  query.limit.mockResolvedValue({ data, error: null });
  return query;
}

describe('Yard kiosk bootstrap location assignees', () => {
  it('loads primary and secondary names in set-based queries and returns names only', async () => {
    const location = {
      id: 'site-one',
      name: 'Site One',
      description: null,
      location_type: 'site' as const,
      source_type: 'manual' as const,
      external_reference: 'SITE-1',
      is_active: true,
    };
    const locationQuery = buildLocationQuery([location]);
    const categoryQuery = buildCategoryQuery([]);
    const primaryQuery = buildAssignmentQuery([
      { location_id: location.id, user: { full_name: 'Bob Zee' } },
      { location_id: location.id, user: [{ full_name: ' Alice Young ' }] },
      { location_id: location.id, user: { full_name: 'alice young' } },
      { location_id: location.id, user: { full_name: null } },
    ]);
    const secondaryQuery = buildAssignmentQuery([
      { location_id: location.id, user: { full_name: 'Charlie Able' } },
      { location_id: location.id, user: { full_name: 'Aaron West' } },
      { location_id: location.id, user: { full_name: 'Bob Zee' } },
      { location_id: location.id, user: { full_name: 'Charlie Able' } },
    ]);
    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'inventory_locations') return locationQuery;
        if (table === 'inventory_item_categories') return categoryQuery;
        if (table === 'inventory_user_locations') return primaryQuery;
        if (table === 'inventory_user_site_locations') return secondaryQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    const access: InventoryKioskAccessResult = {
      allowed: true,
      status: 200,
      userId: 'kiosk-user',
      yard: {
        id: 'yard-one',
        name: 'Yard',
        description: null,
        location_type: 'yard',
        source_type: 'system',
        external_reference: null,
        is_active: true,
      },
    };

    const bootstrap = await getYardKioskBootstrap(access);

    expect(primaryQuery.in).not.toHaveBeenCalled();
    expect(primaryQuery.limit).toHaveBeenCalledWith(5000);
    expect(secondaryQuery.in).not.toHaveBeenCalled();
    expect(secondaryQuery.limit).toHaveBeenCalledWith(5000);
    expect(primaryQuery.select.mock.calls[0]?.[0]).toContain('(full_name)');
    expect(secondaryQuery.select.mock.calls[0]?.[0]).toContain('(full_name)');
    expect(locationQuery.neq).toHaveBeenCalledWith('source_type', 'legacy_quote');
    expect(bootstrap.locations).toEqual([{
      id: location.id,
      name: location.name,
      description: null,
      location_type: 'site',
      source_type: 'manual',
      external_reference: 'SITE-1',
      primary_user_names: ['Alice Young', 'Bob Zee'],
      secondary_user_names: ['Aaron West', 'Charlie Able'],
    }]);
    expect(JSON.stringify(bootstrap.locations)).not.toMatch(/email|user_id|auth/i);
  });

  it('includes active legacy sites only with the explicit structured-data opt-in', async () => {
    const legacySite = {
      id: 'legacy-site',
      name: 'Historic Site',
      description: null,
      location_type: 'site' as const,
      source_type: 'legacy_quote' as const,
      external_reference: 'LEGACY-100',
      is_active: true,
    };
    const locationQuery = buildLocationQuery([legacySite]);
    const categoryQuery = buildCategoryQuery([]);
    const primaryQuery = buildAssignmentQuery([]);
    const secondaryQuery = buildAssignmentQuery([]);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'inventory_locations') return locationQuery;
        if (table === 'inventory_item_categories') return categoryQuery;
        if (table === 'inventory_user_locations') return primaryQuery;
        if (table === 'inventory_user_site_locations') return secondaryQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    } as never);

    const bootstrap = await getYardKioskBootstrap({
      allowed: true,
      status: 200,
      userId: 'kiosk-user',
      yard: {
        id: 'yard-one',
        name: 'Yard',
        description: null,
        location_type: 'yard',
        source_type: 'system',
        external_reference: null,
        is_active: true,
      },
    }, { includeLegacyQuotes: true });

    expect(locationQuery.neq).not.toHaveBeenCalledWith(
      'source_type',
      'legacy_quote',
    );
    expect(bootstrap.locations).toEqual([
      expect.objectContaining({
        id: legacySite.id,
        location_type: 'site',
        source_type: 'legacy_quote',
      }),
    ]);
  });

  it('paginates a large legacy payload without oversized assignment-query URLs', async () => {
    const locations = Array.from({ length: 1500 }, (_, index) => ({
      id: `legacy-site-${index}`,
      name: `Historic Site ${index}`,
      description: null,
      location_type: 'site' as const,
      source_type: 'legacy_quote' as const,
      external_reference: `LEGACY-${index}`,
      is_active: true,
    }));
    const locationQuery = buildLocationQuery(locations);
    const categoryQuery = buildCategoryQuery([]);
    const primaryQuery = buildAssignmentQuery([]);
    const secondaryQuery = buildAssignmentQuery([]);
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'inventory_locations') return locationQuery;
        if (table === 'inventory_item_categories') return categoryQuery;
        if (table === 'inventory_user_locations') return primaryQuery;
        if (table === 'inventory_user_site_locations') return secondaryQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    } as never);

    const bootstrap = await getYardKioskBootstrap({
      allowed: true,
      status: 200,
      userId: 'kiosk-user',
      yard: {
        id: 'yard-one',
        name: 'Yard',
        description: null,
        location_type: 'yard',
        source_type: 'system',
        external_reference: null,
        is_active: true,
      },
    }, { includeLegacyQuotes: true });

    expect(bootstrap.locations).toHaveLength(1500);
    expect(locationQuery.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(locationQuery.range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(primaryQuery.in).not.toHaveBeenCalled();
    expect(secondaryQuery.in).not.toHaveBeenCalled();
    expect(primaryQuery.limit).toHaveBeenCalledWith(5000);
    expect(secondaryQuery.limit).toHaveBeenCalledWith(5000);
  });

  it('returns empty name groups without assignment queries when there are no locations', async () => {
    const locationQuery = buildLocationQuery([]);
    const categoryQuery = buildCategoryQuery([]);
    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'inventory_locations') return locationQuery;
        if (table === 'inventory_item_categories') return categoryQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const bootstrap = await getYardKioskBootstrap({
      allowed: true,
      status: 200,
      userId: 'kiosk-user',
      yard: {
        id: 'yard-one',
        name: 'Yard',
        description: null,
        location_type: 'yard',
        source_type: 'system',
        external_reference: null,
        is_active: true,
      },
    });

    expect(bootstrap.locations).toEqual([]);
    expect(admin.from).not.toHaveBeenCalledWith('inventory_user_locations');
    expect(admin.from).not.toHaveBeenCalledWith('inventory_user_site_locations');
  });
});
