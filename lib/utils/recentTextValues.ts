const RECENT_TEXT_KEY_PREFIX = 'recent_text_values_';
const DEFAULT_MAX_RECENT = 5;

function getStorageKey(userId: string, scope: string): string {
  return `${RECENT_TEXT_KEY_PREFIX}${scope}_${userId}`;
}

function safeGet(key: string): string | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures (private mode/storage limits)
  }
}

export function getRecentTextValues(userId: string, scope: string, max: number = DEFAULT_MAX_RECENT): string[] {
  if (!userId || !scope) return [];

  const raw = safeGet(getStorageKey(userId, scope));
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .slice(0, max);
  } catch {
    return [];
  }
}

export function recordRecentTextValue(
  userId: string,
  scope: string,
  value: string,
  max: number = DEFAULT_MAX_RECENT
): string[] {
  const trimmedValue = value.trim();
  if (!userId || !scope || !trimmedValue) return getRecentTextValues(userId, scope, max);

  const existing = getRecentTextValues(userId, scope, max);
  const deduped = existing.filter((item) => item.toLowerCase() !== trimmedValue.toLowerCase());
  const updated = [trimmedValue, ...deduped].slice(0, max);

  safeSet(getStorageKey(userId, scope), JSON.stringify(updated));
  return updated;
}
