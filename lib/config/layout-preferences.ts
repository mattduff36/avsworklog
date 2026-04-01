export const APP_WIDESCREEN_STORAGE_KEY = 'app-widescreen-view';
export const LEGACY_WORKSHOP_WIDESCREEN_STORAGE_KEY = 'workshop-tasks-widescreen-view';
export const APP_WIDESCREEN_CHANGED_EVENT = 'app-widescreen-changed';

export function readAppWidescreenPreference(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const explicitPreference = localStorage.getItem(APP_WIDESCREEN_STORAGE_KEY);
    if (explicitPreference !== null) {
      return explicitPreference === 'true';
    }

    // Fallback for users who configured the previous workshop-only preference.
    return localStorage.getItem(LEGACY_WORKSHOP_WIDESCREEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeAppWidescreenPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return;

  try {
    const value = enabled ? 'true' : 'false';
    localStorage.setItem(APP_WIDESCREEN_STORAGE_KEY, value);
    localStorage.setItem(LEGACY_WORKSHOP_WIDESCREEN_STORAGE_KEY, value);
    window.dispatchEvent(new Event(APP_WIDESCREEN_CHANGED_EVENT));
  } catch {
    // Ignore localStorage access failures.
  }
}
