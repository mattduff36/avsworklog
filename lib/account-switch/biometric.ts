'use client';

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export function browserMaySupportBiometricUnlock(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof window.PublicKeyCredential !== 'undefined';
}

export async function canUseBiometricUnlock(): Promise<boolean> {
  if (!browserMaySupportBiometricUnlock()) return false;

  const { browserSupportsWebAuthn, platformAuthenticatorIsAvailable } = await import(
    '@simplewebauthn/browser'
  );

  return browserSupportsWebAuthn() && platformAuthenticatorIsAvailable();
}

export async function startBiometricRegistration(
  optionsJSON: PublicKeyCredentialCreationOptionsJSON
): Promise<RegistrationResponseJSON> {
  const { startRegistration } = await import('@simplewebauthn/browser');
  return startRegistration({ optionsJSON });
}

export async function startBiometricAuthentication(
  optionsJSON: PublicKeyCredentialRequestOptionsJSON
): Promise<AuthenticationResponseJSON> {
  const { startAuthentication } = await import('@simplewebauthn/browser');
  return startAuthentication({ optionsJSON });
}
