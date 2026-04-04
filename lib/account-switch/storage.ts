'use client';

import type { Session } from '@supabase/supabase-js';
import type {
  AccountSwitchProfileSummary,
  AccountSwitchStoredSession,
  SavedAccountShortcut,
} from '@/lib/account-switch/types';

const ACCOUNT_SWITCH_SHORTCUTS_STORAGE_KEY = 'account_switch_shortcuts_v1';
const AES_GCM_IV_BYTES = 12;
const PBKDF2_ITERATIONS = 150_000;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function toBase64(input: Uint8Array): string {
  let binary = '';
  input.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(input: string): Uint8Array {
  const binary = atob(input);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

function toArrayBuffer(input: Uint8Array): ArrayBuffer {
  return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
}

function readStoredShortcuts(): SavedAccountShortcut[] {
  if (!isBrowser()) return [];
  const rawValue = localStorage.getItem(ACCOUNT_SWITCH_SHORTCUTS_STORAGE_KEY);
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue) as SavedAccountShortcut[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => Boolean(item?.profileId));
  } catch {
    return [];
  }
}

function writeStoredShortcuts(shortcuts: SavedAccountShortcut[]): void {
  if (!isBrowser()) return;
  localStorage.setItem(ACCOUNT_SWITCH_SHORTCUTS_STORAGE_KEY, JSON.stringify(shortcuts));
}

async function derivePinKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

export function listSavedAccountShortcuts(): SavedAccountShortcut[] {
  return readStoredShortcuts().sort((left, right) => {
    const leftValue = left.lastUsedAt || left.updatedAt;
    const rightValue = right.lastUsedAt || right.updatedAt;
    return rightValue.localeCompare(leftValue);
  });
}

export function removeSavedAccountShortcut(profileId: string): SavedAccountShortcut[] {
  const nextShortcuts = readStoredShortcuts().filter((item) => item.profileId !== profileId);
  writeStoredShortcuts(nextShortcuts);
  return nextShortcuts;
}

export function markSavedAccountShortcutUsed(profileId: string): SavedAccountShortcut[] {
  const nowIso = new Date().toISOString();
  const nextShortcuts = readStoredShortcuts().map((item) => {
    if (item.profileId !== profileId) return item;
    return {
      ...item,
      updatedAt: nowIso,
      lastUsedAt: nowIso,
    };
  });
  writeStoredShortcuts(nextShortcuts);
  return nextShortcuts;
}

export function mapSessionForStorage(session: Session, profileId: string): AccountSwitchStoredSession {
  return {
    profileId,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? null,
  };
}

export async function saveAccountShortcut({
  profile,
  session,
  pin,
}: {
  profile: AccountSwitchProfileSummary;
  session: AccountSwitchStoredSession;
  pin: string;
}): Promise<SavedAccountShortcut> {
  if (!isBrowser()) {
    throw new Error('Account shortcuts are only available in the browser');
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const key = await derivePinKey(pin, salt);
  const payload = new TextEncoder().encode(JSON.stringify(session));
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    payload
  );

  const nowIso = new Date().toISOString();
  const nextShortcut: SavedAccountShortcut = {
    profileId: profile.profileId,
    email: profile.email,
    fullName: profile.fullName,
    avatarUrl: profile.avatarUrl,
    roleName: profile.roleName,
    encryptedSession: toBase64(new Uint8Array(encryptedBuffer)),
    encryptionSalt: toBase64(salt),
    encryptionIv: toBase64(iv),
    createdAt: nowIso,
    updatedAt: nowIso,
    lastUsedAt: null,
  };

  const currentShortcuts = readStoredShortcuts().filter(
    (storedShortcut) => storedShortcut.profileId !== profile.profileId
  );
  const nextShortcuts = [nextShortcut, ...currentShortcuts];
  writeStoredShortcuts(nextShortcuts);

  return nextShortcut;
}

export async function decryptSavedAccountSession(
  shortcut: SavedAccountShortcut,
  pin: string
): Promise<AccountSwitchStoredSession | null> {
  try {
    const salt = fromBase64(shortcut.encryptionSalt);
    const iv = fromBase64(shortcut.encryptionIv);
    const encryptedPayload = fromBase64(shortcut.encryptedSession);
    const key = await derivePinKey(pin, salt);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(iv),
      },
      key,
      toArrayBuffer(encryptedPayload)
    );

    const sessionPayload = JSON.parse(new TextDecoder().decode(new Uint8Array(decrypted)));
    if (
      !sessionPayload ||
      typeof sessionPayload.accessToken !== 'string' ||
      typeof sessionPayload.refreshToken !== 'string'
    ) {
      return null;
    }

    return sessionPayload as AccountSwitchStoredSession;
  } catch {
    return null;
  }
}

export function getAccountShortcutStorageKey(): string {
  return ACCOUNT_SWITCH_SHORTCUTS_STORAGE_KEY;
}
