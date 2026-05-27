import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAuthenticatedProfile: vi.fn(),
  verifyUserPassword: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: mocks.getCurrentAuthenticatedProfile,
}));

vi.mock('@/lib/server/password-auth', () => ({
  verifyUserPassword: mocks.verifyUserPassword,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('@/lib/server/sensitive-pin-notifications', () => ({
  notifyAdminsOfSensitivePinEvent: vi.fn(),
}));

import { requestSensitivePinVerification, validateSensitivePin } from '@/lib/server/sensitive-pin';

describe('sensitive PIN helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAuthenticatedProfile.mockResolvedValue({
      profile: {
        id: 'user-1',
        email: 'user@example.com',
        full_name: 'User One',
      },
      validation: { session: { id: 'session-1' } },
    });
  });

  it('accepts only 4 or 6 digit PINs', () => {
    expect(validateSensitivePin('1234')).toEqual({ valid: true, length: 4 });
    expect(validateSensitivePin('123456')).toEqual({ valid: true, length: 6 });
    expect(validateSensitivePin('12345').valid).toBe(false);
    expect(validateSensitivePin('12a4').valid).toBe(false);
  });

  it('rejects a sensitive PIN that matches the main password before writing tokens', async () => {
    mocks.verifyUserPassword.mockResolvedValue(true);

    await expect(
      requestSensitivePinVerification({ pin: '1234', purpose: 'setup' })
    ).rejects.toThrow('Sensitive PIN cannot be the same as your main password');

    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
