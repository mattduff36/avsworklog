/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
  invalidateCachedDataToken: vi.fn(),
}));

vi.mock('@/lib/utils/fetch-with-auth', () => ({
  installGlobalAuthAwareFetch: vi.fn(),
}));

import { buildAuthenticatedRedirectUrl } from '@/lib/providers/auth-provider';

function sessionPayload(mustChangePassword: boolean) {
  return {
    authenticated: true,
    user: { id: 'user-1', email: 'user@example.com' },
    profile: { must_change_password: mustChangePassword },
  };
}

describe('authenticated password redirects', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/change-password');
  });

  it('leaves a voluntary user on the change-password page', () => {
    expect(buildAuthenticatedRedirectUrl(sessionPayload(false))).toBeNull();
  });

  it('leaves a mandatory password change on the change-password page', () => {
    expect(buildAuthenticatedRedirectUrl(sessionPayload(true))).toBeNull();
  });

  it('sends a temporary-password login to the change-password page', () => {
    window.history.pushState({}, '', '/login');

    expect(buildAuthenticatedRedirectUrl(sessionPayload(true))).toBe('/change-password');
  });
});
