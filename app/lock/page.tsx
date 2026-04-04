'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Delete, Lock, Plus } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { createClient } from '@/lib/supabase/client';
import {
  getAccountSwitchDeviceLabel,
  getOrCreateAccountSwitchDeviceId,
} from '@/lib/account-switch/device';
import {
  decryptSavedAccountSession,
  listSavedAccountShortcuts,
  mapSessionForStorage,
  markSavedAccountShortcutUsed,
  removeSavedAccountShortcut,
  saveAccountShortcut,
} from '@/lib/account-switch/storage';
import { switchActiveSession } from '@/lib/account-switch/session';
import { isAccountSwitcherEnabled } from '@/lib/account-switch/feature-flag';
import { setAccountLockedClientState } from '@/lib/account-switch/lock-state';
import type { SavedAccountShortcut } from '@/lib/account-switch/types';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

type LockPageMode = 'checking' | 'set-pin-enter' | 'set-pin-confirm' | 'locked';

interface AccountSwitchSettingsResponse {
  code?: string;
  settings?: {
    pin_configured?: boolean;
    device_registered?: boolean;
  };
  error?: string;
  details?: {
    pin_locked_until?: string | null;
  };
}

const PIN_LENGTH = 4;
const PIN_KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const PIN_KEY_BUTTON_CLASS =
  'h-14 rounded-xl text-xl font-semibold bg-slate-950 text-white hover:bg-slate-900 md:h-16 md:text-2xl';

function getShortcutDisplayName(shortcut: SavedAccountShortcut): string {
  return shortcut.fullName || shortcut.email || 'Account';
}

