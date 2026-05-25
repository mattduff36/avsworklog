import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  browserSupportsWebAuthnMock,
  platformAuthenticatorIsAvailableMock,
  startRegistrationMock,
  startAuthenticationMock,
} = vi.hoisted(() => ({
  browserSupportsWebAuthnMock: vi.fn(),
  platformAuthenticatorIsAvailableMock: vi.fn(),
  startRegistrationMock: vi.fn(),
  startAuthenticationMock: vi.fn(),
}));

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: browserSupportsWebAuthnMock,
  platformAuthenticatorIsAvailable: platformAuthenticatorIsAvailableMock,
  startRegistration: startRegistrationMock,
  startAuthentication: startAuthenticationMock,
}));

describe('biometric browser helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', {});
    browserSupportsWebAuthnMock.mockReturnValue(true);
    platformAuthenticatorIsAvailableMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('hides biometric UI when the WebAuthn browser API is unavailable', async () => {
    const { canUseBiometricUnlock } = await import('@/lib/account-switch/biometric');

    await expect(canUseBiometricUnlock()).resolves.toBe(false);
    expect(browserSupportsWebAuthnMock).not.toHaveBeenCalled();
  });

  it('requires a platform authenticator before offering biometric login', async () => {
    vi.stubGlobal('window', { PublicKeyCredential: function PublicKeyCredential() {} });
    platformAuthenticatorIsAvailableMock.mockResolvedValue(false);

    const { canUseBiometricUnlock } = await import('@/lib/account-switch/biometric');

    await expect(canUseBiometricUnlock()).resolves.toBe(false);
    expect(browserSupportsWebAuthnMock).toHaveBeenCalled();
    expect(platformAuthenticatorIsAvailableMock).toHaveBeenCalled();
  });

  it('delegates registration and authentication ceremonies to SimpleWebAuthn', async () => {
    vi.stubGlobal('window', { PublicKeyCredential: function PublicKeyCredential() {} });
    startRegistrationMock.mockResolvedValue({ id: 'registration-response' });
    startAuthenticationMock.mockResolvedValue({ id: 'authentication-response' });

    const {
      startBiometricAuthentication,
      startBiometricRegistration,
    } = await import('@/lib/account-switch/biometric');

    const registrationOptions = { challenge: 'registration-challenge' };
    const authenticationOptions = { challenge: 'authentication-challenge' };

    await expect(
      startBiometricRegistration(registrationOptions as never)
    ).resolves.toEqual({ id: 'registration-response' });
    await expect(
      startBiometricAuthentication(authenticationOptions as never)
    ).resolves.toEqual({ id: 'authentication-response' });

    expect(startRegistrationMock).toHaveBeenCalledWith({ optionsJSON: registrationOptions });
    expect(startAuthenticationMock).toHaveBeenCalledWith({ optionsJSON: authenticationOptions });
  });
});
