'use client';

import { type Ref, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LockKeyhole, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { SensitiveAccessModuleName } from '@/types/roles';

const SENSITIVE_ACCESS_HEARTBEAT_MS = 5 * 60 * 1000;
const SENSITIVE_ACCESS_IDLE_WARNING_MS = 10 * 60 * 1000;
const ACTIVITY_EVENT_NAMES = ['pointerdown', 'keydown', 'input', 'wheel'] as const;

interface SensitivePinStatus {
  configured: boolean;
  pin_length: 4 | 6 | null;
  must_reset: boolean;
  locked_until: string | null;
}

interface SensitiveModuleState {
  module_name: SensitiveAccessModuleName;
  required: boolean;
  unlocked: boolean;
  expires_at: string | null;
  pin_status: SensitivePinStatus;
}

export interface SensitiveModuleAccessState {
  loading: boolean;
  state: SensitiveModuleState | null;
  canAccess: boolean;
  refresh: () => Promise<void>;
  unlock: (pin: string) => Promise<boolean>;
  renew: () => Promise<boolean>;
}

export function useSensitiveModuleAccess(
  moduleName: SensitiveAccessModuleName,
  options?: { enabled?: boolean }
): SensitiveModuleAccessState {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<SensitiveModuleState | null>(null);
  const enabled = options?.enabled ?? true;

  const refresh = useCallback(async () => {
    if (!enabled) {
      setState(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/sensitive-access/status?module=${encodeURIComponent(moduleName)}`, {
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to check sensitive access');
      }
      setState(payload.state);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to check sensitive access');
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, moduleName]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const unlock = useCallback(async (pin: string) => {
    try {
      const response = await fetch('/api/sensitive-access/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: moduleName, pin }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to unlock module');
      }
      setState(payload.state);
      toast.success('Sensitive module unlocked');
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to unlock module');
      await refresh();
      return false;
    }
  }, [moduleName, refresh]);

  const renew = useCallback(async () => {
    try {
      const response = await fetch('/api/sensitive-access/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: moduleName }),
      });
      const payload = await response.json().catch(() => null) as { state?: SensitiveModuleState } | null;
      if (!response.ok) {
        if (response.status === 428) {
          setState((current) => current ? { ...current, unlocked: false, expires_at: null } : current);
        }
        return false;
      }
      if (payload?.state) {
        setState(payload.state);
      }
      return true;
    } catch {
      return false;
    }
  }, [moduleName]);

  return {
    loading,
    state,
    canAccess: Boolean(state && (!state.required || state.unlocked)),
    refresh,
    unlock,
    renew,
  };
}

export function SensitiveModuleSessionManager({
  moduleLabel,
  access,
  initialLastActivityAt,
  initialWarningOpen = false,
}: {
  moduleLabel: string;
  access: SensitiveModuleAccessState;
  initialLastActivityAt?: number;
  initialWarningOpen?: boolean;
}) {
  const router = useRouter();
  const { canAccess, renew, state } = access;
  const lastActivityAtRef = useRef(initialLastActivityAt ?? Date.now());
  const warningOpenRef = useRef(initialWarningOpen);
  const heartbeatRunningRef = useRef(false);
  const [warningOpen, setWarningOpen] = useState(initialWarningOpen);
  const [confirming, setConfirming] = useState(false);
  const moduleName = state?.module_name;
  const canManageSession = canAccess && state?.required === true && Boolean(state.expires_at);

  const runHeartbeat = useCallback(async () => {
    if (!canManageSession) return;
    if (heartbeatRunningRef.current) return;

    heartbeatRunningRef.current = true;
    try {
      if (warningOpenRef.current) {
        router.push('/dashboard');
        return;
      }

      const idleFor = Date.now() - lastActivityAtRef.current;
      if (idleFor <= SENSITIVE_ACCESS_HEARTBEAT_MS) {
        const renewed = await renew();
        if (!renewed) {
          router.push('/dashboard');
        }
        return;
      }

      if (idleFor >= SENSITIVE_ACCESS_IDLE_WARNING_MS) {
        warningOpenRef.current = true;
        setWarningOpen(true);
      }
    } finally {
      heartbeatRunningRef.current = false;
    }
  }, [canManageSession, renew, router]);

  const confirmStillActive = useCallback(async () => {
    setConfirming(true);
    lastActivityAtRef.current = Date.now();
    warningOpenRef.current = false;
    setWarningOpen(false);

    try {
      const renewed = await renew();
      if (!renewed) {
        router.push('/dashboard');
      }
    } finally {
      setConfirming(false);
    }
  }, [renew, router]);

  useEffect(() => {
    if (!canManageSession) return;

    lastActivityAtRef.current = initialLastActivityAt ?? Date.now();
    warningOpenRef.current = initialWarningOpen;
    setWarningOpen(initialWarningOpen);

    const recordActivity = (event?: Event) => {
      if (event && event.isTrusted === false) return;
      if (!warningOpenRef.current) {
        lastActivityAtRef.current = Date.now();
      }
    };
    const recordVisibleActivity = (event?: Event) => {
      if (document.visibilityState === 'visible') {
        recordActivity(event);
      }
    };
    const listenerOptions = { capture: true, passive: true };

    ACTIVITY_EVENT_NAMES.forEach((eventName) => {
      document.addEventListener(eventName, recordActivity, listenerOptions);
    });
    document.addEventListener('visibilitychange', recordVisibleActivity, listenerOptions);

    let heartbeat: number | null = null;
    let cancelled = false;
    const scheduleHeartbeat = () => {
      heartbeat = window.setTimeout(() => {
        if (!cancelled) {
          scheduleHeartbeat();
        }
        void runHeartbeat();
      }, SENSITIVE_ACCESS_HEARTBEAT_MS);
    };

    scheduleHeartbeat();

    return () => {
      cancelled = true;
      if (heartbeat !== null) {
        window.clearTimeout(heartbeat);
      }
      ACTIVITY_EVENT_NAMES.forEach((eventName) => {
        document.removeEventListener(eventName, recordActivity, listenerOptions);
      });
      document.removeEventListener('visibilitychange', recordVisibleActivity, listenerOptions);
    };
  }, [canManageSession, initialLastActivityAt, initialWarningOpen, moduleName, runHeartbeat]);

  if (!canManageSession) return null;

  return (
    <AlertDialog open={warningOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you still using {moduleLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            Sensitive access is about to expire because there has been no recent activity on this page.
            Confirm you are still here to keep working without losing your current changes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void confirmStillActive();
            }}
            disabled={confirming}
            className="bg-avs-yellow text-slate-900 hover:bg-[#d1b82f] disabled:opacity-60"
          >
            {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Yes, I&apos;m still here
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PinDigitEntry({
  id,
  label,
  value,
  length,
  onChange,
  inputRef,
  describedBy,
  disabled = false,
  autoComplete = 'off',
  autoFocus = false,
}: {
  id: string;
  label: string;
  value: string;
  length: 4 | 6;
  onChange: (value: string) => void;
  inputRef: Ref<HTMLInputElement>;
  describedBy?: string;
  disabled?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  const slots = Array.from({ length }, (_, index) => index);

  return (
    <div className="space-y-3">
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <div className="relative mx-auto w-fit" onClick={() => {
        if (typeof inputRef === 'function') return;
        inputRef?.current?.focus({ preventScroll: true });
      }}>
        <Input
          ref={inputRef}
          id={id}
          type="password"
          inputMode="numeric"
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-label={label}
          aria-describedby={describedBy}
          className="absolute inset-0 z-10 h-full w-full cursor-text border-0 bg-transparent p-0 text-transparent caret-transparent opacity-0"
        />
        <div
          className={`grid gap-2 sm:gap-3 ${length === 4 ? 'grid-cols-4' : 'grid-cols-6'}`}
          aria-hidden="true"
        >
          {slots.map((slot) => {
            const filled = value.length > slot;
            const active = value.length === slot && !disabled;

            return (
              <div
                key={slot}
                className={`flex h-12 w-10 items-center justify-center rounded-xl border text-lg font-semibold shadow-inner transition-all sm:h-16 sm:w-14 sm:rounded-2xl sm:text-xl ${
                  filled
                    ? 'border-avs-yellow/70 bg-avs-yellow/15 text-white shadow-avs-yellow/10'
                    : active
                      ? 'border-avs-yellow bg-slate-900/90 ring-4 ring-avs-yellow/10'
                      : 'border-slate-600/70 bg-slate-900/70 text-slate-500'
                }`}
              >
                {filled ? '*' : ''}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SensitiveModuleGate({
  moduleLabel,
  access,
}: {
  moduleLabel: string;
  access: SensitiveModuleAccessState;
}) {
  const [pin, setPin] = useState('');
  const [setupPin, setSetupPin] = useState('');
  const [confirmSetupPin, setConfirmSetupPin] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPending, setSetupPending] = useState(false);
  const [setupPinLength, setSetupPinLength] = useState<4 | 6>(4);
  const [working, setWorking] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const setupPinInputRef = useRef<HTMLInputElement>(null);
  const confirmSetupPinInputRef = useRef<HTMLInputElement>(null);
  const verificationInputRef = useRef<HTMLInputElement>(null);
  const pinStatus = access.state?.pin_status;
  const setupRequired = !pinStatus?.configured || pinStatus.must_reset;
  const configuredPinLength = pinStatus?.pin_length === 4 || pinStatus?.pin_length === 6 ? pinStatus.pin_length : null;
  const pinEntryLength = configuredPinLength ?? 6;
  const pinCanUnlock = configuredPinLength ? pin.length === configuredPinLength : pin.length === 4 || pin.length === 6;

  const focusPinInput = useCallback((input: HTMLInputElement | null) => {
    if (!input) return;

    const focus = () => {
      input.focus({ preventScroll: true });
    };

    focus();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(focus);
    } else {
      window.setTimeout(focus, 0);
    }
    window.setTimeout(focus, 250);
  }, []);

  useEffect(() => {
    if (!setupRequired) {
      focusPinInput(pinInputRef.current);
      return;
    }

    if (setupPending) {
      focusPinInput(verificationInputRef.current);
    } else {
      focusPinInput(setupPinInputRef.current);
    }
  }, [focusPinInput, setupPending, setupRequired]);

  async function handleUnlock(candidatePin = pin) {
    const candidateCanUnlock = configuredPinLength
      ? candidatePin.length === configuredPinLength
      : candidatePin.length === 4 || candidatePin.length === 6;

    if (working || !candidateCanUnlock) return;

    setWorking(true);
    try {
      await access.unlock(candidatePin);
      setPin('');
    } finally {
      setWorking(false);
      window.setTimeout(() => focusPinInput(pinInputRef.current), 0);
    }
  }

  function handlePinChange(nextValue: string) {
    const nextPin = nextValue.replace(/\D/g, '').slice(0, pinEntryLength);
    setPin(nextPin);

    if (configuredPinLength && nextPin.length === configuredPinLength && !working) {
      void handleUnlock(nextPin);
    }
  }

  function handleSetupPinLengthChange(nextLength: 4 | 6) {
    setSetupPinLength(nextLength);
    setSetupPin((current) => current.slice(0, nextLength));
    setConfirmSetupPin('');
    window.setTimeout(() => focusPinInput(setupPinInputRef.current), 0);
  }

  function handleSetupPinChange(nextValue: string) {
    const nextPin = nextValue.replace(/\D/g, '').slice(0, setupPinLength);
    setSetupPin(nextPin);
    setConfirmSetupPin('');

    if (nextPin.length === setupPinLength) {
      window.setTimeout(() => focusPinInput(confirmSetupPinInputRef.current), 0);
    }
  }

  function handleConfirmSetupPinChange(nextValue: string) {
    const nextPin = nextValue.replace(/\D/g, '').slice(0, setupPinLength);
    setConfirmSetupPin(nextPin);

    if (nextPin.length === setupPinLength && setupPin.length === setupPinLength && !working) {
      void requestPinSetup(setupPin, nextPin);
    }
  }

  function handleVerificationCodeChange(nextValue: string) {
    const nextCode = nextValue.replace(/\D/g, '').slice(0, 6);
    setVerificationCode(nextCode);

    if (nextCode.length === 6 && !working) {
      void confirmPinSetup(nextCode);
    }
  }

  async function requestPinSetup(candidateSetupPin = setupPin, candidateConfirmSetupPin = confirmSetupPin) {
    if (working) return;

    if (candidateSetupPin.length !== setupPinLength || candidateConfirmSetupPin.length !== setupPinLength) {
      return;
    }

    if (candidateSetupPin !== candidateConfirmSetupPin) {
      toast.error('PINs do not match');
      setConfirmSetupPin('');
      window.setTimeout(() => focusPinInput(confirmSetupPinInputRef.current), 0);
      return;
    }
    if (!/^\d{4}$|^\d{6}$/.test(candidateSetupPin)) {
      toast.error('PIN must be either 4 or 6 digits');
      return;
    }

    setWorking(true);
    try {
      const response = await fetch('/api/me/sensitive-pin/setup/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: candidateSetupPin }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to set sensitive PIN');
      }

      if (payload.requiresVerification === false) {
        toast.success('Sensitive PIN set');
        const unlocked = await access.unlock(candidateSetupPin);
        if (unlocked) {
          setSetupPin('');
          setConfirmSetupPin('');
        } else {
          await access.refresh();
        }
        return;
      }

      setSetupPending(true);
      setSetupEmail(payload.email || '');
      setVerificationCode('');
      toast.success('Verification code sent');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to set sensitive PIN');
    } finally {
      setWorking(false);
    }
  }

  async function confirmPinSetup(candidateCode = verificationCode) {
    if (working || candidateCode.length !== 6) return;

    setWorking(true);
    try {
      const response = await fetch('/api/me/sensitive-pin/setup/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: candidateCode }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to confirm verification code');
      }

      toast.success('Sensitive PIN set');
      const unlocked = await access.unlock(setupPin);
      if (unlocked) {
        setSetupPin('');
        setConfirmSetupPin('');
        setVerificationCode('');
        setSetupEmail('');
        setSetupPending(false);
      } else {
        await access.refresh();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to confirm verification code');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh_-_var(--top-nav-h,68px)_-_1rem)] items-start justify-center px-4 pb-8 pt-4 sm:min-h-[calc(100vh-11rem)] sm:items-center sm:py-8">
      <Card className="relative flex w-full max-w-[580px] overflow-hidden rounded-3xl border border-slate-700/70 bg-slate-950/95 shadow-2xl shadow-black/40 sm:rounded-[2rem]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(241,214,74,0.16),_transparent_36%),linear-gradient(145deg,_rgba(15,23,42,0.2),_rgba(2,6,23,0.9))]" />
        <div className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-avs-yellow/80 to-transparent" />
        <div className="flex w-full flex-col justify-center">
          <CardHeader className="relative px-4 pb-3 pt-5 text-center sm:px-10 sm:pb-4 sm:pt-8">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl border border-avs-yellow/35 bg-avs-yellow/15 text-avs-yellow shadow-lg shadow-avs-yellow/10 sm:mb-4 sm:h-14 sm:w-14">
              {setupRequired ? <ShieldCheck className="h-5 w-5 sm:h-6 sm:w-6" /> : <LockKeyhole className="h-5 w-5 sm:h-6 sm:w-6" />}
            </div>
            <CardTitle className="text-2xl sm:text-3xl">
              {setupRequired ? 'Set Sensitive PIN' : 'Verify your identity'}
            </CardTitle>
            <CardDescription className="mx-auto max-w-md text-sm leading-5 text-slate-300 sm:text-base sm:leading-6">
              {setupRequired
                ? `Create a 4 or 6 digit PIN to unlock protected modules for 20 minutes on this session.`
                : `Enter your ${configuredPinLength ? `${configuredPinLength}-digit ` : ''}sensitive access PIN to unlock ${moduleLabel} for 20 minutes.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="relative space-y-3 px-4 pb-5 sm:space-y-4 sm:px-10 sm:pb-8">
            {setupRequired ? (
              <div className="mx-auto max-w-md space-y-4 text-center sm:space-y-5">
                {!setupPending ? (
                  <>
                    <div className="mx-auto flex w-fit rounded-full border border-slate-700/70 bg-slate-900/80 p-1 shadow-inner">
                      {[4, 6].map((length) => (
                        <button
                          key={length}
                          type="button"
                          aria-pressed={setupPinLength === length}
                          onClick={() => handleSetupPinLengthChange(length as 4 | 6)}
                          className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                            setupPinLength === length
                              ? 'bg-avs-yellow text-slate-950 shadow shadow-avs-yellow/15'
                              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          {length} digit
                        </button>
                      ))}
                    </div>

                    <div className="space-y-3 rounded-2xl border border-slate-800/80 bg-slate-950/45 p-3 sm:space-y-4 sm:p-4">
                      <p className="text-sm font-medium text-slate-200">Choose your new PIN</p>
                      <PinDigitEntry
                        id="sensitive-module-setup-pin"
                        label="New sensitive PIN"
                        value={setupPin}
                        length={setupPinLength}
                        onChange={handleSetupPinChange}
                        inputRef={setupPinInputRef}
                        disabled={working}
                        describedBy="sensitive-module-setup-help"
                        autoFocus={!setupPending}
                      />
                    </div>

                    <div className="space-y-3 rounded-2xl border border-slate-800/80 bg-slate-950/45 p-3 sm:space-y-4 sm:p-4">
                      <p className="text-sm font-medium text-slate-200">Confirm your PIN</p>
                      <PinDigitEntry
                        id="sensitive-module-confirm-pin"
                        label="Confirm sensitive PIN"
                        value={confirmSetupPin}
                        length={setupPinLength}
                        onChange={handleConfirmSetupPinChange}
                        inputRef={confirmSetupPinInputRef}
                        disabled={working || setupPin.length !== setupPinLength}
                        describedBy="sensitive-module-setup-help"
                      />
                    </div>

                    <div
                      id="sensitive-module-setup-help"
                      className="flex min-h-6 items-center justify-center text-sm text-slate-400"
                      aria-live="polite"
                    >
                      {working ? (
                        <span className="inline-flex items-center gap-2 text-avs-yellow">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Setting PIN...
                        </span>
                      ) : setupPin.length === setupPinLength ? (
                        'Re-enter the same PIN to finish setup.'
                      ) : (
                        'This PIN cannot match your normal account password.'
                      )}
                    </div>
                  </>
                ) : (
                  <div className="space-y-4 rounded-2xl border border-avs-yellow/35 bg-avs-yellow/10 p-4 sm:space-y-5 sm:p-5">
                    <p className="text-center text-sm text-slate-200">
                      Enter the 6-digit verification code sent to {setupEmail || 'your email address'}.
                    </p>
                    <PinDigitEntry
                      id="sensitive-module-verification-code"
                      label="Verification code"
                      value={verificationCode}
                      length={6}
                      onChange={handleVerificationCodeChange}
                      inputRef={verificationInputRef}
                      disabled={working}
                      autoComplete="one-time-code"
                      autoFocus
                      describedBy="sensitive-module-verification-help"
                    />
                    <div
                      id="sensitive-module-verification-help"
                      className="flex min-h-6 items-center justify-center text-sm text-slate-300"
                      aria-live="polite"
                    >
                      {working ? (
                        <span className="inline-flex items-center gap-2 text-avs-yellow">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Verifying code...
                        </span>
                      ) : (
                        'The code submits automatically after the final digit.'
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <form
                className="mx-auto grid max-w-md gap-5 text-center"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleUnlock();
                }}
              >
                <div className="space-y-4">
                  <PinDigitEntry
                    id="sensitive-module-pin"
                    label="Sensitive PIN"
                    value={pin}
                    length={pinEntryLength}
                    onChange={handlePinChange}
                    inputRef={pinInputRef}
                    disabled={working}
                    describedBy="sensitive-module-pin-help"
                    autoFocus
                  />
                </div>
                <div
                  id="sensitive-module-pin-help"
                  className="flex min-h-6 items-center justify-center text-sm text-slate-400"
                  aria-live="polite"
                >
                  {working ? (
                    <span className="inline-flex items-center gap-2 text-avs-yellow">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Verifying PIN...
                    </span>
                  ) : pinCanUnlock && !configuredPinLength ? (
                    'Press Enter to unlock.'
                  ) : (
                    'The PIN submits automatically after the final digit.'
                  )}
                </div>
              </form>
            )}
          </CardContent>
        </div>
      </Card>
    </div>
  );
}
