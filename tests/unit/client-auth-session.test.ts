import { afterEach, describe, expect, it, vi } from 'vitest';

describe('loadClientAuthSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('dedupes concurrent in-flight auth session requests', async () => {
    const fetchMock = vi.fn(async () => {
      await Promise.resolve();

      return new Response(
        JSON.stringify({
          authenticated: true,
          locked: false,
          user: { id: 'user-123', email: 'test@example.com' },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    const { loadClientAuthSession } = await import('@/lib/app-auth/client-session');
    const [first, second] = await Promise.all([
      loadClientAuthSession(),
      loadClientAuthSession(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.status).toBe('authenticated');
  });

  it('returns a locked result when the session payload is locked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(
        JSON.stringify({
          authenticated: true,
          locked: true,
          user: { id: 'user-123', email: 'locked@example.com' },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      ))
    );

    const { loadClientAuthSession } = await import('@/lib/app-auth/client-session');
    const result = await loadClientAuthSession();

    expect(result.status).toBe('locked');
    expect(result.payload?.locked).toBe(true);
  });

  it('returns an unauthenticated result for a 401 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(
        JSON.stringify({
          authenticated: false,
          locked: false,
          user: null,
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      ))
    );

    const { loadClientAuthSession } = await import('@/lib/app-auth/client-session');
    const result = await loadClientAuthSession();

    expect(result.status).toBe('unauthenticated');
    expect(result.responseStatus).toBe(401);
  });
});
