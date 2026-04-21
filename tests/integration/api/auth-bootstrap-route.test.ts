import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { APP_SESSION_COOKIE_NAME } from '@/lib/server/app-auth/constants';

const {
  getUser,
  validateAppSession,
  issueAppSession,
  createServerClient,
} = vi.hoisted(() => ({
  getUser: vi.fn(),
  validateAppSession: vi.fn(),
  issueAppSession: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: createServerClient.mockImplementation(() => ({
    auth: {
      getUser,
    },
  })),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  validateAppSession,
  issueAppSession,
}));

import { GET as bootstrapGet } from '@/app/api/auth/bootstrap/route';

describe('auth bootstrap route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAppSession.mockResolvedValue({
      status: 'missing',
      session: null,
      profileId: null,
      email: null,
      cookieValue: null,
      cookieExpiresAt: null,
    });
    issueAppSession.mockResolvedValue({
      row: { id: 'session-1' },
      cookieValue: 'signed-app-session',
      cookieExpiresAt: new Date('2026-12-31T00:00:00.000Z'),
    });
    getUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'user-1@example.com',
        },
      },
    });
  });

  it('redirects authenticated users to the requested destination and issues an app-session cookie', async () => {
    const request = new NextRequest('http://localhost/api/auth/bootstrap?returnTo=%2Fdashboard');
    const response = await bootstrapGet(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/dashboard');
    expect(response.cookies.get(APP_SESSION_COOKIE_NAME)?.value).toBeTruthy();
  });

  it('redirects unauthenticated users back to login', async () => {
    getUser.mockResolvedValueOnce({
      data: {
        user: null,
      },
    });

    const request = new NextRequest('http://localhost/api/auth/bootstrap?returnTo=%2Fdashboard');
    const response = await bootstrapGet(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/login');
  });
});
