import { fetchAllPaginatedItems } from '@/lib/client/paginated-fetch';
import { createStatusError } from '@/lib/utils/http-error';

export const RETIRED_INVENTORY_COUNT_PATH = '/api/inventory?status=retired&count=exact';
export const RETIRED_INVENTORY_ROWS_PATH = '/api/inventory?status=retired';

export interface RetiredInventoryScope {
  userId: string;
  canViewRetired: boolean;
}

export interface RetiredInventoryReadScope {
  epoch: number;
  scopeKey: string;
}

export interface RetiredInventoryCountRead extends RetiredInventoryReadScope {
  count: number;
}

export interface RetiredInventoryRowsRead<TItem> extends RetiredInventoryReadScope {
  items: TItem[];
}

interface RetiredCountPayload {
  count?: unknown;
  error?: string;
}

let loadEpoch = 0;
const inflightCounts = new Map<string, Promise<RetiredInventoryCountRead>>();
const inflightRows = new Map<string, Promise<RetiredInventoryRowsRead<unknown>>>();

export function retiredInventoryScopeKey(scope: RetiredInventoryScope): string {
  return `${scope.canViewRetired ? 'allowed' : 'denied'}\n${scope.userId}`;
}

export function retiredInventoryLoadEpoch(): number {
  return loadEpoch;
}

export function invalidateRetiredInventoryLoads(): number {
  loadEpoch += 1;
  inflightCounts.clear();
  inflightRows.clear();
  return loadEpoch;
}

export function resetRetiredInventoryLoaderState(): void {
  loadEpoch = 0;
  inflightCounts.clear();
  inflightRows.clear();
}

export function isCurrentRetiredInventoryRead(
  read: RetiredInventoryReadScope,
  currentEpoch: number,
  currentScopeKey: string | null,
): boolean {
  return currentScopeKey !== null
    && read.epoch === currentEpoch
    && read.scopeKey === currentScopeKey;
}

function assertRetiredScope(scope: RetiredInventoryScope): void {
  if (!scope.canViewRetired || scope.userId.trim().length === 0) {
    throw createStatusError('Manager or admin access required', 403);
  }
}

export async function fetchRetiredInventoryCount(
  scope: RetiredInventoryScope,
): Promise<RetiredInventoryCountRead> {
  assertRetiredScope(scope);
  const scopeKey = retiredInventoryScopeKey(scope);
  const existing = inflightCounts.get(scopeKey);
  if (existing) return existing;

  const epoch = loadEpoch;
  const promise = readRetiredInventoryCount()
    .then((count) => ({ epoch, scopeKey, count }))
    .finally(() => {
      if (inflightCounts.get(scopeKey) === promise) inflightCounts.delete(scopeKey);
    });
  inflightCounts.set(scopeKey, promise);
  return promise;
}

export async function fetchRetiredInventoryRows<TItem>(
  scope: RetiredInventoryScope,
): Promise<RetiredInventoryRowsRead<TItem>> {
  assertRetiredScope(scope);
  const scopeKey = retiredInventoryScopeKey(scope);
  const existing = inflightRows.get(scopeKey) as Promise<RetiredInventoryRowsRead<TItem>> | undefined;
  if (existing) return existing;

  const epoch = loadEpoch;
  const promise: Promise<RetiredInventoryRowsRead<TItem>> = fetchAllPaginatedItems<TItem>(
    RETIRED_INVENTORY_ROWS_PATH,
    'inventory',
    {
      limit: 500,
      errorMessage: 'Failed to fetch retired inventory items',
    },
  ).then(({ items }) => ({ epoch, scopeKey, items }));
  const stored = promise as Promise<RetiredInventoryRowsRead<unknown>>;
  const clearStored = () => {
    if (inflightRows.get(scopeKey) === stored) inflightRows.delete(scopeKey);
  };
  void stored.then(clearStored, clearStored);
  inflightRows.set(scopeKey, stored);
  return promise;
}

async function readRetiredInventoryCount(): Promise<number> {
  const response = await fetch(RETIRED_INVENTORY_COUNT_PATH, { cache: 'no-store' });
  const payload = (await response.json().catch(() => ({}))) as RetiredCountPayload;
  if (!response.ok) {
    throw createStatusError(
      payload.error || 'Failed to fetch retired inventory count',
      response.status,
      payload,
    );
  }
  if (typeof payload.count !== 'number' || !Number.isInteger(payload.count) || payload.count < 0) {
    throw new Error('Retired inventory count was not returned');
  }
  return payload.count;
}
