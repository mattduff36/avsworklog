/**
 * Session-scoped persistence for InventoryTable filters.
 * Survives list → item details → back; cleared when leaving /inventory.
 */

import type { InventoryCheckStatus, InventoryRetireReason } from '@/app/(dashboard)/inventory/types';

export const INVENTORY_TABLE_FILTERS_STORAGE_PREFIX = 'inventory-table-filters:';

export type InventoryTableSortField =
  | 'item_number'
  | 'serial_number'
  | 'name'
  | 'location'
  | 'last_checked_at';

export type InventoryTableSortDir = 'asc' | 'desc';

export interface InventoryTableFiltersSnapshot {
  search: string;
  statusFilters: InventoryCheckStatus[];
  categoryFilters: string[];
  locationFilters: string[];
  retireReasonFilters: InventoryRetireReason[];
  sortField: InventoryTableSortField;
  sortDir: InventoryTableSortDir;
  includeLegacyQuotes: boolean;
}

const SORT_FIELDS: InventoryTableSortField[] = [
  'item_number',
  'serial_number',
  'name',
  'location',
  'last_checked_at',
];

const CHECK_STATUSES: InventoryCheckStatus[] = [
  'ok',
  'due_soon',
  'overdue',
  'needs_check',
  'not_required',
];

const RETIRE_REASONS: InventoryRetireReason[] = [
  'Sold',
  'Scrapped',
  'Lost',
  'Damaged',
  'Returned',
  'Other',
];

function getStorageKey(tableKey: string): string {
  return `${INVENTORY_TABLE_FILTERS_STORAGE_PREFIX}${tableKey}`;
}

function safeSessionStorageGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionStorageSet(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeSessionStorageRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function parseStatusFilters(value: unknown): InventoryCheckStatus[] {
  if (!isStringArray(value)) return [];
  return value.filter((entry): entry is InventoryCheckStatus =>
    CHECK_STATUSES.includes(entry as InventoryCheckStatus),
  );
}

function parseRetireReasonFilters(value: unknown): InventoryRetireReason[] {
  if (!isStringArray(value)) return [];
  return value.filter((entry): entry is InventoryRetireReason =>
    RETIRE_REASONS.includes(entry as InventoryRetireReason),
  );
}

function parseSortField(value: unknown): InventoryTableSortField {
  if (typeof value === 'string' && SORT_FIELDS.includes(value as InventoryTableSortField)) {
    return value as InventoryTableSortField;
  }
  return 'name';
}

function parseSortDir(value: unknown): InventoryTableSortDir {
  return value === 'desc' ? 'desc' : 'asc';
}

function parseSnapshot(raw: unknown): InventoryTableFiltersSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<InventoryTableFiltersSnapshot>;
  return {
    search: typeof candidate.search === 'string' ? candidate.search : '',
    statusFilters: parseStatusFilters(candidate.statusFilters),
    categoryFilters: isStringArray(candidate.categoryFilters) ? candidate.categoryFilters : [],
    locationFilters: isStringArray(candidate.locationFilters) ? candidate.locationFilters : [],
    retireReasonFilters: parseRetireReasonFilters(candidate.retireReasonFilters),
    sortField: parseSortField(candidate.sortField),
    sortDir: parseSortDir(candidate.sortDir),
    includeLegacyQuotes: candidate.includeLegacyQuotes === true,
  };
}

export function readInventoryTableFilters(tableKey: string): InventoryTableFiltersSnapshot | null {
  if (!tableKey) return null;
  const raw = safeSessionStorageGet(getStorageKey(tableKey));
  if (!raw) return null;
  try {
    return parseSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeInventoryTableFilters(
  tableKey: string,
  snapshot: InventoryTableFiltersSnapshot,
): boolean {
  if (!tableKey) return false;
  return safeSessionStorageSet(getStorageKey(tableKey), JSON.stringify(snapshot));
}

export function clearInventoryTableFilters(tableKey: string): void {
  if (!tableKey) return;
  safeSessionStorageRemove(getStorageKey(tableKey));
}

export function clearAllInventoryTableFilters(): void {
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(INVENTORY_TABLE_FILTERS_STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      sessionStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}
