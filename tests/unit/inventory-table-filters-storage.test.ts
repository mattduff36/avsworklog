import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllInventoryTableFilters,
  clearInventoryTableFilters,
  INVENTORY_TABLE_FILTERS_STORAGE_PREFIX,
  readInventoryTableFilters,
  writeInventoryTableFilters,
  type InventoryTableFiltersSnapshot,
} from '@/lib/utils/inventory-table-filters-storage';

function installMemorySessionStorage() {
  const store = new Map<string, string>();
  const memoryStorage = {
    get length() {
      return store.size;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };

  vi.stubGlobal('window', { sessionStorage: memoryStorage });
  vi.stubGlobal('sessionStorage', memoryStorage);
}

const sampleSnapshot: InventoryTableFiltersSnapshot = {
  search: 'drill',
  statusFilters: ['overdue', 'due_soon'],
  categoryFilters: ['small_tools'],
  locationFilters: ['loc-1', '__no_location__'],
  retireReasonFilters: ['Sold'],
  sortField: 'item_number',
  sortDir: 'desc',
  includeLegacyQuotes: true,
};

describe('INV-FILTER-01 inventory table filters storage', () => {
  beforeEach(() => {
    installMemorySessionStorage();
  });

  afterEach(() => {
    clearAllInventoryTableFilters();
    vi.unstubAllGlobals();
  });

  it('writes and reads a snapshot for a table key', () => {
    expect(writeInventoryTableFilters('small-tools', sampleSnapshot)).toBe(true);
    expect(readInventoryTableFilters('small-tools')).toEqual(sampleSnapshot);
  });

  it('keeps per-table keys isolated', () => {
    writeInventoryTableFilters('small-tools', sampleSnapshot);
    writeInventoryTableFilters('retired', {
      ...sampleSnapshot,
      search: 'retired-search',
      statusFilters: [],
    });

    expect(readInventoryTableFilters('small-tools')?.search).toBe('drill');
    expect(readInventoryTableFilters('retired')?.search).toBe('retired-search');
  });

  it('returns null for invalid JSON and unknown keys', () => {
    sessionStorage.setItem(`${INVENTORY_TABLE_FILTERS_STORAGE_PREFIX}broken`, '{not-json');
    expect(readInventoryTableFilters('broken')).toBeNull();
    expect(readInventoryTableFilters('missing')).toBeNull();
    expect(readInventoryTableFilters('')).toBeNull();
  });

  it('clears one key and all inventory filter keys', () => {
    writeInventoryTableFilters('small-tools', sampleSnapshot);
    writeInventoryTableFilters('minor-plant', sampleSnapshot);
    clearInventoryTableFilters('small-tools');
    expect(readInventoryTableFilters('small-tools')).toBeNull();
    expect(readInventoryTableFilters('minor-plant')).not.toBeNull();

    clearAllInventoryTableFilters();
    expect(readInventoryTableFilters('minor-plant')).toBeNull();
  });

  it('sanitizes invalid filter values when reading', () => {
    sessionStorage.setItem(
      `${INVENTORY_TABLE_FILTERS_STORAGE_PREFIX}dirty`,
      JSON.stringify({
        search: 12,
        statusFilters: ['overdue', 'not-a-status'],
        categoryFilters: ['ok', 1],
        locationFilters: ['loc-1'],
        retireReasonFilters: ['Sold', 'Nope'],
        sortField: 'not-a-field',
        sortDir: 'sideways',
        includeLegacyQuotes: 'yes',
      }),
    );

    expect(readInventoryTableFilters('dirty')).toEqual({
      search: '',
      statusFilters: ['overdue'],
      categoryFilters: [],
      locationFilters: ['loc-1'],
      retireReasonFilters: ['Sold'],
      sortField: 'name',
      sortDir: 'asc',
      includeLegacyQuotes: false,
    });
  });
});
