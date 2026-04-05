import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/account-switch-auth', () => ({
  getAccountSwitchActorAccess: vi.fn(),
  verifyUserPassword: vi.fn(),
}));
vi.mock('@/lib/server/account-switch-device', () => ({
  parseAccountSwitchDeviceId: vi.fn(),
  getAccountSwitchDeviceCredential: vi.fn(),
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

import { POST as setupPinPost } from '@/app/api/account-switch/pin/setup/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureAccountSwitchSettings } from '@/lib/server/account-switch-settings';
import { getAccountSwitchActorAccess, verifyUserPassword } from '@/lib/server/account-switch-auth';
import {
  getAccountSwitchDeviceCredential,
  parseAccountSwitchDeviceId,
  upsertAccountSwitchDevice,
  upsertAccountSwitchDeviceCredential,
} from '@/lib/server/account-switch-device';
import { validateQuickSwitchPin } from '@/lib/server/account-switch-pin';
import { createAccountSwitchAuditEvent } from '@/lib/server/account-switch-audit';

function createUpdateChain() {
  const single = vi.fn().mockResolvedValue({
    data: {
      quick_switch_enabled: true,
    },
    error: null,
  });
  const select = vi.fn(() => ({ single }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { from, update, eq, select, single };
}

describe('account switch pin setup route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccountSwitchActorAccess).mockResolvedValue({
      access: { userId: 'user-1', email: 'user-1@example.com' },
      errorResponse: null,
    });
    vi.mocked(validateQuickSwitchPin).mockReturnValue({ isValid: true, errorMessage: null });
    vi.mocked(parseAccountSwitchDeviceId).mockReturnValue('device-1234567890abcdef');
    vi.mocked(ensureAccountSwitchSettings).mockResolvedValue({
      profile_id: 'user-1',
      quick_switch_enabled: true,
      pin_hash: null,
      pin_failed_attempts: 0,
      pin_locked_until: null,
      pin_last_changed_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
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
      credential: null,
    });
    vi.mocked(upsertAccountSwitchDevice).mockResolvedValue({
      id: 'device-row-1',
      profile_id: 'user-1',
      device_id_hash: 'hash',
      device_label: null,
      trusted_at: '2026-01-01T00:00:00.000Z',
      last_seen_at: '2026-01-01T00:00:00.000Z',
      revoked_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(upsertAccountSwitchDeviceCredential).mockResolvedValue({
      profile_id: 'user-1',
      device_id: 'device-row-1',
      pin_hash: 'hashed-pin',
      pin_failed_attempts: 0,
      pin_locked_until: null,
      pin_last_changed_at: '2026-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('rejects setup when PIN is missing', async () => {
    const request = new Request('http://localhost/api/account-switch/pin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'any-value', deviceId: 'device-1234567890abcdef' }),
    });

    const response = await setupPinPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('PIN is required');
    expect(payload.code).toBe('PIN_REQUIRED');
    expect(verifyUserPassword).not.toHaveBeenCalled();
  });

  it('rejects setup when device id is missing', async () => {
    vi.mocked(parseAccountSwitchDeviceId).mockReturnValue(null);

    const request = new Request('http://localhost/api/account-switch/pin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: '2580',
      }),
    });

    const response = await setupPinPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('DEVICE_ID_REQUIRED');
    expect(payload.error).toContain('deviceId');
  });

  it('allows first-time setup without current password', async () => {
    const chain = createUpdateChain();
    vi.mocked(createAdminClient).mockReturnValue({ from: chain.from } as never);

    const request = new Request('http://localhost/api/account-switch/pin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: '2580',
        enableQuickSwitch: true,
        deviceId: 'device-1234567890abcdef',
      }),
    });

    const response = await setupPinPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(verifyUserPassword).not.toHaveBeenCalled();
    expect(upsertAccountSwitchDeviceCredential).toHaveBeenCalled();
    expect(chain.from).toHaveBeenCalledWith('account_switch_settings');
    expect(vi.mocked(createAccountSwitchAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 'user-1',
        actorProfileId: 'user-1',
        eventType: 'pin_setup',
      })
    );
  });

  it('still verifies password when provided during first-time setup', async () => {
    vi.mocked(verifyUserPassword).mockResolvedValue(false);

    const request = new Request('http://localhost/api/account-switch/pin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'incorrect-password',
        pin: '2580',
        deviceId: 'device-1234567890abcdef',
      }),
    });

    const response = await setupPinPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Current password is incorrect');
    expect(payload.code).toBe('PASSWORD_INVALID');
    expect(verifyUserPassword).toHaveBeenCalledWith('user-1@example.com', 'user-1', 'incorrect-password');
  });

  it('rejects missing current password when changing an existing PIN', async () => {
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
        pin_hash: 'existing-pin-hash',
        pin_failed_attempts: 0,
        pin_locked_until: null,
        pin_last_changed_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    });

    const request = new Request('http://localhost/api/account-switch/pin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: '2580',
        deviceId: 'device-1234567890abcdef',
      }),
    });

    const response = await setupPinPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Current password is required to change an existing PIN');
    expect(payload.code).toBe('PASSWORD_REQUIRED_FOR_PIN_CHANGE');
    expect(verifyUserPassword).not.toHaveBeenCalled();
  });

  it('rejects setup when current password is incorrect for existing PIN', async () => {
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
        pin_hash: 'existing-pin-hash',
        pin_failed_attempts: 0,
        pin_locked_until: null,
        pin_last_changed_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    });
    vi.mocked(verifyUserPassword).mockResolvedValue(false);

    const request = new Request('http://localhost/api/account-switch/pin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'wrong-password',
        pin: '2580',
        deviceId: 'device-1234567890abcdef',
      }),
    });

    const response = await setupPinPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Current password is incorrect');
    expect(payload.code).toBe('PASSWORD_INVALID');
    expect(ensureAccountSwitchSettings).toHaveBeenCalledWith('user-1');
  });

  it('saves pin after password verification for existing PIN', async () => {
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
        pin_hash: 'existing-pin-hash',
        pin_failed_attempts: 0,
        pin_locked_until: null,
        pin_last_changed_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    });
    const chain = createUpdateChain();
    vi.mocked(createAdminClient).mockReturnValue({ from: chain.from } as never);
    vi.mocked(verifyUserPassword).mockResolvedValue(true);

    const request = new Request('http://localhost/api/account-switch/pin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: 'correct-password',
        pin: '2580',
        enableQuickSwitch: true,
        deviceId: 'device-1234567890abcdef',
      }),
    });

    const response = await setupPinPost(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(verifyUserPassword).toHaveBeenCalledWith('user-1@example.com', 'user-1', 'correct-password');
    expect(upsertAccountSwitchDeviceCredential).toHaveBeenCalled();
    expect(chain.from).toHaveBeenCalledWith('account_switch_settings');
    expect(chain.eq).toHaveBeenCalledWith('profile_id', 'user-1');
  });
});
