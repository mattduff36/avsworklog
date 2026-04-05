'use client';

const ACCOUNT_SWITCH_DEVICE_ID_STORAGE_KEY = 'account_switch_device_id_v1';
const DEVICE_ID_MIN_LENGTH = 16;
const DEVICE_ID_MAX_LENGTH = 200;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function buildFallbackDeviceId(): string {
  const randomPart = Math.random().toString(36).slice(2);
  return `legacy-${Date.now()}-${randomPart}`;
}

function normalizeStoredDeviceId(rawValue: string | null): string | null {
  if (!rawValue) {
    return null;
  }

  const trimmed = rawValue.trim();
  if (trimmed.length < DEVICE_ID_MIN_LENGTH || trimmed.length > DEVICE_ID_MAX_LENGTH) {
    return null;
  }

  return trimmed;
}

export function getOrCreateAccountSwitchDeviceId(): string {
  if (!isBrowser()) {
    return '';
  }

  const existingValue = normalizeStoredDeviceId(
    localStorage.getItem(ACCOUNT_SWITCH_DEVICE_ID_STORAGE_KEY)
  );
  if (existingValue) {
    if (localStorage.getItem(ACCOUNT_SWITCH_DEVICE_ID_STORAGE_KEY) !== existingValue) {
      localStorage.setItem(ACCOUNT_SWITCH_DEVICE_ID_STORAGE_KEY, existingValue);
    }
    return existingValue;
  }

  const nextDeviceId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : buildFallbackDeviceId();

  localStorage.setItem(ACCOUNT_SWITCH_DEVICE_ID_STORAGE_KEY, nextDeviceId);
  return nextDeviceId;
}

export function getAccountSwitchDeviceId(): string | null {
  if (!isBrowser()) {
    return null;
  }

  const existingValue = normalizeStoredDeviceId(
    localStorage.getItem(ACCOUNT_SWITCH_DEVICE_ID_STORAGE_KEY)
  );
  if (!existingValue) {
    localStorage.removeItem(ACCOUNT_SWITCH_DEVICE_ID_STORAGE_KEY);
    return null;
  }

  return existingValue;
}

export function getAccountSwitchDeviceLabel(): string {
  if (typeof navigator === 'undefined') {
    return 'Unknown device';
  }

  const platform = navigator.platform || 'unknown-platform';
  return `Browser (${platform})`;
}
