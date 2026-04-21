import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isAccountSwitcherEnabled,
  isAccountSwitcherEnabledServer,
} from '@/lib/account-switch/feature-flag';

describe('account switch feature flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to disabled on the client helper', () => {
    expect(isAccountSwitcherEnabled()).toBe(false);
  });

  it('enables the client helper when the public env flag is true', () => {
    vi.stubEnv('NEXT_PUBLIC_ACCOUNT_SWITCHER_ENABLED', 'true');

    expect(isAccountSwitcherEnabled()).toBe(true);
  });

  it('defaults to disabled on the server helper', () => {
    expect(isAccountSwitcherEnabledServer()).toBe(false);
  });

  it('prefers the server env flag when present', () => {
    vi.stubEnv('NEXT_PUBLIC_ACCOUNT_SWITCHER_ENABLED', 'false');
    vi.stubEnv('ACCOUNT_SWITCHER_ENABLED', 'true');

    expect(isAccountSwitcherEnabledServer()).toBe(true);
  });
});
