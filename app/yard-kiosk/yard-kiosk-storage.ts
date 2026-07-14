const RECENT_LOCATIONS_KEY = 'yard-kiosk:recent-locations:v1';
const PINNED_LOCATIONS_KEY = 'yard-kiosk:pinned-locations:v1';
const MAX_RECENT_LOCATIONS = 8;

function readIds(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(ids));
}

export function getRecentYardKioskLocationIds(): string[] {
  return readIds(RECENT_LOCATIONS_KEY);
}

export function rememberYardKioskLocation(locationId: string): string[] {
  const ids = [
    locationId,
    ...getRecentYardKioskLocationIds().filter((id) => id !== locationId),
  ].slice(0, MAX_RECENT_LOCATIONS);
  writeIds(RECENT_LOCATIONS_KEY, ids);
  return ids;
}

export function getPinnedYardKioskLocationIds(): string[] {
  return readIds(PINNED_LOCATIONS_KEY);
}

export function togglePinnedYardKioskLocation(locationId: string): string[] {
  const current = getPinnedYardKioskLocationIds();
  const ids = current.includes(locationId)
    ? current.filter((id) => id !== locationId)
    : [...current, locationId];
  writeIds(PINNED_LOCATIONS_KEY, ids);
  return ids;
}
