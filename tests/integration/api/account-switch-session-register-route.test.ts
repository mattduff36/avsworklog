import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/account-switch-auth', () => ({
  getAccountSwitchActorAccess: vi.fn(),
}));
vi.mock('@/lib/server/account-switch-device', () => ({
  parseAccountSwitchDeviceId: vi.fn(),
  getAccountSwitchDeviceCredential: vi.fn(),
  touchAccountSwitchDeviceSession: vi.fn(),
}));
vi.mock('@/lib/server/account-switch-pin', () => ({
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
  buildAccountSwitchErrorResponse: vi.fn(
    (code: string, error: string, status: number, details?: Record<string, unknown>) =>
      Response.json({ code, error, ...(details ? { details } : {}) }, { status })
  ),
}));

import { POST as registerSessionPost } from '@/app/api/account-switch/session/register/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAccountSwitchActorAccess } from '@/lib/server/account-switch-auth';
import {
  getAccountSwitchDeviceCredential,
  parseAccountSwitchDeviceId,
  touchAccountSwitchDeviceSession,
} from '@/lib/server/account-switch-device';
import { verifyQuickSwitchPin } from '@/lib/server/account-switch-pin';

function createProfileLookupChain() {
  const single = vi.fn().mockResolvedValue({
    data: {
      id: 'user-1',
      full_name: 'User One',
      avatar_url: null,
      role: { name: 'employee' },
    },
    error: null,
  });
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq, single };
}

describe('account switch session register route', () => {
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
        pin_hash: 'stored-hash',
        pin_failed_attempts: 0,
        pin_locked_until: null,
        pin_last_changed_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('rejects missing pin in register payload', async () => {
    const request = new Request('http://localhost/api/account-switch/session/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'device-1234567890abcdef' }),
    });

    const response = await registerSessionPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('PIN is required');
    expect(payload.code).toBe('PIN_REQUIRED');
  });

  it('rejects when device id is invalid', async () => {
    vi.mocked(parseAccountSwitchDeviceId).mockReturnValue(null);

    const request = new Request('http://localhost/api/account-switch/session/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '2580' }),
    });

    const response = await registerSessionPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('DEVICE_ID_REQUIRED');
  });

  it('rejects registration when pin does not match server pin hash', async () => {
    vi.mocked(verifyQuickSwitchPin).mockReturnValue(false);

    const request = new Request('http://localhost/api/account-switch/session/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '2580', deviceId: 'device-1234567890abcdef' }),
    });

    const response = await registerSessionPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toContain('does not match');
    expect(payload.code).toBe('PIN_INCORRECT');
  });

  it('registers account when pin matches configured hash', async () => {
    const profileLookup = createProfileLookupChain();
    vi.mocked(createAdminClient).mockReturnValue({ from: profileLookup.from } as never);
    vi.mocked(verifyQuickSwitchPin).mockReturnValue(true);

    const request = new Request('http://localhost/api/account-switch/session/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '2580', deviceId: 'device-1234567890abcdef' }),
    });

    const response = await registerSessionPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.profile.profileId).toBe('user-1');
    expect(touchAccountSwitchDeviceSession).toHaveBeenCalled();
    expect(profileLookup.from).toHaveBeenCalledWith('profiles');
  });
});
