'use client';

const ACCOUNT_SWITCH_TRANSITION_KEY = 'account_switch_transition_until';
const DEFAULT_TRANSITION_WINDOW_MS = 20_000;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

export function markAccountSwitchTransition(durationMs: number = DEFAULT_TRANSITION_WINDOW_MS): void {
  if (!isBrowser()) return;
  const expiresAt = Date.now() + durationMs;
  localStorage.setItem(ACCOUNT_SWITCH_TRANSITION_KEY, String(expiresAt));
}

export function clearAccountSwitchTransition(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(ACCOUNT_SWITCH_TRANSITION_KEY);
}

export function isAccountSwitchTransitionActive(): boolean {
  if (!isBrowser()) return false;
  const rawValue = localStorage.getItem(ACCOUNT_SWITCH_TRANSITION_KEY);
  if (!rawValue) return false;
  const expiresAt = Number(rawValue);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    localStorage.removeItem(ACCOUNT_SWITCH_TRANSITION_KEY);
    return false;
  }
  return true;
}
