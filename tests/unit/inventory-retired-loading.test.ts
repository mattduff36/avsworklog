import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchRetiredInventoryCount,
  fetchRetiredInventoryRows,
  invalidateRetiredInventoryLoads,
  isCurrentRetiredInventoryRead,
  resetRetiredInventoryLoaderState,
  retiredInventoryLoadEpoch,
  retiredInventoryScopeKey,
  RETIRED_INVENTORY_COUNT_PATH,
  RETIRED_INVENTORY_ROWS_PATH,
} from '@/lib/client/inventory-retired-loader';

const managerScope = { userId: 'manager-1', canViewRetired: true };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('retired inventory loader', () => {
  beforeEach(() => {
    resetRetiredInventoryLoaderState();
    vi.unstubAllGlobals();
  });

  it('returns an exact count without requesting retired rows', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ count: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    const read = await fetchRetiredInventoryCount(managerScope);

    expect(read.count).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(RETIRED_INVENTORY_COUNT_PATH, { cache: 'no-store' });
    expect(isCurrentRetiredInventoryRead(
      read,
      retiredInventoryLoadEpoch(),
      retiredInventoryScopeKey(managerScope),
    )).toBe(true);
  });

  it('does not request retired data when the scope cannot view it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchRetiredInventoryCount({ userId: 'staff-1', canViewRetired: false }))
      .rejects.toMatchObject({ status: 403 });
    await expect(fetchRetiredInventoryRows({ userId: ' ', canViewRetired: true }))
      .rejects.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads every retired page once and shares an in-flight read', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('offset=0')) {
        return jsonResponse({
          inventory: [{ id: 'retired-1' }],
          pagination: { offset: 0, limit: 500, has_more: true },
        });
      }
      if (url.includes('offset=500')) {
        return jsonResponse({
          inventory: [{ id: 'retired-2' }],
          pagination: { offset: 500, limit: 500, has_more: false },
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([
      fetchRetiredInventoryRows<{ id: string }>(managerScope),
      fetchRetiredInventoryRows<{ id: string }>(managerScope),
    ]);

    expect(first).toBe(second);
    expect(first.items.map((item) => item.id)).toEqual(['retired-1', 'retired-2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(RETIRED_INVENTORY_ROWS_PATH);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('count=exact');
  });

  it('retries a failed count or row load instead of reusing the failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Retired inventory unavailable' }, 503))
      .mockResolvedValueOnce(jsonResponse({ count: 4 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchRetiredInventoryCount(managerScope)).rejects.toThrow('Retired inventory unavailable');
    await expect(fetchRetiredInventoryCount(managerScope)).resolves.toMatchObject({ count: 4 });

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'Failed to fetch retired inventory items' }, 500))
      .mockResolvedValueOnce(jsonResponse({
        inventory: [{ id: 'retired-1' }],
        pagination: { has_more: false },
      }));
    await expect(fetchRetiredInventoryRows(managerScope)).rejects.toThrow('Failed to fetch retired inventory items');
    await expect(fetchRetiredInventoryRows<{ id: string }>(managerScope)).resolves.toMatchObject({
      items: [{ id: 'retired-1' }],
    });
  });

  it('keeps scopes apart and ignores a read invalidated while it was in flight', async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      pending.push(resolve);
    }));
    vi.stubGlobal('fetch', fetchMock);

    const otherScope = { userId: 'manager-2', canViewRetired: true };
    const first = fetchRetiredInventoryCount(managerScope);
    const other = fetchRetiredInventoryCount(otherScope);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const epochAtStart = retiredInventoryLoadEpoch();
    invalidateRetiredInventoryLoads();
    const refreshed = fetchRetiredInventoryCount(managerScope);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    pending[0]?.(jsonResponse({ count: 1 }));
    pending[1]?.(jsonResponse({ count: 8 }));
    pending[2]?.(jsonResponse({ count: 5 }));

    const firstRead = await first;
    const otherRead = await other;
    const refreshedRead = await refreshed;

    expect(firstRead.count).toBe(1);
    expect(otherRead.count).toBe(8);
    expect(refreshedRead.count).toBe(5);
    expect(isCurrentRetiredInventoryRead(
      firstRead,
      retiredInventoryLoadEpoch(),
      retiredInventoryScopeKey(managerScope),
    )).toBe(false);
    expect(firstRead.epoch).toBe(epochAtStart);
    expect(isCurrentRetiredInventoryRead(
      refreshedRead,
      retiredInventoryLoadEpoch(),
      retiredInventoryScopeKey(managerScope),
    )).toBe(true);
    expect(isCurrentRetiredInventoryRead(
      otherRead,
      retiredInventoryLoadEpoch(),
      retiredInventoryScopeKey(managerScope),
    )).toBe(false);
    expect(isCurrentRetiredInventoryRead(
      otherRead,
      otherRead.epoch,
      retiredInventoryScopeKey(otherScope),
    )).toBe(true);
  });
});
