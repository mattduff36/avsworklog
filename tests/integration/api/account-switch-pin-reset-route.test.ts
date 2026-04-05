import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/account-switch-auth', () => ({
  getAccountSwitchActorAccess: vi.fn(),
  verifyUserPassword: vi.fn(),
}));
vi.mock('@/lib/server/account-switch-device', () => ({
  parseAccountSwitchDeviceId: vi.fn(),
  upsertAccountSwitchDevice: vi.fn(),
  upsertAccountSwitchDeviceCredential: vi.fn(),
}));
vi.mock('@/lib/server/account-switch-settings', () => ({
  ensureAccountSwitchSettings: vi.fn(),
}));
vi.mock('@/lib/server/account-switch-pin', () => ({
  validateQuickSwitchPin: vi.fn(),
  hashQuickSwitchPin: vi.fn(() => 'hashed-pin'),
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

import { POST as resetPinPost } from '@/app/api/account-switch/pin/reset/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureAccountSwitchSettings } from '@/lib/server/account-switch-settings';
import { getAccountSwitchActorAccess, verifyUserPassword } from '@/lib/server/account-switch-auth';
import {
  parseAccountSwitchDeviceId,
  upsertAccountSwitchDevice,
  upsertAccountSwitchDeviceCredential,
} from '@/lib/server/account-switch-device';
import { validateQuickSwitchPin } from '@/lib/server/account-switch-pin';

function createUpdateChain() {
  const eq = vi.fn().mockResolvedValue({
    error: null,
  });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { from, update, eq };
}

describe('account switch pin reset route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccountSwitchActorAccess).mockResolvedValue({
      access: { userId: 'user-1', email: 'user-1@example.com' },
      errorResponse: null,
    });
    vi.mocked(verifyUserPassword).mockResolvedValue(true);
    vi.mocked(validateQuickSwitchPin).mockReturnValue({ isValid: true, errorMessage: null });
    vi.mocked(parseAccountSwitchDeviceId).mockReturnValue('device-1234567890abcdef');
    vi.mocked(ensureAccountSwitchSettings).mockResolvedValue({
      profile_id: 'user-1',
      quick_switch_enabled: false,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    } as never);
    vi.mocked(upsertAccountSwitchDevice).mockResolvedValue({
      id: 'device-row-1',
      profile_id: 'user-1',
      device_id_hash: 'hash',
      device_label: 'Browser',
      trusted_at: '2026-01-01T00:00:00.000Z',
      last_seen_at: '2026-01-01T00:00:00.000Z',
      revoked_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    } as never);
    vi.mocked(upsertAccountSwitchDeviceCredential).mockResolvedValue({
      profile_id: 'user-1',
      device_id: 'device-row-1',
      pin_hash: 'hashed-pin',
      pin_failed_attempts: 0,
      pin_locked_until: null,
      pin_last_changed_at: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    } as never);
  });

  it('persists only quick switch settings after saving the device credential', async () => {
    const chain = createUpdateChain();
    vi.mocked(createAdminClient).mockReturnValue({ from: chain.from } as never);

    const request = new Request('http://localhost/api/account-switch/pin/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'correct-password',
        newPin: '2580',
        deviceId: 'device-1234567890abcdef',
        deviceLabel: 'Browser',
      }),
    });

    const response = await resetPinPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(upsertAccountSwitchDeviceCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 'user-1',
        rawDeviceId: 'device-1234567890abcdef',
        pinHash: 'hashed-pin',
      })
    );
    expect(chain.from).toHaveBeenCalledWith('account_switch_settings');
    expect(chain.eq).toHaveBeenCalledWith('profile_id', 'user-1');
    expect(chain.update).toHaveBeenCalledWith({ quick_switch_enabled: true });
    expect(chain.update.mock.calls[0]?.[0]).not.toHaveProperty('pin_hash');
    expect(chain.update.mock.calls[0]?.[0]).not.toHaveProperty('pin_failed_attempts');
    expect(chain.update.mock.calls[0]?.[0]).not.toHaveProperty('pin_locked_until');
    expect(chain.update.mock.calls[0]?.[0]).not.toHaveProperty('pin_last_changed_at');
  });
});
