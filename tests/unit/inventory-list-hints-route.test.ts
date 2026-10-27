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
  pickInventoryLocationRelation: (
    location: { name?: string | null } | Array<{ name?: string | null }> | null | undefined,
  ) => {
    if (!location) return null;
    return Array.isArray(location) ? location[0] ?? null : location;
  },
  withEnrichedInventoryLocation: vi.fn(),
  withEnrichedInventoryLocations: vi.fn(async (_admin: unknown, items: unknown[]) => items),
}));

vi.mock('@/lib/server/inventory-source-location-hints', () => ({
  loadInventorySourceLocationHints: vi.fn(),
}));

import { requireInventoryAccess } from '@/lib/server/inventory-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadInventorySourceLocationHints } from '@/lib/server/inventory-source-location-hints';
import { GET } from '@/app/api/inventory/route';

function listRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/inventory${query}`);
}

function adminWithItems(items: unknown[]) {
  return {
    from(table: string) {
      if (table === 'inventory_items') {
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    return {
                      range: async () => ({ data: items, error: null }),
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'inventory_item_group_members') {
        return {
          select() {
            return {
              in: async () => ({ data: [], error: null }),
            };
          },
        };
      }

      if (table === 'inventory_item_movements') {
        return {
          select() {
            return {
              in() {
                return {
                  order: async () => ({ data: [], error: null }),
                };
              },
            };
          },
        };
      }

      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe('inventory list source location hints', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    warn.mockClear();
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: true,
      userId: 'user-1',
      status: 200,
      isManagerOrAdmin: true,
    });
    vi.mocked(createAdminClient).mockReturnValue(adminWithItems([]) as never);
    vi.mocked(loadInventorySourceLocationHints).mockResolvedValue(new Map());
  });

  it('does not read the workbook when every enriched location is present, including Unknown', async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminWithItems([
      { id: 'live', item_number_normalized: 'AB1', location: { id: 'loc-1', name: 'Workshop' } },
      { id: 'unknown', item_number_normalized: 'ZZ9', location: { id: 'loc-u', name: 'Unknown' } },
    ]) as never);

    const response = await GET(listRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(loadInventorySourceLocationHints).not.toHaveBeenCalled();
    expect(body.inventory).toEqual([
      expect.objectContaining({ id: 'live', location: expect.objectContaining({ name: 'Workshop' }) }),
      expect.objectContaining({ id: 'unknown', location: expect.objectContaining({ name: 'Unknown' }) }),
    ]);
    expect(body.inventory.every((item: { source_location_hint?: string }) => item.source_location_hint === undefined)).toBe(true);
    expect(body.pagination).toEqual({ offset: 0, limit: 500, has_more: false });
  });

  it('uses one hint load for a missing location and leaves live locations unchanged', async () => {
    vi.mocked(loadInventorySourceLocationHints).mockResolvedValue(new Map([
      ['AB1', { locations: ['Shed'], rows: [4] }],
      ['CD2', { locations: ['Yard', 'Van'], rows: [5, 6] }],
    ]));
    vi.mocked(createAdminClient).mockReturnValue(adminWithItems([
      { id: 'live', item_number_normalized: 'AB1', location: { id: 'loc-1', name: 'Workshop' } },
      { id: 'unknown', item_number_normalized: 'ZZ9', location: { id: 'loc-u', name: 'Unknown' } },
      { id: 'missing', item_number_normalized: 'CD2', location: null },
    ]) as never);

    const response = await GET(listRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(loadInventorySourceLocationHints).toHaveBeenCalledTimes(1);
    expect(body.inventory).toEqual([
      expect.not.objectContaining({ source_location_hint: expect.anything() }),
      expect.not.objectContaining({ source_location_hint: expect.anything() }),
      expect.objectContaining({
        id: 'missing',
        location: null,
        source_location_hint: 'Yard | Van',
        source_location_rows: '5, 6',
      }),
    ]);
  });

  it('keeps the list response when the hint workbook cannot be read', async () => {
    vi.mocked(loadInventorySourceLocationHints).mockRejectedValue(new Error('missing workbook'));
    vi.mocked(createAdminClient).mockReturnValue(adminWithItems([
      { id: 'missing', item_number_normalized: 'CD2', location: null },
    ]) as never);

    const response = await GET(listRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.inventory).toEqual([
      expect.objectContaining({ id: 'missing', location: null }),
    ]);
    expect(body.inventory[0].source_location_hint).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      'Unable to read inventory spreadsheet location hints:',
      expect.objectContaining({ message: 'missing workbook' }),
    );
  });

  it('does not read hints before inventory access is allowed', async () => {
    vi.mocked(requireInventoryAccess).mockResolvedValue({
      allowed: false,
      status: 401,
      error: 'Unauthorized',
    });

    const response = await GET(listRequest());

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(loadInventorySourceLocationHints).not.toHaveBeenCalled();
  });
});
