'use client';

import { isAccountSwitcherEnabled } from '@/lib/account-switch/feature-flag';
import type { AuthTransitionReason } from '@/lib/app-auth/transition';

const DEFERRED_UNAUTHENTICATED_REASONS = new Set<AuthTransitionReason>([
  'focus',
  'visibility',
  'online',
  'interval',
  'recover',
]);

export function shouldTreatAuthResponseAsLocked(options?: {
  statusCode?: number | null;
  payloadLocked?: boolean | null;
}): boolean {
  if (!isAccountSwitcherEnabled()) {
    return false;
  }

  return options?.statusCode === 423 || options?.payloadLocked === true;
}

export function getAuthFailureRedirectPath(statusCode?: number | null): string {
  return statusCode === 423 && isAccountSwitcherEnabled() ? '/lock' : '/login';
}

export function shouldDeferUnauthenticatedHandling(
  reason: AuthTransitionReason,
  options?: { silent?: boolean }
): boolean {
  return options?.silent === true && DEFERRED_UNAUTHENTICATED_REASONS.has(reason);
}
