interface ForceAppRefreshOptions {
  redirectTo?: string;
}

function getNavigationTarget(redirectTo?: string): string {
  if (typeof window === 'undefined') {
    return redirectTo ?? '/';
  }

  if (!redirectTo) {
    return window.location.href;
  }

  return new URL(redirectTo, window.location.origin).toString();
}

async function unregisterServiceWorkers(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.allSettled(registrations.map((registration) => registration.unregister()));
}

async function clearCacheStorage(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return;
  }

  const cacheNames = await window.caches.keys();
  await Promise.allSettled(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
}

async function clearWorkboxDatabases(): Promise<void> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
    return;
  }

  const databases = await indexedDB.databases();
  const workboxDatabaseNames = databases
    .map((database) => database.name)
    .filter((databaseName): databaseName is string => {
      if (!databaseName) {
        return false;
      }

      return /workbox|service-?worker/i.test(databaseName);
    });

  await Promise.allSettled(
    workboxDatabaseNames.map(
      (databaseName) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(databaseName);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        })
    )
  );
}

export async function forceAppRefresh({ redirectTo }: ForceAppRefreshOptions = {}): Promise<void> {
  const target = getNavigationTarget(redirectTo);

  await Promise.allSettled([
    unregisterServiceWorkers(),
    clearCacheStorage(),
    clearWorkboxDatabases(),
  ]);

  if (typeof window !== 'undefined') {
    window.location.replace(target);
  }
}
