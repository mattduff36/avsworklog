'use client';

const ACCOUNT_SWITCH_DEVICE_ID_STORAGE_KEY = 'account_switch_device_id_v1';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function buildFallbackDeviceId(): string {
  const randomPart = Math.random().toString(36).slice(2);
  return `legacy-${Date.now()}-${randomPart}`;
}

export function getOrCreateAccountSwitchDeviceId(): string {
  if (!isBrowser()) {
    return '';
  }

  const existingValue = localStorage.getItem(ACCOUNT_SWITCH_DEVICE_ID_STORAGE_KEY);
  if (existingValue && existingValue.trim().length > 0) {
    return existingValue;
  }

  const nextDeviceId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : buildFallbackDeviceId();

  localStorage.setItem(ACCOUNT_SWITCH_DEVICE_ID_STORAGE_KEY, nextDeviceId);
  return nextDeviceId;
}

export function getAccountSwitchDeviceLabel(): string {
  if (typeof navigator === 'undefined') {
    return 'Unknown device';
  }

  const platform = navigator.platform || 'unknown-platform';
  return `Browser (${platform})`;
}
