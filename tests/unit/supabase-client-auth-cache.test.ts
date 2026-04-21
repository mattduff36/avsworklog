import { afterEach, describe, expect, it, vi } from 'vitest';

const { createBrowserClientMock, getViewAsRoleIdMock, getViewAsTeamIdMock } = vi.hoisted(() => ({
  createBrowserClientMock: vi.fn(),
  getViewAsRoleIdMock: vi.fn(),
  getViewAsTeamIdMock: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: createBrowserClientMock,
}));

vi.mock('@/lib/utils/view-as-cookie', () => ({
  getViewAsRoleId: getViewAsRoleIdMock,
  getViewAsTeamId: getViewAsTeamIdMock,
}));

function setupClientEnv(): void {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  vi.stubGlobal('window', {
    location: {
      origin: 'https://app.example.com',
    },
  } as unknown as Window);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('supabase browser client', () => {
  it('creates a singleton browser client and keeps legacy cache helpers as no-ops', async () => {
    setupClientEnv();

    const browserClient = { auth: {} };
    createBrowserClientMock.mockReturnValue(browserClient);

    const {
      createClient,
      getLastDataTokenFailureStatus,
      invalidateCachedDataToken,
    } = await import('@/lib/supabase/client');

    expect(createClient()).toBe(browserClient);
    expect(createClient()).toBe(browserClient);
    expect(createBrowserClientMock).toHaveBeenCalledTimes(1);

    invalidateCachedDataToken();
    expect(getLastDataTokenFailureStatus()).toBeNull();
  });

  it('injects view-as headers into Supabase fetches', async () => {
    setupClientEnv();
    getViewAsRoleIdMock.mockReturnValue('role-123');
    getViewAsTeamIdMock.mockReturnValue('team-456');

    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    createBrowserClientMock.mockImplementation((_url, _key, options) => {
      return {
        auth: {},
        options,
      };
    });

    const { createClient } = await import('@/lib/supabase/client');
    const client = createClient() as {
      options: {
        global: {
          fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
        };
      };
    };

    await client.options.global.fetch('https://example.supabase.co/rest/v1/profiles', {});

    const [, init] = fetchSpy.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('x-view-as-role-id')).toBe('role-123');
    expect(headers.get('x-view-as-team-id')).toBe('team-456');
  });
});
