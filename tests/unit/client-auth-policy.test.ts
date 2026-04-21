import { afterEach, describe, expect, it, vi } from 'vitest';

describe('client auth policy helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defers unauthenticated handling for silent background refresh reasons', async () => {
    const { shouldDeferUnauthenticatedHandling } = await import('@/lib/app-auth/client-auth-policy');

    expect(shouldDeferUnauthenticatedHandling('focus', { silent: true })).toBe(true);
    expect(shouldDeferUnauthenticatedHandling('recover', { silent: true })).toBe(true);
    expect(shouldDeferUnauthenticatedHandling('broadcast', { silent: true })).toBe(false);
    expect(shouldDeferUnauthenticatedHandling('focus', { silent: false })).toBe(false);
  });

  it('only treats locked auth responses as lock redirects when the feature is enabled', async () => {
    const {
      getAuthFailureRedirectPath,
      shouldTreatAuthResponseAsLocked,
    } = await import('@/lib/app-auth/client-auth-policy');

    expect(shouldTreatAuthResponseAsLocked({ statusCode: 423 })).toBe(false);
    expect(getAuthFailureRedirectPath(423)).toBe('/login');

    vi.stubEnv('NEXT_PUBLIC_ACCOUNT_SWITCHER_ENABLED', 'true');
    vi.resetModules();

    const enabledPolicy = await import('@/lib/app-auth/client-auth-policy');
    expect(enabledPolicy.shouldTreatAuthResponseAsLocked({ statusCode: 423 })).toBe(true);
    expect(enabledPolicy.shouldTreatAuthResponseAsLocked({ payloadLocked: true })).toBe(true);
    expect(enabledPolicy.getAuthFailureRedirectPath(423)).toBe('/lock');
  });
});
