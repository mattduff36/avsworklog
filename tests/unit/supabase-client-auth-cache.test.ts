import { afterEach, describe, expect, it, vi } from 'vitest';

function setupClientEnv(): void {
  vi.stubGlobal('window', {
    location: {
      origin: 'https://app.example.com',
    },
  } as unknown as Window);
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
    const { getClientServiceOutage } = await import('@/lib/app-auth/client-service-health');

    const client = createClient();
    await client.auth.getSession();
    expect(getLastDataTokenFailureStatus()).toBe(401);
    expect(getClientServiceOutage()).toBeNull();

    invalidateCachedDataToken();
    expect(getLastDataTokenFailureStatus()).toBeNull();
    expect(getClientServiceOutage()).toBeNull();
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

  it('reports and clears data token outage state around 5xx failures', async () => {
    setupClientEnv();

    vi.doMock('@/lib/app-auth/client-session', () => ({
      loadClientAuthSession: vi.fn(async () => ({
        status: 'authenticated',
        payload: {
          authenticated: true,
          locked: false,
          user: { id: 'user-3', email: 'user3@example.com' },
          profile: { id: 'profile-3' },
        },
        responseStatus: 200,
        error: null,
      })),
    }));

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => new Response(
        JSON.stringify({ error: 'Temporary failure' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      ))
      .mockImplementationOnce(async () => new Response(
        JSON.stringify({
          token: 'recovered-token',
          expires_at: Math.floor(Date.now() / 1000) + 3_600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ));
    vi.stubGlobal('fetch', fetchMock);

    const {
      createClient,
      invalidateCachedDataToken,
    } = await import('@/lib/supabase/client');
    const { getClientServiceOutage } = await import('@/lib/app-auth/client-service-health');

    const client = createClient();
    await client.auth.getSession();
    expect(getClientServiceOutage()).toMatchObject({
      source: 'data-token',
      status: 503,
    });

    invalidateCachedDataToken();
    expect(getClientServiceOutage()).toBeNull();

    await client.auth.getSession();
    expect(getClientServiceOutage()).toBeNull();
  });

  it('stops Supabase queries before sending an empty bearer token', async () => {
    setupClientEnv();

    vi.doMock('@/lib/app-auth/client-session', () => ({
      loadClientAuthSession: vi.fn(async () => ({
        status: 'authenticated',
        payload: {
          authenticated: true,
          locked: false,
          user: { id: 'user-4', email: 'user4@example.com' },
          profile: { id: 'profile-4' },
        },
        responseStatus: 200,
        error: null,
      })),
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);

      if (url.includes('/api/auth/data-token')) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createClient } = await import('@/lib/supabase/client');
    const client = createClient();

    const result = await client.from('profiles').select('id');

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain('Unauthorized');

    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      input instanceof Request ? input.url : String(input)
    );

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain('/api/auth/data-token');
  });
});
