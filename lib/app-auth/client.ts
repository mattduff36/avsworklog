'use client';

const AUTH_EVENT_STORAGE_KEY = 'avs_auth_event_v1';
const LEGACY_SHORTCUT_STORAGE_KEY = 'account_switch_shortcuts_v1';
const LEGACY_TRANSITION_STORAGE_KEY = 'account_switch_transition_until';
const LEGACY_LOCK_COOKIE_NAME = 'avs_account_locked';
const AUTH_CHANNEL_NAME = 'avs-auth-session';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function setCookie(name: string, value: string, maxAgeSeconds?: number): void {
  if (!isBrowser()) return;

  const maxAgePart = typeof maxAgeSeconds === 'number' ? `; Max-Age=${maxAgeSeconds}` : '';
  document.cookie = `${name}=${value}; Path=/; SameSite=Lax${maxAgePart}`;
}

export function clearLegacyAccountSwitchClientState(): void {
  if (!isBrowser()) {
    return;
  }

  localStorage.removeItem(LEGACY_SHORTCUT_STORAGE_KEY);
  localStorage.removeItem(LEGACY_TRANSITION_STORAGE_KEY);
  setCookie(LEGACY_LOCK_COOKIE_NAME, '', 0);
}

export function broadcastAuthStateChange(eventName: string): void {
  if (!isBrowser()) {
    return;
  }

  const payload = JSON.stringify({
    event: eventName,
    at: Date.now(),
  });

  localStorage.setItem(AUTH_EVENT_STORAGE_KEY, payload);

  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
    channel.postMessage(payload);
    channel.close();
  }
}

export function subscribeToAuthStateChange(callback: () => void): () => void {
  if (!isBrowser()) {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === AUTH_EVENT_STORAGE_KEY) {
      callback();
    }
  };

  window.addEventListener('storage', handleStorage);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
    channel.addEventListener('message', callback);
  }

  return () => {
    window.removeEventListener('storage', handleStorage);
    channel?.close();
  };
}
