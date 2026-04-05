import { describe, expect, it } from 'vitest';
import {
  isAccountSwitcherEnabled,
  isAccountSwitcherEnabledServer,
} from '@/lib/account-switch/feature-flag';

describe('account switch feature flag', () => {
  it('is always enabled on the client helper', () => {
    expect(isAccountSwitcherEnabled()).toBe(true);
  });

  it('is always enabled on the server helper', () => {
    expect(isAccountSwitcherEnabledServer()).toBe(true);
  });
});
