import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: vi.fn(),
  issueAppSession: vi.fn(),
  revokeAppSession: vi.fn(),
}));
vi.mock('@/lib/server/account-switch-device', () => ({
  parseAccountSwitchDeviceId: vi.fn(),
  getAccountSwitchDeviceCredential: vi.fn(),
  updateAccountSwitchDeviceCredentialState: vi.fn(),
  clearAccountSwitchDeviceCredentialLock: vi.fn(),
}));
vi.mock('@/lib/server/account-switch-pin', () => ({
  ACCOUNT_SWITCH_MAX_PIN_ATTEMPTS: 5,
  getAccountSwitchLockUntil: vi.fn(() => '2099-01-01T00:00:00.000Z'),
  isPinLockActive: vi.fn(),
  verifyQuickSwitchPin: vi.fn(),
}));
vi.mock('@/lib/server/account-switch-audit', () => ({
  createAccountSwitchAuditEvent: vi.fn(),
}));
vi.mock('@/lib/server/account-switch-route-helpers', () => ({
  getAccountSwitcherDisabledResponse: vi.fn(() => null),
  buildAccountSwitchErrorResponse: vi.fn(
    (code: string, error: string, status: number, details?: Record<string, unknown>) =>
      Response.json({ code, error, ...(details ? { details } : {}) }, { status })
  ),
}));
vi.mock('@/lib/server/app-auth/profile', () => ({
  getAppAuthProfile: vi.fn(),
}));

import { POST as unlockPost } from '@/app/api/account-switch/unlock/route';
import {
  clearAccountSwitchDeviceCredentialLock,
  getAccountSwitchDeviceCredential,
  parseAccountSwitchDeviceId,
  updateAccountSwitchDeviceCredentialState,
} from '@/lib/server/account-switch-device';
import { verifyQuickSwitchPin, isPinLockActive } from '@/lib/server/account-switch-pin';
import {
  getCurrentAuthenticatedProfile,
  issueAppSession,
  revokeAppSession,
} from '@/lib/server/app-auth/session';
import { getAppAuthProfile } from '@/lib/server/app-auth/profile';

describe('account switch unlock route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentAuthenticatedProfile).mockResolvedValue({
      validation: {
        status: 'locked',
        session: {
          id: 'locked-session-1',
          profile_id: 'user-2',
          device_id: 'device-row-1',
          session_secret_hash: 'hash',
          session_source: 'password_login',
          remember_me: true,
          locked_at: '2026-04-04T00:00:00.000Z',
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
        profileId: 'user-2',
        email: 'user-2@example.com',
        cookieValue: null,
        cookieExpiresAt: null,
      },
      profile: {
        id: 'user-2',
        full_name: 'User Two',
      },
    } as never);
    vi.mocked(parseAccountSwitchDeviceId).mockReturnValue('device-1234567890abcdef');
    vi.mocked(getAccountSwitchDeviceCredential).mockResolvedValue({
      device: {
        id: 'device-row-1',
        profile_id: 'user-1',
      },
      credential: {
        profile_id: 'user-1',
        device_id: 'device-row-1',
        pin_hash: 'hashed-pin',
        pin_failed_attempts: 0,
        pin_locked_until: null,
        pin_last_changed_at: null,
        created_at: '2026-04-04T00:00:00.000Z',
        updated_at: '2026-04-04T00:00:00.000Z',
      },
    } as never);
    vi.mocked(isPinLockActive).mockReturnValue(false);
    vi.mocked(issueAppSession).mockResolvedValue({
      row: {
        id: 'new-session-1',
        profile_id: 'user-1',
      },
      cookieValue: 'signed-cookie',
      cookieExpiresAt: new Date('2026-04-05T00:00:00.000Z'),
    } as never);
    vi.mocked(getAppAuthProfile).mockResolvedValue({
      id: 'user-1',
      full_name: 'User One',
      avatar_url: null,
      role: { name: 'manager' },
    } as never);
  });

  it('increments failed attempts when the PIN is incorrect', async () => {
    vi.mocked(verifyQuickSwitchPin).mockReturnValue(false);

    const request = new Request('http://localhost/api/account-switch/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetProfileId: 'user-1',
        pin: '2581',
        deviceId: 'device-1234567890abcdef',
      }),
    });

    const response = await unlockPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.code).toBe('PIN_INCORRECT');
    expect(updateAccountSwitchDeviceCredentialState).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 'user-1',
        pinFailedAttempts: 1,
      })
    );
    expect(issueAppSession).not.toHaveBeenCalled();
  });

  it('issues a fresh app session when the PIN is valid', async () => {
    vi.mocked(verifyQuickSwitchPin).mockReturnValue(true);

    const request = new Request('http://localhost/api/account-switch/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetProfileId: 'user-1',
        pin: '2580',
        deviceId: 'device-1234567890abcdef',
      }),
    });

    const response = await unlockPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(clearAccountSwitchDeviceCredentialLock).toHaveBeenCalledWith({
      profileId: 'user-1',
      rawDeviceId: 'device-1234567890abcdef',
    });
    expect(issueAppSession).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 'user-1',
        source: 'pin_unlock',
        rawDeviceId: 'device-1234567890abcdef',
      })
    );
    expect(revokeAppSession).toHaveBeenCalledWith(
      'locked-session-1',
      'replaced_by_pin_unlock',
      'new-session-1'
    );
  });
});
