import { describe, expect, it, vi } from 'vitest';
import {
  countInventoryLocationDirectoryFilterTypes,
  parseInventoryLocationDirectoryFilterTypes,
} from '@/lib/server/inventory-locations';

describe('parseInventoryLocationDirectoryFilterTypes', () => {
  it('returns an empty list for missing, blank, or invalid-only values', () => {
    expect(parseInventoryLocationDirectoryFilterTypes([])).toEqual([]);
    expect(parseInventoryLocationDirectoryFilterTypes(['', '  '])).toEqual([]);
    expect(parseInventoryLocationDirectoryFilterTypes(['yard', 'unknown', 'bogus'])).toEqual([]);
  });

  it('allowlists directory filter types, trims, lowercases, and deduplicates', () => {
    expect(
      parseInventoryLocationDirectoryFilterTypes([
        'Van',
        ' site ',
        'manual',
        'manual',
        'HGV',
        'plant',
        'yard',
      ]),
    ).toEqual(['van', 'site', 'manual', 'hgv', 'plant']);
  });
});

describe('countInventoryLocationDirectoryFilterTypes', () => {
  it('counts active filterable types and excludes yard/unknown/zero types', async () => {
    const from = vi.fn(() => {
      const query = {
        select: vi.fn(),
        eq: vi.fn(),
      };
      query.select.mockReturnValue(query);
      query.eq.mockResolvedValue({
        data: [
          { location_type: 'van', source_type: 'fleet' },
          { location_type: 'van', source_type: 'fleet' },
          { location_type: 'site', source_type: 'quote' },
          { location_type: 'site', source_type: 'legacy_quote' },
          { location_type: 'manual', source_type: 'manual' },
          { location_type: 'yard', source_type: 'system' },
          { location_type: 'hgv', source_type: 'fleet' },
        ],
        error: null,
      });
      return query;
    });

    const counts = await countInventoryLocationDirectoryFilterTypes(
      { from } as never,
      false,
    );

    expect(counts).toEqual({
      van: 2,
      site: 1,
      manual: 1,
      hgv: 1,
    });
    expect(counts.plant).toBeUndefined();
  });
});
