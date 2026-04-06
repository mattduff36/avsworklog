import { afterEach, describe, expect, it, vi } from 'vitest';

function setupClientEnv(): void {
  vi.stubGlobal('window', {} as Window);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('supabase client auth token cache', () => {
  it('tracks failure status and clears it on invalidation', async () => {
    setupClientEnv();

    vi.doMock('@/lib/app-auth/client-session', () => ({
      loadClientAuthSession: vi.fn(async () => ({
        status: 'authenticated',
        payload: {
          authenticated: true,
          locked: false,
          user: { id: 'user-1', email: 'user@example.com' },
          profile: { id: 'profile-1' },
        },
        responseStatus: 200,
        error: null,
      })),
    }));

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )));

    const {
      createClient,
      getLastDataTokenFailureStatus,
      invalidateCachedDataToken,
    } = await import('@/lib/supabase/client');

    const client = createClient();
    await client.auth.getSession();
    expect(getLastDataTokenFailureStatus()).toBe(401);

    invalidateCachedDataToken();
    expect(getLastDataTokenFailureStatus()).toBeNull();
  });

  it('re-fetches data token after cache invalidation', async () => {
    setupClientEnv();

    vi.doMock('@/lib/app-auth/client-session', () => ({
      loadClientAuthSession: vi.fn(async () => ({
        status: 'authenticated',
        payload: {
          authenticated: true,
          locked: false,
          user: { id: 'user-2', email: 'user2@example.com' },
          profile: { id: 'profile-2' },
        },
        responseStatus: 200,
        error: null,
      })),
    }));

    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        token: `token-${fetchMock.mock.calls.length + 1}`,
        expires_at: Math.floor(Date.now() / 1000) + 3_600,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    vi.stubGlobal('fetch', fetchMock);

    const { createClient, invalidateCachedDataToken } = await import('@/lib/supabase/client');
    const client = createClient();

    await client.auth.getSession();
    await client.auth.getSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    invalidateCachedDataToken();
    await client.auth.getSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
