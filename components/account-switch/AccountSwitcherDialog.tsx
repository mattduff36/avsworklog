'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Delete } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { isAccountSwitcherEnabled } from '@/lib/account-switch/feature-flag';
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
import type { SavedAccountShortcut } from '@/lib/account-switch/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

interface AccountSwitcherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentProfileId: string | null;
}

type AccountSwitcherFlowState = 'checking' | 'set-pin-enter' | 'set-pin-confirm' | 'lock-screen';
interface AccountSwitchSettingsResponse {
  settings?: {
    pin_configured?: boolean;
  };
}
const PIN_LENGTH = 4;
const PIN_KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const PIN_KEY_BUTTON_CLASS =
  'h-14 rounded-xl text-xl font-semibold bg-slate-950 text-white hover:bg-slate-900 md:h-16 md:text-2xl';

function getShortcutDisplayName(shortcut: SavedAccountShortcut): string {
  return shortcut.fullName || shortcut.email || 'Account';
}

export function AccountSwitcherDialog({
  open,
  onOpenChange,
  currentProfileId,
}: AccountSwitcherDialogProps) {
  const [deviceId] = useState(() => getOrCreateAccountSwitchDeviceId());
  const [shortcuts, setShortcuts] = useState<SavedAccountShortcut[]>([]);
  const [flowState, setFlowState] = useState<AccountSwitcherFlowState>('checking');
  const [enteredPin, setEnteredPin] = useState('');
  const [pendingRegisterPin, setPendingRegisterPin] = useState('');
  const [activeShortcutId, setActiveShortcutId] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [settingPin, setSettingPin] = useState(false);
  const [checking, setChecking] = useState(false);
  const [switching, setSwitching] = useState(false);
  const isFeatureEnabled = useMemo(() => isAccountSwitcherEnabled(), []);
  const selectedShortcut = useMemo(
    () => shortcuts.find((shortcut) => shortcut.profileId === activeShortcutId) || null,
    [shortcuts, activeShortcutId]
  );
  const hasCurrentShortcut = useMemo(
    () => shortcuts.some((shortcut) => shortcut.profileId === currentProfileId),
    [shortcuts, currentProfileId]
  );
  const switchableShortcuts = useMemo(
    () => shortcuts.filter((shortcut) => shortcut.profileId !== currentProfileId),
    [shortcuts, currentProfileId]
  );
  const isProcessing = registering || settingPin || checking || switching;
  const canSubmitPin = enteredPin.length === PIN_LENGTH && !isProcessing;

  function getInitialSwitchTarget(shortcutsList: SavedAccountShortcut[]): string | null {
    const firstNonCurrent = shortcutsList.find((shortcut) => shortcut.profileId !== currentProfileId);
    return firstNonCurrent?.profileId || null;
  }

  async function initializeFlow() {
    if (!deviceId) return;

    const storedShortcuts = listSavedAccountShortcuts();
    setShortcuts(storedShortcuts);
    setActiveShortcutId(getInitialSwitchTarget(storedShortcuts));
    setEnteredPin('');
    setPendingRegisterPin('');
    setFlowState('checking');
    setChecking(true);

    try {
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

      const response = await fetch(
        `/api/account-switch/settings?deviceId=${encodeURIComponent(deviceId)}`,
        { cache: 'no-store' }
      );
      const payload = (await response.json()) as AccountSwitchSettingsResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load account switch settings');
      }

      const hasPinConfigured = Boolean(payload.settings?.pin_configured);
      setFlowState(hasPinConfigured ? 'lock-screen' : 'set-pin-enter');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load account switch settings');
      setFlowState('set-pin-enter');
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!open || !isFeatureEnabled) return;
    void initializeFlow();
  }, [deviceId, open, isFeatureEnabled]);

  useEffect(() => {
    if (!open) return;
    if (flowState === 'checking') return;
    if (enteredPin.length !== PIN_LENGTH) return;
    if (isProcessing) return;
    void handlePinSubmit(enteredPin);
  }, [enteredPin, flowState, isProcessing, open]);

  if (!isFeatureEnabled) return null;

  async function verifyCurrentAccountPin(pin: string) {
    const verifyResponse = await fetch('/api/account-switch/pin/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pin,
        deviceId,
      }),
    });
    const verifyPayload = await verifyResponse.json();
    if (!verifyResponse.ok) {
      throw new Error(verifyPayload.error || 'Failed to verify PIN');
    }
  }

  async function handleRegisterCurrentAccount(
    pin: string,
    options?: { successMessage?: string | null }
  ) {
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
      if (!supabase) {
        throw new Error('Unable to initialize authentication client');
      }

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
      setActiveShortcutId(getInitialSwitchTarget(nextShortcuts));
      setEnteredPin('');
      setPendingRegisterPin('');
      if (options?.successMessage !== null) {
        toast.success(options?.successMessage || 'Account saved to this device');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save account');
      setEnteredPin('');
      setPendingRegisterPin('');
    } finally {
      setRegistering(false);
    }
  }

  async function handleSwitchAccount(shortcut: SavedAccountShortcut, pin: string) {
    if (switching) {
      return;
    }

    if (shortcut.profileId === currentProfileId) {
      toast.info('You are already using this account');
      return;
    }

    setSwitching(true);
    setActiveShortcutId(shortcut.profileId);

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
      const verifyPayload = await verifyResponse.json();
      if (!verifyResponse.ok) {
        throw new Error(verifyPayload.error || 'Failed to verify PIN');
      }

      const decryptedSession = await decryptSavedAccountSession(shortcut, pin);
      if (!decryptedSession) {
        throw new Error('Unable to decrypt saved session with this PIN');
      }

      const switchResult = await switchActiveSession(decryptedSession);
      if (!switchResult.success) {
        throw new Error(switchResult.errorMessage || 'Failed to switch account');
      }

      markSavedAccountShortcutUsed(shortcut.profileId);
      toast.success('Account switched');
      window.location.href = '/dashboard';
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to switch account');
      setEnteredPin('');
    } finally {
      setSwitching(false);
    }
  }

  async function handleSetupPin(pin: string) {
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
          setFlowState('lock-screen');
          setEnteredPin('');
          setPendingRegisterPin('');
          toast.info('PIN already configured for this account. Enter your PIN to continue.');
          return;
        }

        throw new Error(errorMessage);
      }

      await handleRegisterCurrentAccount(pin, { successMessage: null });
      setFlowState('lock-screen');
      setEnteredPin('');
      setPendingRegisterPin('');
      toast.success('PIN set and current account saved to this device');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to configure PIN');
      setFlowState('set-pin-enter');
      setEnteredPin('');
      setPendingRegisterPin('');
    } finally {
      setSettingPin(false);
    }
  }

  function goBackInSetPinFlow() {
    if (isProcessing) return;
    if (flowState !== 'set-pin-confirm') return;
    setEnteredPin('');
    setPendingRegisterPin('');
    setFlowState('set-pin-enter');
  }

  function handleDigitPress(digit: string) {
    if (isProcessing) return;
    setEnteredPin((previousPin) => {
      if (previousPin.length >= PIN_LENGTH) {
        return previousPin;
      }
      return `${previousPin}${digit}`;
    });
  }

  function handlePinBackspace() {
    if (isProcessing) return;
    setEnteredPin((previousPin) => previousPin.slice(0, -1));
  }

  function handlePinClear() {
    if (isProcessing) return;
    setEnteredPin('');
  }

  async function handlePinSubmit(pinOverride?: string) {
    const pin = pinOverride ?? enteredPin;
    if (isProcessing) return;
    if (pin.length !== PIN_LENGTH) {
      toast.error(`PIN must be exactly ${PIN_LENGTH} digits`);
      return;
    }

    if (flowState === 'set-pin-enter') {
      setPendingRegisterPin(pin);
      setEnteredPin('');
      setFlowState('set-pin-confirm');
      return;
    }

    if (flowState === 'set-pin-confirm') {
      if (pin !== pendingRegisterPin) {
        toast.error('PIN confirmation does not match. Try again.');
        setFlowState('set-pin-enter');
        setEnteredPin('');
        setPendingRegisterPin('');
        return;
      }
      await handleSetupPin(pin);
      return;
    }

    if (flowState === 'lock-screen') {
      if (selectedShortcut) {
        await handleSwitchAccount(selectedShortcut, pin);
        return;
      }

      if (!hasCurrentShortcut) {
        try {
          await verifyCurrentAccountPin(pin);
          await handleRegisterCurrentAccount(pin, {
            successMessage: 'Current account saved to this device',
          });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Failed to verify PIN');
          setEnteredPin('');
        }
        return;
      }

      toast.error('Select an account to switch');
    }
  }

  function selectShortcutForUnlock(shortcut: SavedAccountShortcut) {
    setActiveShortcutId(shortcut.profileId);
  }

  function handleRemoveShortcut(profileId: string) {
    const nextShortcuts = removeSavedAccountShortcut(profileId);
    setShortcuts(nextShortcuts);
    if (activeShortcutId === profileId) {
      setActiveShortcutId(getInitialSwitchTarget(nextShortcuts));
    }

    void fetch('/api/account-switch/session/shortcut-removed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetProfileId: profileId,
        deviceId,
      }),
    });

    toast.success('Saved account removed');
  }

  function getPinFlowHeading(): { title: string; description: string; submitLabel: string } {
    if (flowState === 'checking') {
      return {
        title: 'Loading account switcher',
        description: 'Checking your PIN configuration...',
        submitLabel: 'Continue',
      };
    }

    if (flowState === 'set-pin-enter') {
      return {
        title: 'Set your 4-digit PIN',
        description: 'Create a PIN for quick account switching on this device.',
        submitLabel: 'Continue',
      };
    }

    if (flowState === 'set-pin-confirm') {
      return {
        title: 'Confirm your PIN',
        description: 'Re-enter the same PIN to finish saving this account.',
        submitLabel: settingPin || registering ? 'Saving...' : 'Save PIN',
      };
    }

    if (!hasCurrentShortcut) {
      return {
        title: 'Unlock and save this account',
        description:
          'Enter your 4-digit PIN to store this current account on this device, then switch anytime.',
        submitLabel: registering ? 'Saving...' : 'Unlock',
      };
    }

    return {
      title: `Unlock ${selectedShortcut ? getShortcutDisplayName(selectedShortcut) : 'a saved account'}`,
      description: selectedShortcut
        ? 'Enter PIN to switch into this saved account.'
        : 'Select a saved account, then enter PIN to switch.',
      submitLabel: switching ? 'Switching...' : 'Switch account',
    };
  }

  const pinFlowHeading = getPinFlowHeading();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(100vw-1.5rem,34rem)] border-border bg-slate-900 text-white">
        <DialogHeader>
          <DialogTitle>Switch Account</DialogTitle>
          <DialogDescription className="text-slate-400">
            Quickly swap accounts on this device with your account PIN.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border/60 bg-slate-800/40 p-4 md:p-5 space-y-4 md:space-y-5">
            {flowState !== 'checking' ? (
              <div className="flex items-center justify-between">
                {flowState === 'set-pin-confirm' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={goBackInSetPinFlow}
                    disabled={isProcessing}
                    className="h-10 px-3 text-slate-300 hover:text-white"
                  >
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Back
                  </Button>
                ) : (
                  <span />
                )}
                <span className="text-sm text-slate-400">PIN keypad</span>
              </div>
            ) : null}

            <div className="text-center space-y-1.5">
              <p className="font-semibold text-base md:text-lg">{pinFlowHeading.title}</p>
              <p className="text-xs text-slate-400">{pinFlowHeading.description}</p>
            </div>

            {flowState === 'lock-screen' ? (
              <div className="space-y-2">
                <p className="text-xs text-slate-400">
                  {switchableShortcuts.length > 0
                    ? 'Saved accounts'
                    : 'No saved accounts available to switch yet.'}
                </p>
                {switchableShortcuts.length > 0 ? (
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {switchableShortcuts.map((shortcut) => {
                      const isSelected = activeShortcutId === shortcut.profileId;
                      return (
                        <div key={shortcut.profileId} className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => selectShortcutForUnlock(shortcut)}
                            disabled={isProcessing}
                            className={`flex-1 rounded-md border px-3 py-2 text-left ${
                              isSelected
                                ? 'border-avs-yellow bg-avs-yellow/15 text-white'
                                : 'border-border/60 bg-slate-900/60 text-slate-200'
                            }`}
                          >
                            <p className="font-medium">{getShortcutDisplayName(shortcut)}</p>
                            <p className="text-xs text-slate-400">{shortcut.email || 'No email available'}</p>
                          </button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleRemoveShortcut(shortcut.profileId)}
                            disabled={isProcessing}
                          >
                            Remove
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            {flowState !== 'checking' ? (
              <>
                <div className="flex justify-center gap-2.5 py-1.5">
                  {Array.from({ length: PIN_LENGTH }).map((_, index) => {
                    const isFilled = index < enteredPin.length;
                    return (
                      <span
                        key={`pin-slot-${index}`}
                        className={`h-3 w-3 rounded-full border ${
                          isFilled
                            ? 'border-avs-yellow bg-avs-yellow'
                            : 'border-slate-600 bg-transparent'
                        }`}
                      />
                    );
                  })}
                </div>

                <div className="grid grid-cols-3 gap-2.5 md:gap-3">
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
                    className="h-14 rounded-xl md:h-16"
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
                    className="h-14 rounded-xl md:h-16"
                  >
                    <Delete className="h-4 w-4" />
                  </Button>
                </div>

                <Button
                  type="button"
                  onClick={() => void handlePinSubmit()}
                  disabled={!canSubmitPin}
                  className="w-full h-12 text-base font-semibold bg-avs-yellow text-slate-900 hover:bg-avs-yellow-hover disabled:opacity-60"
                >
                  {pinFlowHeading.submitLabel}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
