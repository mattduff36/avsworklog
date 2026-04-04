export const ACCOUNT_SWITCH_LOCK_COOKIE_NAME = 'avs_account_locked';

export function buildLockPathWithReturnTo(returnTo: string): string {
  const encodedReturnTo = encodeURIComponent(returnTo);
  return `/lock?returnTo=${encodedReturnTo}`;
}

export function setAccountLockedClientState(isLocked: boolean): void {
  if (typeof document === 'undefined') return;

  if (isLocked) {
    document.cookie = `${ACCOUNT_SWITCH_LOCK_COOKIE_NAME}=1; Path=/; SameSite=Lax`;
    return;
  }

  document.cookie = `${ACCOUNT_SWITCH_LOCK_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}