function getInitials(name: string | null | undefined): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function LockPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, signOut, loading: authLoading } = useAuth();
  const suppressErrorToastsRef = useRef(false);
  const [deviceId] = useState(() => getOrCreateAccountSwitchDeviceId());
  const [mode, setMode] = useState<LockPageMode>('checking');
  const [shortcuts, setShortcuts] = useState<SavedAccountShortcut[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [enteredPin, setEnteredPin] = useState('');
  const [pendingPin, setPendingPin] = useState('');
  const [checking, setChecking] = useState(true);
  const [settingPin, setSettingPin] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [pinLockedUntil, setPinLockedUntil] = useState<string | null>(null);
  const isFeatureEnabled = useMemo(() => isAccountSwitcherEnabled(), []);

  const currentProfileId = profile?.id || null;
  const currentShortcut = useMemo(
    () => shortcuts.find((shortcut) => shortcut.profileId === currentProfileId) || null,
    [shortcuts, currentProfileId]
  );
  const switchableShortcuts = useMemo(
    () => shortcuts.filter((shortcut) => shortcut.profileId !== currentProfileId),
    [shortcuts, currentProfileId]
  );
  const isProcessing = checking || settingPin || registering || unlocking;

  const returnTo = useMemo(() => {
    const candidate = searchParams?.get('returnTo') || '/dashboard';
    if (!candidate.startsWith('/') || candidate.startsWith('/lock')) {
      return '/dashboard';
    }
    return candidate;
  }, [searchParams]);

  function syncActiveProfileSelection(shortcutsList: SavedAccountShortcut[]): void {
    setActiveProfileId((previousProfileId) => {
      if (!previousProfileId) {
        return null;
      }

      if (currentProfileId && previousProfileId === currentProfileId) {
        return currentProfileId;
      }

      const isSavedProfileStillAvailable = shortcutsList.some(
        (shortcut) => shortcut.profileId === previousProfileId
      );
      return isSavedProfileStillAvailable ? previousProfileId : null;
    });
  }

  async function registerCurrentAccountShortcut(pin: string, showSuccessToast: boolean): Promise<void> {
    if (!currentProfileId) return;

    setRegistering(true);
    try {
      const response = await fetch('/api/account-switch/session/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pin,
          deviceId,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to register account');
      }

      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session || !payload.profile?.profileId) {
        throw new Error('No active session available to save');
      }

      const mappedSession = mapSessionForStorage(session, payload.profile.profileId);
      await saveAccountShortcut({
        profile: payload.profile,
        session: mappedSession,
        pin,
      });

      const nextShortcuts = listSavedAccountShortcuts();
      setShortcuts(nextShortcuts);
      syncActiveProfileSelection(nextShortcuts);
      if (showSuccessToast) {
        toast.success('Current account saved on this device');
      }
    } finally {
      setRegistering(false);
    }
  }

  useEffect(() => {
    if (authLoading) return;

    if (!currentProfileId) {
      setAccountLockedClientState(false);
      router.replace('/login');
      return;
    }

    if (!isFeatureEnabled) {
      router.replace('/dashboard');
      return;
    }

    setAccountLockedClientState(true);
    setChecking(true);
    setMode('checking');
    setEnteredPin('');
    setPendingPin('');
    setActiveProfileId(null);
    setPinLockedUntil(null);

    const storedShortcuts = listSavedAccountShortcuts();
    setShortcuts(storedShortcuts);

    void (async () => {
      try {
        if (deviceId) {
          await fetch('/api/account-switch/device/register', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              deviceId,
              deviceLabel: getAccountSwitchDeviceLabel(),
            }),
          });
        }

        const response = await fetch(
          `/api/account-switch/settings?deviceId=${encodeURIComponent(deviceId)}`,
          { cache: 'no-store' }
        );
        const payload = (await response.json()) as AccountSwitchSettingsResponse;
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load account switch settings');
        }
        const hasPin = Boolean(payload.settings?.pin_configured);
        setMode(hasPin ? 'locked' : 'set-pin-enter');
      } catch (error) {
        if (!suppressErrorToastsRef.current)
          toast.error(error instanceof Error ? error.message : 'Failed to load account switch settings');
        setMode('set-pin-enter');
      } finally {
        setChecking(false);
      }
    })();
  }, [authLoading, deviceId, isFeatureEnabled, router, currentProfileId]);

  useEffect(() => {
    if (mode === 'checking') return;
    if (!activeProfileId) return;
    if (enteredPin.length !== PIN_LENGTH) return;
    if (isProcessing) return;
    void handlePinSubmit(enteredPin);
  }, [activeProfileId, enteredPin, isProcessing, mode]);

  async function handleSetupPin(pin: string): Promise<void> {
    setSettingPin(true);
    try {
      const response = await fetch('/api/account-switch/pin/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pin,
          enableQuickSwitch: true,
          deviceId,
          deviceLabel: getAccountSwitchDeviceLabel(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        const errorMessage =
          typeof payload?.error === 'string' ? payload.error : 'Failed to configure PIN';

        if (
          response.status === 400 &&
          /existing PIN|password is required to change/i.test(errorMessage)
        ) {
          setMode('locked');
          setEnteredPin('');
          setPendingPin('');
          toast.info('PIN already configured for this account. Enter your PIN to continue.');
          return;
        }

        throw new Error(errorMessage);
      }

      await registerCurrentAccountShortcut(pin, false);
      setMode('locked');
      setEnteredPin('');
      setPendingPin('');
      toast.success('PIN set. Account locked.');
    } catch (error) {
      if (!suppressErrorToastsRef.current)
        toast.error(error instanceof Error ? error.message : 'Failed to configure PIN');
      setMode('set-pin-enter');
      setEnteredPin('');
      setPendingPin('');
    } finally {
      setSettingPin(false);
    }
  }

  async function unlockCurrentAccount(pin: string): Promise<void> {
    if (!currentProfileId) return;
    setUnlocking(true);
    try {
      const verifyResponse = await fetch('/api/account-switch/pin/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pin, deviceId }),
      });
      const verifyPayload = (await verifyResponse.json()) as AccountSwitchSettingsResponse;
      if (!verifyResponse.ok) {
        if (verifyPayload.code === 'PIN_LOCKED') {
          setPinLockedUntil(verifyPayload.details?.pin_locked_until || null);
        }
        throw new Error(verifyPayload.error || 'Incorrect PIN');
      }
      setPinLockedUntil(null);

      if (!currentShortcut) {
        await registerCurrentAccountShortcut(pin, false);
      }

      setAccountLockedClientState(false);
      window.location.href = returnTo;
    } catch (error) {
      if (!suppressErrorToastsRef.current)
        toast.error(error instanceof Error ? error.message : 'Failed to unlock account');
      setEnteredPin('');
    } finally {
      setUnlocking(false);
    }
  }

  async function switchToSavedAccount(shortcut: SavedAccountShortcut, pin: string): Promise<void> {
    setUnlocking(true);
    try {
      const verifyResponse = await fetch('/api/account-switch/session/switch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetProfileId: shortcut.profileId,
          pin,
          deviceId,
        }),
      });
      const verifyPayload = (await verifyResponse.json()) as AccountSwitchSettingsResponse;
      if (!verifyResponse.ok) {
        if (verifyPayload.code === 'PIN_LOCKED') {
          setPinLockedUntil(verifyPayload.details?.pin_locked_until || null);
        }
        throw new Error(verifyPayload.error || 'Failed to verify PIN');
      }
      setPinLockedUntil(null);

      const decryptedSession = await decryptSavedAccountSession(shortcut, pin);
      if (!decryptedSession) {
        throw new Error('Unable to decrypt saved session with this PIN');
      }

      const switchResult = await switchActiveSession(decryptedSession);
      if (!switchResult.success) {
        throw new Error(switchResult.errorMessage || 'Failed to switch account');
      }

      markSavedAccountShortcutUsed(shortcut.profileId);
      setAccountLockedClientState(false);
      window.location.href = '/dashboard';
    } catch (error) {
      if (!suppressErrorToastsRef.current)
        toast.error(error instanceof Error ? error.message : 'Failed to switch account');
      setEnteredPin('');
    } finally {
      setUnlocking(false);
    }
  }

  async function handlePinSubmit(pinOverride?: string): Promise<void> {
    const pin = pinOverride ?? enteredPin;
    if (pin.length !== PIN_LENGTH || isProcessing) return;

    if (mode === 'set-pin-enter') {
      setPendingPin(pin);
      setEnteredPin('');
      setMode('set-pin-confirm');
      return;
    }

    if (mode === 'set-pin-confirm') {
      if (pin !== pendingPin) {
        toast.error('PIN confirmation does not match. Try again.');
        setEnteredPin('');
        setPendingPin('');
        setMode('set-pin-enter');
        return;
      }
      await handleSetupPin(pin);
      return;
    }

    if (mode === 'locked') {
      if (!activeProfileId) {
        toast.error('Select an account to continue');
        return;
      }

      if (activeProfileId === currentProfileId) {
        await unlockCurrentAccount(pin);
        return;
      }
      const targetShortcut = shortcuts.find((shortcut) => shortcut.profileId === activeProfileId);
      if (!targetShortcut) {
        toast.error('Select an account to switch');
        return;
      }
      await switchToSavedAccount(targetShortcut, pin);
    }
  }

  function handleDigitPress(digit: string): void {
    if (isProcessing) return;

    setEnteredPin((previousPin) => {
      if (previousPin.length >= PIN_LENGTH) {
        return previousPin;
      }
      return `${previousPin}${digit}`;
    });
  }

  function handlePinBackspace(): void {
    if (isProcessing) return;
    setEnteredPin((previousPin) => previousPin.slice(0, -1));
  }

  function handlePinClear(): void {
    if (isProcessing) return;
    setEnteredPin('');
    setPinLockedUntil(null);
  }

  function handleSelectProfile(profileId: string): void {
    if (isProcessing) return;
    setActiveProfileId(profileId);
    setEnteredPin('');
    setPinLockedUntil(null);
  }

  async function handleSignInAsAnotherUser(): Promise<void> {
    suppressErrorToastsRef.current = true;
    toast.dismiss();
    setAccountLockedClientState(false);
    try {
      await signOut();
    } finally {
      window.location.replace('/login');
    }
  }

  function handleRemoveShortcut(profileId: string): void {
    const nextShortcuts = removeSavedAccountShortcut(profileId);
    setShortcuts(nextShortcuts);
    syncActiveProfileSelection(nextShortcuts);
    void fetch('/api/account-switch/session/shortcut-removed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetProfileId: profileId }),
    });
  }

  const lockedProfileName = profile?.full_name || profile?.email || 'Current user';
  const lockedProfileAvatar = profile?.avatar_url || null;
  const profileTiles = [
    ...(currentProfileId
      ? [
          {
            profileId: currentProfileId,
            displayName: lockedProfileName,
            avatarUrl: lockedProfileAvatar,
            email: profile?.email || null,
            isCurrentProfile: true,
          },
        ]
      : []),
    ...switchableShortcuts.map((shortcut) => ({
      profileId: shortcut.profileId,
      displayName: getShortcutDisplayName(shortcut),
      avatarUrl: shortcut.avatarUrl || null,
      email: shortcut.email || null,
      isCurrentProfile: false,
    })),
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-black to-slate-900 px-4 py-10 md:py-14">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:72px_72px]" />
      <div className="relative mx-auto w-full max-w-5xl">
        <div className="text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-avs-yellow text-slate-900 shadow-xl shadow-avs-yellow/25">
            <Lock className="h-8 w-8" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl">SQUIRESAPP</h1>
          <p className="mt-3 text-sm text-slate-300 md:text-base">
            {mode === 'set-pin-enter' || mode === 'set-pin-confirm'
              ? 'Set and confirm a 4-digit PIN for this profile.'
              : 'Select a profile and enter your PIN to continue.'}
          </p>
        </div>

        <div className="mx-auto mt-10 flex max-w-4xl flex-wrap items-start justify-center gap-8 md:gap-10">
          {profileTiles.map((tile) => {
            const isSelected = activeProfileId === tile.profileId;
            return (
              <div key={tile.profileId} className="group relative w-[130px] text-center transition md:w-[160px]">
                {!tile.isCurrentProfile ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRemoveShortcut(tile.profileId);
                    }}
                    disabled={isProcessing}
                    className="absolute right-1 top-1 z-10 rounded-full border border-slate-600/80 bg-black/70 px-2 py-0.5 text-[10px] font-medium text-slate-200 opacity-0 transition group-hover:opacity-100"
                  >
                    Remove
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleSelectProfile(tile.profileId)}
                  disabled={isProcessing}
                  className="w-full"
                >
                <div
                  className={`relative mx-auto flex h-[120px] w-[120px] items-center justify-center overflow-hidden rounded-md border transition md:h-[145px] md:w-[145px] ${
                    isSelected
                      ? 'border-avs-yellow bg-avs-yellow/15 shadow-lg shadow-avs-yellow/20'
                      : 'border-slate-700/70 bg-slate-900/75 group-hover:border-slate-500'
                  }`}
                >
                  {tile.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={tile.avatarUrl} alt={tile.displayName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-3xl font-semibold text-white">{getInitials(tile.displayName)}</span>
                  )}
                </div>
                <p className="mt-3 text-sm font-medium text-slate-100 md:text-base">{tile.displayName}</p>
                {tile.email ? (
                  <p className="mt-0.5 truncate text-xs text-slate-400">{tile.email}</p>
                ) : null}
                  {isSelected ? (
                    <p className="mt-1 text-xs text-avs-yellow">Selected</p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">Tap to select</p>
                  )}
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => void handleSignInAsAnotherUser()}
            disabled={isProcessing}
            className="group w-[130px] text-center transition md:w-[160px]"
          >
            <div className="mx-auto flex h-[120px] w-[120px] items-center justify-center rounded-md border border-slate-700/70 bg-slate-900/75 transition group-hover:border-slate-500 md:h-[145px] md:w-[145px]">
              <Plus className="h-10 w-10 text-slate-300 group-hover:text-white" />
            </div>
            <p className="mt-3 text-sm font-medium text-slate-200 md:text-base">Sign in as another user</p>
          </button>
        </div>

        {mode !== 'checking' && !activeProfileId ? (
          <div className="mt-8 text-center text-sm text-slate-400">
            <p>Select a profile to enter PIN.</p>
          </div>
        ) : null}

        {mode !== 'checking' && activeProfileId ? (
          <div className="mx-auto mt-12 w-full max-w-md rounded-2xl border border-slate-800/80 bg-black/35 p-5 backdrop-blur">
            <div className="mb-4 text-center">
              <p className="text-sm font-medium text-slate-200">
                {mode === 'set-pin-enter'
                  ? 'Create your 4-digit PIN'
                  : mode === 'set-pin-confirm'
                    ? 'Confirm your 4-digit PIN'
                    : 'Enter your 4-digit PIN'}
              </p>
            </div>
            <div className="flex justify-center gap-2.5 py-1">
              {Array.from({ length: PIN_LENGTH }).map((_, index) => (
                <span
                  key={`lock-pin-slot-${index}`}
                  className={`h-3 w-3 rounded-full border ${
                    index < enteredPin.length
                      ? 'border-avs-yellow bg-avs-yellow'
                      : 'border-slate-600 bg-transparent'
                  }`}
                />
              ))}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2.5 md:gap-3">
              {PIN_KEYPAD_KEYS.map((digit) => (
                <Button
                  key={digit}
                  type="button"
                  variant="secondary"
                  onClick={() => handleDigitPress(digit)}
                  disabled={isProcessing}
                  className={PIN_KEY_BUTTON_CLASS}
                >
                  {digit}
                </Button>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={handlePinClear}
                disabled={isProcessing || enteredPin.length === 0}
                className="h-14 rounded-xl border-slate-700 bg-slate-900/40 hover:bg-slate-800/70 md:h-16"
              >
                Clear
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleDigitPress('0')}
                disabled={isProcessing}
                className={PIN_KEY_BUTTON_CLASS}
              >
                0
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handlePinBackspace}
                disabled={isProcessing || enteredPin.length === 0}
                className="h-14 rounded-xl border-slate-700 bg-slate-900/40 hover:bg-slate-800/70 md:h-16"
              >
                <Delete className="h-4 w-4" />
              </Button>
            </div>

            {pinLockedUntil ? (
              <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
                <p>
                  PIN locked until{' '}
                  <span className="font-medium">
                    {new Date(pinLockedUntil).toLocaleString()}
                  </span>
                  .
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void handleSignInAsAnotherUser()}
                  className="mt-2 h-8 px-2 text-xs text-amber-100 hover:bg-amber-500/20 hover:text-white"
                >
                  Sign in with password instead
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === 'locked' && switchableShortcuts.length > 0 ? (
          <div className="mt-6 text-center text-xs text-slate-500">
            <p>Saved profiles shown here can be switched instantly with PIN.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
