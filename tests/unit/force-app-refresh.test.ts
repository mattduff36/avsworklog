import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('forceAppRefresh', () => {
  it('unregisters service workers, clears caches, and redirects to the requested path', async () => {
    const unregister = vi.fn(async () => true);
    const getRegistrations = vi.fn(async () => [{ unregister }]);
    const deleteCache = vi.fn(async () => true);
    const cachesMock = {
      keys: vi.fn(async () => ['app-shell', 'runtime-data']),
      delete: deleteCache,
    };
    const replace = vi.fn();
    const databases = vi.fn(async () => [
      { name: 'workbox-expiration' },
      { name: 'app-user-data' },
    ]);
    const deleteDatabase = vi.fn((_databaseName: string) => {
      const request = {
        onsuccess: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onblocked: null as ((event: Event) => void) | null,
      };

      queueMicrotask(() => {
        request.onsuccess?.(new Event('success'));
      });

      return request as unknown as IDBOpenDBRequest;
    });

    vi.stubGlobal(
      'window',
      {
        location: {
          href: 'https://example.com/help?tab=install',
          origin: 'https://example.com',
          replace,
        },
        caches: cachesMock,
      } as unknown as Window
    );
    vi.stubGlobal(
      'navigator',
      {
        serviceWorker: {
          getRegistrations,
        },
      } as unknown as Navigator
    );
    vi.stubGlobal(
      'indexedDB',
      {
        databases,
        deleteDatabase,
      } as unknown as IDBFactory
    );

    const { forceAppRefresh } = await import('@/lib/client/force-app-refresh');
    await forceAppRefresh({ redirectTo: '/dashboard' });

    expect(getRegistrations).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(cachesMock.keys).toHaveBeenCalledTimes(1);
    expect(deleteCache).toHaveBeenCalledTimes(2);
    expect(databases).toHaveBeenCalledTimes(1);
    expect(deleteDatabase).toHaveBeenCalledWith('workbox-expiration');
    expect(deleteDatabase).not.toHaveBeenCalledWith('app-user-data');
    expect(replace).toHaveBeenCalledWith('https://example.com/dashboard');
  });
});
