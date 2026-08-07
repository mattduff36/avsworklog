import { describe, expect, it } from 'vitest';
import { normalizeObviousInventoryItemName } from '@/lib/inventory/name-normalisation';

describe('normalizeObviousInventoryItemName', () => {
  it('applies obvious spelling and spacing fixes', () => {
    expect(normalizeObviousInventoryItemName('3.4KVA GENY')).toBe('3.4KVA GENNY');
    expect(normalizeObviousInventoryItemName('GENNEY')).toBe('GENNY');
    expect(normalizeObviousInventoryItemName('LAZER LEVEL')).toBe('LASER LEVEL');
    expect(normalizeObviousInventoryItemName('STHIL SAW')).toBe('STIHL SAW');
    expect(normalizeObviousInventoryItemName('CAT4 GPS')).toBe('CAT 4 GPS');
    expect(normalizeObviousInventoryItemName('e CAT 4')).toBe('CAT 4 E');
    expect(normalizeObviousInventoryItemName('circle saw')).toBe('CIRCULAR SAW');
    expect(normalizeObviousInventoryItemName('GENNY /CAT')).toBe('GENNY / CAT');
    expect(normalizeObviousInventoryItemName('makita drill')).toBe('MAKITA DRILL');
  });

  it('leaves ambiguous generator wording and unrelated text unchanged', () => {
    expect(normalizeObviousInventoryItemName('GENERATOR')).toBe('GENERATOR');
    expect(normalizeObviousInventoryItemName('HONDA GENERATOR 3.4KVA')).toBe('HONDA GENERATOR 3.4KVA');
    expect(normalizeObviousInventoryItemName('RECIP SAW')).toBe('RECIP SAW');
    expect(normalizeObviousInventoryItemName('RIP SAW')).toBe('RIP SAW');
    expect(normalizeObviousInventoryItemName('WEAKA DRILL DK17')).toBe('WEAKA DRILL DK17');
    expect(normalizeObviousInventoryItemName('CAT 4 GPS')).toBe('CAT 4 GPS');
  });
});
