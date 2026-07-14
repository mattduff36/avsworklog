import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getCurrentAuthenticatedProfile,
  getActiveWebAuthnCredentialsForProfile,
  isBiometricPromptDismissed,
} = vi.hoisted(() => ({
  getCurrentAuthenticatedProfile: vi.fn(),
  getActiveWebAuthnCredentialsForProfile: vi.fn(),
  isBiometricPromptDismissed: vi.fn(),
}));

vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile,
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
      profile: { id: 'kiosk-profile' },
    });
    getActiveWebAuthnCredentialsForProfile.mockResolvedValue([]);
    isBiometricPromptDismissed.mockResolvedValue(false);
  });

  it('returns device enrollment status for the dedicated Yard kiosk profile', async () => {
    const response = await GET(new NextRequest(
      'http://localhost/api/auth/webauthn/status?deviceId=device-1',
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      credentials_configured: false,
      credential_count: 0,
      prompt_dismissed: false,
    });
    expect(payload).not.toHaveProperty('prompt_suppressed');
    expect(getActiveWebAuthnCredentialsForProfile).toHaveBeenCalledWith({
      profileId: 'kiosk-profile',
      rawDeviceId: 'device-1',
    });
    expect(isBiometricPromptDismissed).toHaveBeenCalledWith({
      profileId: 'kiosk-profile',
      rawDeviceId: 'device-1',
    });
  });
});
