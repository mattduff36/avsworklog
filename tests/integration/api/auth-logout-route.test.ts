import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SESSION_COOKIE_NAME } from '@/lib/server/app-auth/constants';

vi.mock('@/lib/server/account-switch-device', () => ({
  clearAccountSwitchDevicePin: vi.fn(),
  parseAccountSwitchDeviceId: vi.fn(() => null),
}));

vi.mock('@/lib/server/account-switch-audit', () => ({
  createAccountSwitchAuditEvent: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  revokeAppSession: vi.fn(),
  validateAppSession: vi.fn(),
}));

import { POST as logoutPost } from '@/app/api/auth/logout/route';
import { revokeAppSession, validateAppSession } from '@/lib/server/app-auth/session';

describe('auth logout route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateAppSession).mockResolvedValue({
      status: 'active',
      session: {
        id: 'session-1',
        profile_id: 'user-1',
      },
      profileId: 'user-1',
      email: 'user-1@example.com',
      cookieValue: null,
      cookieExpiresAt: null,
    } as never);
  });

  it('still clears auth cookies when logout revocation throws', async () => {
    vi.mocked(revokeAppSession).mockRejectedValue(new Error('database down'));

    const request = new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${APP_SESSION_COOKIE_NAME}=signed-cookie; sb-project-auth-token=legacy-token`,
      },
      body: JSON.stringify({}),
    });

    const response = await logoutPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('database down');
    expect(response.cookies.get(APP_SESSION_COOKIE_NAME)?.value).toBe('');
    expect(response.cookies.get('avs_account_locked')?.value).toBe('');
    expect(response.cookies.get('sb-project-auth-token')?.value).toBe('');
  });
});
