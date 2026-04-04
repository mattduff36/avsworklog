import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  decryptSavedAccountSession,
  getAccountShortcutStorageKey,
  listSavedAccountShortcuts,
  removeSavedAccountShortcut,
  saveAccountShortcut,
} from '@/lib/account-switch/storage';
import type { AccountSwitchStoredSession } from '@/lib/account-switch/types';

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index: number) => Array.from(store.keys())[index] || null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

describe('account switch storage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    const localStorageMock = createLocalStorageMock();
    vi.stubGlobal('window', { localStorage: localStorageMock } as unknown as Window & typeof globalThis);
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('crypto', webcrypto);
    if (typeof globalThis.btoa !== 'function') {
      vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'));
    }
    if (typeof globalThis.atob !== 'function') {
      vi.stubGlobal('atob', (value: string) => Buffer.from(value, 'base64').toString('binary'));
    }
  });

  it('encrypts and decrypts saved sessions', async () => {
    const session: AccountSwitchStoredSession = {
      profileId: 'profile-1',
      accessToken: 'access-token-value',
      refreshToken: 'refresh-token-value',
      expiresAt: 12345,
    };

    const savedShortcut = await saveAccountShortcut({
      profile: {
        profileId: 'profile-1',
        email: 'user@example.com',
        fullName: 'User Example',
        avatarUrl: null,
        roleName: 'employee',
      },
      session,
      pin: '2580',
    });

    expect(savedShortcut.encryptedSession).not.toContain('access-token-value');
    const decrypted = await decryptSavedAccountSession(savedShortcut, '2580');
    expect(decrypted).toEqual(session);

    const badDecrypt = await decryptSavedAccountSession(savedShortcut, '2581');
    expect(badDecrypt).toBeNull();
  });

  it('lists and removes shortcuts', async () => {
    await saveAccountShortcut({
      profile: {
        profileId: 'profile-2',
        email: 'two@example.com',
        fullName: 'User Two',
        avatarUrl: null,
        roleName: null,
      },
      session: {
        profileId: 'profile-2',
        accessToken: 'token-2',
        refreshToken: 'refresh-2',
        expiresAt: null,
      },
      pin: '2580',
    });

    expect(listSavedAccountShortcuts()).toHaveLength(1);
    removeSavedAccountShortcut('profile-2');
    expect(listSavedAccountShortcuts()).toHaveLength(0);
    expect(getAccountShortcutStorageKey()).toBe('account_switch_shortcuts_v1');
  });
});
