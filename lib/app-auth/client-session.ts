'use client';

import { createStatusError, getErrorStatus } from '@/lib/utils/http-error';

export interface ClientAuthSessionUser {
  id: string;
  email: string | null;
}

export interface ClientAuthSessionResponse {
  authenticated: boolean;
  locked: boolean;
  user: ClientAuthSessionUser | null;
  profile?: unknown;
  data_token_available?: boolean;
}

export interface ClientAuthSessionResult {
  status: 'authenticated' | 'locked' | 'unauthenticated' | 'error';
  payload: ClientAuthSessionResponse | null;
  responseStatus: number | null;
  error: Error | null;
}

let pendingClientAuthSessionPromise: Promise<ClientAuthSessionResult> | null = null;

function parseSessionPayload(rawPayload: string): ClientAuthSessionResponse | null {
  if (!rawPayload) {
    return null;
  }

  try {
    return JSON.parse(rawPayload) as ClientAuthSessionResponse;
  } catch (error) {
    throw createStatusError('Invalid auth session response payload', undefined, error);
  }
}

async function requestClientAuthSession(): Promise<ClientAuthSessionResult> {
  const response = await fetch('/api/auth/session', {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache',
    },
  });

  const payload = parseSessionPayload(await response.text());

  if (response.status === 401) {
    return {
      status: 'unauthenticated',
      payload,
      responseStatus: response.status,
      error: null,
    };
  }

  if (response.status === 423 || payload?.locked === true) {
    return {
      status: 'locked',
      payload,
      responseStatus: response.status,
      error: null,
    };
  }

  if (!response.ok) {
    throw createStatusError(payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error?: unknown }).error || `HTTP ${response.status}`)
      : `HTTP ${response.status}`, response.status);
  }

  if (!payload?.authenticated || !payload.user?.id) {
    return {
      status: 'unauthenticated',
      payload,
      responseStatus: response.status,
      error: null,
    };
  }

  return {
    status: 'authenticated',
    payload,
    responseStatus: response.status,
    error: null,
  };
}

export async function loadClientAuthSession(): Promise<ClientAuthSessionResult> {
  if (pendingClientAuthSessionPromise) {
    return pendingClientAuthSessionPromise;
  }

  pendingClientAuthSessionPromise = (async () => {
    try {
      return await requestClientAuthSession();
    } catch (error) {
      return {
        status: 'error',
        payload: null,
        responseStatus: getErrorStatus(error),
        error: error instanceof Error ? error : new Error('Failed to load auth session'),
      };
    } finally {
      pendingClientAuthSessionPromise = null;
    }
  })();

  return pendingClientAuthSessionPromise;
}
