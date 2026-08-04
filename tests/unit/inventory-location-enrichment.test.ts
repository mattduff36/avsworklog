import { beforeEach, describe, expect, it, vi } from 'vitest';

const fromMock = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: fromMock })),
}));

import {
  enrichInventoryLocationRecords,
  pickInventoryLocationRelation,
  withEnrichedInventoryLocation,
  withEnrichedInventoryLocations,
} from '@/lib/server/inventory-locations';
import type { Database } from '@/types/database';

type InventoryLocationRow = Database['public']['Tables']['inventory_locations']['Row'];

function buildLocation(id: string, overrides: Partial<InventoryLocationRow> = {}): InventoryLocationRow {
  return {
    id,
    name: `Van - ${id}`,
    description: null,
    is_active: true,
    linked_van_id: `van-${id}`,
    linked_hgv_id: null,
    linked_plant_id: null,
    location_type: 'van',
    source_type: 'fleet',
    source_id: null,
    external_reference: null,
    sync_status: 'synced',
    source_synced_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    updated_by: null,
    ...overrides,
  };
}

function mockInQuery(result: { data: unknown; error: null }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockResolvedValue(result);
  return query;
}

describe('inventory location enrichment helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('picks the first relation when PostgREST returns an array', () => {
    const location = buildLocation('loc-1');
    expect(pickInventoryLocationRelation([location])).toEqual(location);
    expect(pickInventoryLocationRelation(null)).toBeNull();
  });

  it('attaches assignee names and linked asset labels to nested item locations', async () => {
    const location = buildLocation('loc-1');
    const admin = { from: fromMock };

    fromMock.mockImplementation((table: string) => {
      if (table === 'inventory_items') {
        return mockInQuery({ data: [{ location_id: location.id }], error: null });
      }
      if (table === 'vans') {
        return mockInQuery({
          data: [{ id: location.linked_van_id, reg_number: 'NU75 VGT', nickname: null }],
          error: null,
        });
      }
      if (table === 'inventory_user_locations') {
        return mockInQuery({
          data: [{ location_id: location.id, user: { full_name: 'Ben Smith' } }],
          error: null,
        });
      }
      if (table === 'inventory_user_site_locations') {
        return mockInQuery({ data: [], error: null });
      }
      return mockInQuery({ data: [], error: null });
    });

    const [item] = await withEnrichedInventoryLocations(admin as never, [
      { id: 'item-1', location },
    ]);

    expect(item.location).toEqual(expect.objectContaining({
      id: location.id,
      assigned_user_names: ['Ben Smith'],
      linked_asset_type: 'van',
      linked_asset_label: 'NU75 VGT',
    }));

    const single = await withEnrichedInventoryLocation(admin as never, { id: 'item-1', location });
    expect(single.location?.assigned_user_names).toEqual(['Ben Smith']);

    const map = await enrichInventoryLocationRecords(admin as never, [[location]]);
    expect(map.get(location.id)?.assigned_user_names).toEqual(['Ben Smith']);
  });
});
