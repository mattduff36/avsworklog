import { beforeEach, describe, expect, it, vi } from 'vitest';

const signInWithPassword = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithPassword,
    },
  })),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  validateAppSession: vi.fn(),
  issueAppSession: vi.fn(),
  revokeAppSession: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/profile', () => ({
  getAppAuthProfile: vi.fn(),
}));

import { POST as loginPost } from '@/app/api/auth/login/route';
import {
  issueAppSession,
  revokeAppSession,
  validateAppSession,
} from '@/lib/server/app-auth/session';
import { getAppAuthProfile } from '@/lib/server/app-auth/profile';

describe('auth login route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    vi.mocked(validateAppSession).mockResolvedValue({
      status: 'missing',
      session: null,
      profileId: null,
      email: null,
      cookieValue: null,
      cookieExpiresAt: null,
    });
    vi.mocked(issueAppSession).mockResolvedValue({
      row: {
        id: 'app-session-1',
        profile_id: 'user-1',
        device_id: 'device-row-1',
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
      cookieValue: 'signed-cookie',
      cookieExpiresAt: new Date('2026-04-05T00:00:00.000Z'),
    });
    vi.mocked(getAppAuthProfile).mockResolvedValue({
      id: 'user-1',
      full_name: 'User One',
      phone_number: null,
      employee_id: '001',
      avatar_url: null,
      must_change_password: false,
      annual_holiday_allowance_days: null,
      super_admin: false,
      team_id: null,
      team: null,
      role: null,
      email: 'user-1@example.com',
    });
  });

  it('returns 401 when Supabase rejects the password', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    });

    const request = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user-1@example.com',
        password: 'wrong-password',
      }),
    });

    const response = await loginPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Invalid email or password');
    expect(issueAppSession).not.toHaveBeenCalled();
  });

  it('issues a fresh app session on valid password login', async () => {
    signInWithPassword.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'user-1@example.com',
        },
      },
      error: null,
    });

    const request = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user-1@example.com',
        password: 'correct-password',
        rememberMe: true,
        deviceId: 'device-1234567890abcdef',
        deviceLabel: 'Browser (Windows)',
      }),
    });

    const response = await loginPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(issueAppSession).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 'user-1',
        source: 'password_login',
        rememberMe: true,
        rawDeviceId: 'device-1234567890abcdef',
      })
    );
    expect(revokeAppSession).not.toHaveBeenCalled();
  });

  it('retries with a trimmed password when only edge whitespace differs', async () => {
    signInWithPassword
      .mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Invalid login credentials' },
      })
      .mockResolvedValueOnce({
        data: {
          user: {
            id: 'user-1',
            email: 'user-1@example.com',
          },
        },
        error: null,
      });

    const request = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user-1@example.com',
        password: '  correct-password  ',
      }),
    });

    const response = await loginPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(signInWithPassword).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        email: 'user-1@example.com',
        password: '  correct-password  ',
      })
    );
    expect(signInWithPassword).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        email: 'user-1@example.com',
        password: 'correct-password',
      })
    );
  });
});
