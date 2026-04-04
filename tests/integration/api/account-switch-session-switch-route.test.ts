import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/account-switch-auth', () => ({
  getAccountSwitchActorAccess: vi.fn(),
}));
vi.mock('@/lib/server/account-switch-device', () => ({
  parseAccountSwitchDeviceId: vi.fn(),
  getAccountSwitchDeviceCredential: vi.fn(),
  updateAccountSwitchDeviceCredentialState: vi.fn(),
  clearAccountSwitchDeviceCredentialLock: vi.fn(),
  touchAccountSwitchDeviceSession: vi.fn(),
}));
vi.mock('@/lib/server/account-switch-pin', () => ({
  ACCOUNT_SWITCH_MAX_PIN_ATTEMPTS: 5,
  getAccountSwitchLockUntil: vi.fn(() => '2099-01-01T00:00:00.000Z'),
  isPinLockActive: vi.fn(),
  verifyQuickSwitchPin: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/lib/server/account-switch-audit', () => ({
  createAccountSwitchAuditEvent: vi.fn(),
}));
vi.mock('@/lib/server/account-switch-route-helpers', () => ({
  getAccountSwitcherDisabledResponse: vi.fn(() => null),
  buildAccountSwitchErrorResponse: vi.fn((code: string, error: string, status: number, details?: Record<string, unknown>) =>
    Response.json({ code, error, ...(details ? { details } : {}) }, { status })
  ),
}));

import { POST as switchSessionPost } from '@/app/api/account-switch/session/switch/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAccountSwitchActorAccess } from '@/lib/server/account-switch-auth';
import {
  clearAccountSwitchDeviceCredentialLock,
  getAccountSwitchDeviceCredential,
  parseAccountSwitchDeviceId,
  touchAccountSwitchDeviceSession,
  updateAccountSwitchDeviceCredentialState,
} from '@/lib/server/account-switch-device';
import { isPinLockActive, verifyQuickSwitchPin } from '@/lib/server/account-switch-pin';

function createProfileLookupChain() {
  const single = vi.fn().mockResolvedValue({
    data: {
      id: 'target-user',
      full_name: 'Target User',
      avatar_url: null,
      role: { name: 'employee' },
    },
    error: null,
  });
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from };
}

describe('account switch session switch route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccountSwitchActorAccess).mockResolvedValue({
      access: { userId: 'user-1', email: 'user-1@example.com' },
      errorResponse: null,
    });
    vi.mocked(parseAccountSwitchDeviceId).mockReturnValue('device-1234567890abcdef');
    vi.mocked(getAccountSwitchDeviceCredential).mockResolvedValue({
      device: {
        id: 'device-row-target',
        profile_id: 'target-user',
        device_id_hash: 'hash',
        device_label: null,
        trusted_at: '2026-01-01T00:00:00.000Z',
        last_seen_at: '2026-01-01T00:00:00.000Z',
        revoked_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      credential: {
        profile_id: 'target-user',
        device_id: 'device-row-target',
        pin_hash: 'hashed-pin',
        pin_failed_attempts: 0,
        pin_locked_until: null,
        pin_last_changed_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('rejects missing device id', async () => {
    vi.mocked(parseAccountSwitchDeviceId).mockReturnValue(null);

    const request = new Request('http://localhost/api/account-switch/session/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetProfileId: 'target-user', pin: '2580' }),
    });

    const response = await switchSessionPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('DEVICE_ID_REQUIRED');
  });

  it('increments lock state when pin is incorrect', async () => {
    vi.mocked(isPinLockActive).mockReturnValue(false);
    vi.mocked(verifyQuickSwitchPin).mockReturnValue(false);

    const request = new Request('http://localhost/api/account-switch/session/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetProfileId: 'target-user',
        pin: '2581',
        deviceId: 'device-1234567890abcdef',
      }),
    });

    const response = await switchSessionPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.code).toBe('PIN_INCORRECT');
    expect(updateAccountSwitchDeviceCredentialState).toHaveBeenCalledWith(
      expect.objectContaining({ pinFailedAttempts: 1 })
    );
  });

  it('switches successfully on valid pin', async () => {
    const profileLookup = createProfileLookupChain();
    vi.mocked(createAdminClient).mockReturnValue({ from: profileLookup.from } as never);
    vi.mocked(isPinLockActive).mockReturnValue(false);
    vi.mocked(verifyQuickSwitchPin).mockReturnValue(true);

    const request = new Request('http://localhost/api/account-switch/session/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetProfileId: 'target-user',
        pin: '2580',
        deviceId: 'device-1234567890abcdef',
      }),
    });

    const response = await switchSessionPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(clearAccountSwitchDeviceCredentialLock).toHaveBeenCalled();
    expect(touchAccountSwitchDeviceSession).toHaveBeenCalled();
  });
});
