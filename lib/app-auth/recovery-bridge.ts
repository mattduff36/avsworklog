'use client';

import { isAuthErrorStatus } from '@/lib/utils/http-error';

type RecoverFromAuthFailure = (options?: { statusCode?: number | null }) => Promise<boolean>;
type ForceAuthRedirect = (statusCode?: number | null) => Promise<void>;

interface AuthRecoveryHandlers {
  recoverFromAuthFailure: RecoverFromAuthFailure;
  forceAuthRedirect: ForceAuthRedirect;
}

interface HandleAuthFailureOptions {
  allowRecovery?: boolean;
  fallbackToRedirect?: boolean;
}

let registeredHandlers: AuthRecoveryHandlers | null = null;
let pendingRecoveryPromise: Promise<boolean> | null = null;

function getFallbackRedirectPath(statusCode?: number | null): string {
  return statusCode === 423 ? '/lock' : '/login';
}

async function fallbackRedirect(statusCode?: number | null): Promise<boolean> {
  if (typeof window !== 'undefined') {
    window.location.replace(getFallbackRedirectPath(statusCode));
  }
  return false;
}

export function registerAuthRecoveryHandlers(handlers: AuthRecoveryHandlers): () => void {
  registeredHandlers = handlers;
  return () => {
    if (registeredHandlers === handlers) {
      registeredHandlers = null;
    }
  };
}

export async function handleAuthFailureStatus(
  statusCode?: number | null,
  options?: HandleAuthFailureOptions
): Promise<boolean> {
  if (!isAuthErrorStatus(statusCode)) {
    return false;
  }

  if (pendingRecoveryPromise) {
    return pendingRecoveryPromise;
  }

  const allowRecovery = options?.allowRecovery !== false;
  const fallbackToRedirect = options?.fallbackToRedirect !== false;

  if (!registeredHandlers) {
    if (fallbackToRedirect) {
      return fallbackRedirect(statusCode);
    }
    return false;
  }

  pendingRecoveryPromise = (async () => {
    try {
      if (!allowRecovery) {
        await registeredHandlers?.forceAuthRedirect(statusCode);
        return false;
      }

      return await registeredHandlers.recoverFromAuthFailure({ statusCode });
    } catch {
      if (fallbackToRedirect) {
        return fallbackRedirect(statusCode);
      }
      return false;
    }
  })().finally(() => {
    pendingRecoveryPromise = null;
  });

  return pendingRecoveryPromise;
}
