import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { APP_SESSION_COOKIE_NAME } from '@/lib/server/app-auth/constants';

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  validateAppSession: vi.fn(),
  issueAppSession: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/response', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/app-auth/response')>(
    '@/lib/server/app-auth/response'
  );
  return {
    ...actual,
    clearAllAuthCookies: vi.fn(),
  };
});

import { GET as bootstrapGet } from '@/app/api/auth/bootstrap/route';
import { validateAppSession } from '@/lib/server/app-auth/session';

describe('auth bootstrap route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies refreshed validation cookies on early redirect', async () => {
    vi.mocked(validateAppSession).mockResolvedValue({
      status: 'active',
      session: {
        id: 'session-1',
        profile_id: 'user-1',
        device_id: null,
        session_secret_hash: 'hash',
        session_source: 'password_login',
        remember_me: true,
        locked_at: null,
        last_seen_at: '2026-04-04T00:00:00.000Z',
        idle_expires_at: '2026-04-05T00:00:00.000Z',
        absolute_expires_at: '2026-04-30T00:00:00.000Z',
        revoked_at: null,
        revoked_reason: null,
        replaced_by_session_id: null,
        user_agent: null,
        ip_hash: null,
        created_at: '2026-04-04T00:00:00.000Z',
        updated_at: '2026-04-04T00:00:00.000Z',
      },
      profileId: 'user-1',
      email: 'user-1@example.com',
      cookieValue: 'rotated-cookie-value',
      cookieExpiresAt: new Date('2026-04-05T00:00:00.000Z'),
    });

    const request = new NextRequest('http://localhost/api/auth/bootstrap?returnTo=%2Fdashboard');
    const response = await bootstrapGet(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/dashboard');
    expect(response.cookies.get(APP_SESSION_COOKIE_NAME)?.value).toBe('rotated-cookie-value');
  });
});
