import { describe, expect, it } from 'vitest';
import { parseInventoryLocationDirectoryFilterTypes } from '@/lib/server/inventory-locations';

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
