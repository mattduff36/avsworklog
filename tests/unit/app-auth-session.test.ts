import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SESSION_COOKIE_VERSION } from '@/lib/server/app-auth/constants';

const {
  maybeSingleMock,
  singleMock,
  getUserByIdMock,
  getCurrentAppSessionCookiePayloadMock,
  buildAppSessionCookieValueMock,
  getAppAuthProfileMock,
  sha256HexMock,
} = vi.hoisted(() => ({
  maybeSingleMock: vi.fn(),
  singleMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  getCurrentAppSessionCookiePayloadMock: vi.fn(),
  buildAppSessionCookieValueMock: vi.fn(),
  getAppAuthProfileMock: vi.fn(),
  sha256HexMock: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: maybeSingleMock,
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: singleMock,
          })),
        })),
      })),
    })),
    auth: {
      admin: {
        getUserById: getUserByIdMock,
      },
    },
  })),
}));

vi.mock('@/lib/server/app-auth/cookies', () => ({
  getCurrentAppSessionCookiePayload: getCurrentAppSessionCookiePayloadMock,
  buildAppSessionCookieValue: buildAppSessionCookieValueMock,
}));

vi.mock('@/lib/server/app-auth/profile', () => ({
  getAppAuthProfile: getAppAuthProfileMock,
}));

vi.mock('@/lib/server/app-auth/jwt', () => ({
  randomToken: vi.fn(),
  sha256Hex: sha256HexMock,
}));

vi.mock('@/lib/server/account-switch-audit', () => ({
  createAccountSwitchAuditEvent: vi.fn(),
}));

vi.mock('@/lib/server/account-switch-device', () => ({
  getAccountSwitchDevice: vi.fn(),
  upsertAccountSwitchDevice: vi.fn(),
}));

import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import { validateAppSession } from '@/lib/server/app-auth/session';

describe('app auth session helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-04T12:00:00.000Z'));

    maybeSingleMock.mockResolvedValue({
      data: {
        id: 'session-1',
        profile_id: 'user-1',
        device_id: null,
        session_secret_hash: 'hashed-secret',
        session_source: 'password_login',
        remember_me: true,
        locked_at: '2026-04-04T11:00:00.000Z',
        last_seen_at: '2026-04-04T12:00:00.000Z',
        idle_expires_at: '2026-04-05T12:00:00.000Z',
        absolute_expires_at: '2026-04-30T12:00:00.000Z',
        revoked_at: null,
        revoked_reason: null,
        replaced_by_session_id: null,
        user_agent: null,
        ip_hash: null,
        created_at: '2026-04-04T10:00:00.000Z',
        updated_at: '2026-04-04T12:00:00.000Z',
      },
      error: null,
    });
    getUserByIdMock.mockResolvedValue({
      data: {
        user: {
          email: 'user-1@example.com',
        },
      },
      error: null,
    });
    getCurrentAppSessionCookiePayloadMock.mockResolvedValue({
      sid: 'session-1',
      secret: 'raw-secret',
      locked: true,
      exp: Math.floor(new Date('2026-04-05T12:00:00.000Z').getTime() / 1000),
      v: APP_SESSION_COOKIE_VERSION,
    });
    sha256HexMock.mockImplementation(async (value: string) => {
      if (value === 'app-session:raw-secret') {
        return 'hashed-secret';
      }
      return `hash:${value}`;
    });
    getAppAuthProfileMock.mockResolvedValue({
      id: 'user-1',
      email: 'user-1@example.com',
      full_name: 'User One',
      role: null,
      team: null,
    });
    buildAppSessionCookieValueMock.mockResolvedValue('unused-cookie');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for locked sessions unless explicitly allowed', async () => {
    const current = await getCurrentAuthenticatedProfile();

    expect(current).toBeNull();
    expect(getAppAuthProfileMock).not.toHaveBeenCalled();
  });

  it('returns the refreshed session row after activity updates', async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: 'session-1',
        profile_id: 'user-1',
        device_id: null,
        session_secret_hash: 'hashed-secret',
        session_source: 'password_login',
        remember_me: true,
        locked_at: null,
        last_seen_at: '2026-04-04T11:55:00.000Z',
        idle_expires_at: '2026-04-05T12:00:00.000Z',
        absolute_expires_at: '2026-04-30T12:00:00.000Z',
        revoked_at: null,
        revoked_reason: null,
        replaced_by_session_id: null,
        user_agent: null,
        ip_hash: null,
        created_at: '2026-04-04T10:00:00.000Z',
        updated_at: '2026-04-04T11:55:00.000Z',
      },
      error: null,
    });
    getCurrentAppSessionCookiePayloadMock.mockResolvedValueOnce({
      sid: 'session-1',
      secret: 'raw-secret',
      locked: false,
      exp: Math.floor(new Date('2026-04-05T12:00:00.000Z').getTime() / 1000),
      v: APP_SESSION_COOKIE_VERSION,
    });
    singleMock.mockResolvedValueOnce({
      data: {
        id: 'session-1',
        profile_id: 'user-1',
        device_id: null,
        session_secret_hash: 'hashed-secret',
        session_source: 'password_login',
        remember_me: true,
        locked_at: null,
        last_seen_at: '2026-04-04T12:00:00.000Z',
        idle_expires_at: '2026-04-05T12:00:00.000Z',
        absolute_expires_at: '2026-04-30T12:00:00.000Z',
        revoked_at: null,
        revoked_reason: null,
        replaced_by_session_id: null,
        user_agent: null,
        ip_hash: null,
        created_at: '2026-04-04T10:00:00.000Z',
        updated_at: '2026-04-04T12:00:00.000Z',
      },
      error: null,
    });

    const validation = await validateAppSession();

    expect(validation.status).toBe('active');
    expect(validation.session?.last_seen_at).toBe('2026-04-04T12:00:00.000Z');
    expect(validation.session?.updated_at).toBe('2026-04-04T12:00:00.000Z');
    expect(validation.cookieValue).toBe('unused-cookie');
  });

  it('returns the locked profile when allowLocked is enabled', async () => {
    const current = await getCurrentAuthenticatedProfile({ allowLocked: true });

    expect(current?.validation.status).toBe('locked');
    expect(current?.profile.id).toBe('user-1');
    expect(getAppAuthProfileMock).toHaveBeenCalledWith('user-1', 'user-1@example.com');
  });
});
