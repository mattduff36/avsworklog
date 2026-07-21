import { describe, expect, it, vi } from 'vitest';
import { listInventoryLocations } from '@/lib/server/inventory-locations';

describe('inventory location directory search', () => {
  it('passes directory filters to the RPC and separates pagination metadata', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        id: 'van-location',
        name: 'Van - TE57 VAN',
        description: null,
        is_active: true,
        linked_van_id: 'van-id',
        linked_hgv_id: null,
        linked_plant_id: null,
        location_type: 'van',
        source_type: 'fleet',
        source_id: null,
        external_reference: null,
        sync_status: 'synced',
        source_synced_at: null,
        created_at: '2026-07-21T00:00:00.000Z',
        updated_at: '2026-07-21T00:00:00.000Z',
        created_by: null,
        updated_by: null,
        total_count: 73,
      }],
      error: null,
    });

    const result = await listInventoryLocations({ rpc } as never, {
      search: 'TE57',
      includeLegacyQuotes: true,
      limit: 50,
      offset: 50,
    });

    expect(rpc).toHaveBeenCalledWith('inventory_search_locations', {
      p_search: 'TE57',
      p_include_legacy: true,
      p_limit: 50,
      p_offset: 50,
    });
    expect(result.total).toBe(73);
    expect(result.locations).toEqual([
      expect.objectContaining({
        id: 'van-location',
        name: 'Van - TE57 VAN',
      }),
    ]);
    expect(result.locations[0]).not.toHaveProperty('total_count');
  });
});
