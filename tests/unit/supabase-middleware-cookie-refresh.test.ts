import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: createServerClientMock,
}));

import { updateSession } from '@/lib/supabase/middleware';

interface MockMiddlewareOptions {
  user: { id: string } | null;
  cookiesToSet?: Array<{
    name: string;
    value: string;
    options?: Record<string, unknown>;
  }>;
}

function mockSupabaseMiddlewareAuth(options: MockMiddlewareOptions): void {
  createServerClientMock.mockImplementation((_url, _key, config) => ({
    auth: {
      getUser: vi.fn(async () => {
        if (options.cookiesToSet) {
          config.cookies.setAll(options.cookiesToSet);
        }

        return {
          data: {
            user: options.user,
          },
          error: null,
        };
      }),
    },
  }));
}

describe('supabase middleware cookie refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('preserves refreshed cookies on root redirects for authenticated users', async () => {
    mockSupabaseMiddlewareAuth({
      user: { id: 'user-1' },
      cookiesToSet: [
        {
          name: 'sb-refresh-token',
          value: 'rotated-root-token',
          options: { path: '/', httpOnly: true },
        },
      ],
    });

    const response = await updateSession(new NextRequest('http://localhost/'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/dashboard');
    expect(response.cookies.get('sb-refresh-token')?.value).toBe('rotated-root-token');
  });

  it('preserves refreshed cookies on authenticated /login redirects', async () => {
    mockSupabaseMiddlewareAuth({
      user: { id: 'user-2' },
      cookiesToSet: [
        {
          name: 'sb-refresh-token',
          value: 'rotated-login-token',
          options: { path: '/', httpOnly: true },
        },
      ],
    });

    const response = await updateSession(new NextRequest('http://localhost/login'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/dashboard');
    expect(response.cookies.get('sb-refresh-token')?.value).toBe('rotated-login-token');
  });

  it('preserves refreshed cookies on protected page redirects to login', async () => {
    mockSupabaseMiddlewareAuth({
      user: null,
      cookiesToSet: [
        {
          name: 'sb-refresh-token',
          value: '',
          options: { path: '/', maxAge: 0 },
        },
      ],
    });

    const response = await updateSession(new NextRequest('http://localhost/dashboard'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/login?redirect=%2Fdashboard');
    expect(response.cookies.get('sb-refresh-token')?.value).toBe('');
  });

  it('preserves refreshed cookies on unauthorized API json responses', async () => {
    mockSupabaseMiddlewareAuth({
      user: null,
      cookiesToSet: [
        {
          name: 'sb-refresh-token',
          value: '',
          options: { path: '/', maxAge: 0 },
        },
      ],
    });

    const response = await updateSession(new NextRequest('http://localhost/api/private'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(response.cookies.get('sb-refresh-token')?.value).toBe('');
  });
});
