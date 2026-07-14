import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getCurrentAuthenticatedProfile,
  getInventoryKioskPostLoginPath,
  getActiveWebAuthnCredentialsForProfile,
  isBiometricPromptDismissed,
} = vi.hoisted(() => ({
  getCurrentAuthenticatedProfile: vi.fn(),
  getInventoryKioskPostLoginPath: vi.fn(),
  getActiveWebAuthnCredentialsForProfile: vi.fn(),
  isBiometricPromptDismissed: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile,
}));

vi.mock('@/lib/server/inventory-kiosk', () => ({
  getInventoryKioskPostLoginPath,
}));

vi.mock('@/lib/server/webauthn/credentials', () => ({
  getActiveWebAuthnCredentialsForProfile,
  isBiometricPromptDismissed,
}));

import { GET } from '@/app/api/auth/webauthn/status/route';

describe('WebAuthn status route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentAuthenticatedProfile.mockResolvedValue({
      profile: { id: 'profile-1' },
    });
  });

  it('suppresses biometric enrollment for the configured Yard kiosk profile', async () => {
    getInventoryKioskPostLoginPath.mockResolvedValue('/yard-kiosk');

    const response = await GET(new NextRequest(
      'http://localhost/api/auth/webauthn/status?deviceId=device-1',
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      prompt_dismissed: true,
      prompt_suppressed: true,
    });
    expect(getActiveWebAuthnCredentialsForProfile).not.toHaveBeenCalled();
    expect(isBiometricPromptDismissed).not.toHaveBeenCalled();
  });
});
