import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveInitialInventoryTableFilters } from '@/app/(dashboard)/inventory/components/InventoryTable';
import {
  clearAllInventoryTableFilters,
  writeInventoryTableFilters,
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

describe('INV-FILTER-02 InventoryTable filter hydration', () => {
  beforeEach(() => {
    installMemorySessionStorage();
  });

  afterEach(() => {
    clearAllInventoryTableFilters();
    vi.unstubAllGlobals();
  });

  it('hydrates from filterStorageKey when no quickFilter seed is present', () => {
    writeInventoryTableFilters('small-tools', {
      search: 'angle grinder',
      statusFilters: ['overdue'],
      categoryFilters: ['small_tools'],
      locationFilters: ['yard-1'],
      retireReasonFilters: [],
      sortField: 'location',
      sortDir: 'desc',
      includeLegacyQuotes: true,
    });

    const initial = resolveInitialInventoryTableFilters({
      retiredMode: false,
      filterStorageKey: 'small-tools',
      quickFilter: {
        version: 1,
        search: '',
        statusFilters: [],
        locationFilters: [],
      },
    });

    expect(initial.search).toBe('angle grinder');
    expect(initial.statusFilters).toEqual(['overdue']);
    expect(initial.categoryFilters).toEqual(['small_tools']);
    expect(initial.locationFilters).toEqual(['yard-1']);
    expect(initial.sortField).toBe('location');
    expect(initial.sortDir).toBe('desc');
    expect(initial.includeLegacyQuotes).toBe(true);
  });

  it('prefers a quickFilter seed over stored filters', () => {
    writeInventoryTableFilters('small-tools', {
      search: 'stored',
      statusFilters: ['ok'],
      categoryFilters: ['stored-cat'],
      locationFilters: ['stored-loc'],
      retireReasonFilters: [],
      sortField: 'name',
      sortDir: 'asc',
      includeLegacyQuotes: false,
    });

    const initial = resolveInitialInventoryTableFilters({
      retiredMode: false,
      filterStorageKey: 'small-tools',
      quickFilter: {
        version: 2,
        search: 'card-filter',
        statusFilters: ['due_soon'],
        locationFilters: ['card-loc'],
      },
    });

    expect(initial.search).toBe('card-filter');
    expect(initial.statusFilters).toEqual(['due_soon']);
    expect(initial.locationFilters).toEqual(['card-loc']);
    expect(initial.categoryFilters).toEqual([]);
  });
});
