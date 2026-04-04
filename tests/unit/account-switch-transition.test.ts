import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAccountSwitchTransition,
  isAccountSwitchTransitionActive,
  markAccountSwitchTransition,
} from '@/lib/account-switch/transition';

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

describe('account switch transition state', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    const localStorageMock = createLocalStorageMock();
    vi.stubGlobal('window', { localStorage: localStorageMock } as unknown as Window & typeof globalThis);
    vi.stubGlobal('localStorage', localStorageMock);
  });

  it('tracks active transition window', () => {
    clearAccountSwitchTransition();
    expect(isAccountSwitchTransitionActive()).toBe(false);

    markAccountSwitchTransition(1000);
    expect(isAccountSwitchTransitionActive()).toBe(true);

    clearAccountSwitchTransition();
    expect(isAccountSwitchTransitionActive()).toBe(false);
  });
});
