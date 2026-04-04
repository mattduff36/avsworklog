import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/account-switch-auth', () => ({
  getAccountSwitchActorAccess: vi.fn(),
  verifyUserPassword: vi.fn(),
}));
vi.mock('@/lib/server/account-switch-device', () => ({
  parseAccountSwitchDeviceId: vi.fn(),
  getAccountSwitchDeviceCredential: vi.fn(),
  clearAccountSwitchDeviceCredentialLock: vi.fn(),
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

import { POST as passwordFallbackPost } from '@/app/api/account-switch/password-fallback/route';
import { getAccountSwitchActorAccess, verifyUserPassword } from '@/lib/server/account-switch-auth';
import {
  clearAccountSwitchDeviceCredentialLock,
  getAccountSwitchDeviceCredential,
  parseAccountSwitchDeviceId,
} from '@/lib/server/account-switch-device';

describe('account switch password fallback route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccountSwitchActorAccess).mockResolvedValue({
      access: { userId: 'user-1', email: 'user-1@example.com' },
      errorResponse: null,
    });
    vi.mocked(parseAccountSwitchDeviceId).mockReturnValue('device-1234567890abcdef');
    vi.mocked(getAccountSwitchDeviceCredential).mockResolvedValue({
      device: {
        id: 'device-row-1',
        profile_id: 'user-1',
        device_id_hash: 'hash',
        device_label: null,
        trusted_at: '2026-01-01T00:00:00.000Z',
        last_seen_at: '2026-01-01T00:00:00.000Z',
        revoked_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      credential: {
        profile_id: 'user-1',
        device_id: 'device-row-1',
        pin_hash: 'hash',
        pin_failed_attempts: 5,
        pin_locked_until: '2099-01-01T00:00:00.000Z',
        pin_last_changed_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('rejects invalid password', async () => {
    vi.mocked(verifyUserPassword).mockResolvedValue(false);

    const request = new Request('http://localhost/api/account-switch/password-fallback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'wrong',
        deviceId: 'device-1234567890abcdef',
      }),
    });

    const response = await passwordFallbackPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.code).toBe('PASSWORD_INVALID');
  });

  it('clears lock counters after valid password', async () => {
    vi.mocked(verifyUserPassword).mockResolvedValue(true);

    const request = new Request('http://localhost/api/account-switch/password-fallback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'correct',
        deviceId: 'device-1234567890abcdef',
      }),
    });

    const response = await passwordFallbackPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(clearAccountSwitchDeviceCredentialLock).toHaveBeenCalledWith({
      profileId: 'user-1',
      rawDeviceId: 'device-1234567890abcdef',
    });
  });
});
