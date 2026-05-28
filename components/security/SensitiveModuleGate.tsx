'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, LockKeyhole, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import type { ModuleName } from '@/types/roles';

const SENSITIVE_ACCESS_HEARTBEAT_MS = 5 * 60 * 1000;
const SENSITIVE_ACCESS_IDLE_WARNING_MS = 10 * 60 * 1000;
const ACTIVITY_EVENT_NAMES = ['pointerdown', 'keydown', 'input', 'wheel'] as const;

interface SensitivePinStatus {
  configured: boolean;
  must_reset: boolean;
  locked_until: string | null;
}

interface SensitiveModuleState {
  module_name: ModuleName;
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

export function useSensitiveModuleAccess(moduleName: ModuleName): SensitiveModuleAccessState {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<SensitiveModuleState | null>(null);

  const refresh = useCallback(async () => {
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
  }, [moduleName]);

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
  const [working, setWorking] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const pinStatus = access.state?.pin_status;
  const setupRequired = !pinStatus?.configured || pinStatus.must_reset;
  const pinCanUnlock = pin.length === 4 || pin.length === 6;

  useEffect(() => {
    if (!setupRequired) {
      pinInputRef.current?.focus();
    }
  }, [setupRequired]);

  async function handleUnlock() {
    if (working || !pinCanUnlock) return;

    setWorking(true);
    try {
      const unlocked = await access.unlock(pin);
      if (unlocked) {
        setPin('');
      }
    } finally {
      setWorking(false);
    }
  }

  async function requestPinSetup() {
    if (setupPin !== confirmSetupPin) {
      toast.error('PINs do not match');
      return;
    }
    if (!/^\d{4}$|^\d{6}$/.test(setupPin)) {
      toast.error('PIN must be either 4 or 6 digits');
      return;
    }

    setWorking(true);
    try {
      const response = await fetch('/api/me/sensitive-pin/setup/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: setupPin }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to set sensitive PIN');
      }

      if (payload.requiresVerification === false) {
        toast.success('Sensitive PIN set');
        const unlocked = await access.unlock(setupPin);
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

  async function confirmPinSetup() {
    setWorking(true);
    try {
      const response = await fetch('/api/me/sensitive-pin/setup/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verificationCode }),
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
    <div className="flex min-h-[calc(100vh-11rem)] items-center justify-center px-4 py-8">
      <Card className="relative flex w-full max-w-[640px] overflow-hidden border-border bg-slate-950/75 shadow-2xl shadow-black/30 md:aspect-[3/2]">
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-avs-yellow/70 to-transparent" />
        <div className="flex w-full flex-col justify-center">
          <CardHeader className="pb-4 text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl border border-avs-yellow/30 bg-avs-yellow/15 text-avs-yellow shadow-lg shadow-avs-yellow/10">
              {setupRequired ? <ShieldCheck className="h-6 w-6" /> : <LockKeyhole className="h-6 w-6" />}
            </div>
            <CardTitle className="text-2xl">
              {setupRequired ? 'Set Sensitive PIN' : `${moduleLabel} Requires Sensitive PIN`}
            </CardTitle>
            <CardDescription className="mx-auto max-w-md">
              {setupRequired
                ? `Create a 4 or 6 digit PIN to unlock protected modules for 20 minutes on this session.`
                : `Enter your sensitive access PIN to unlock all protected modules for 20 minutes on this session.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6">
            {setupRequired ? (
              <div className="space-y-4">
                {!setupPending ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="sensitive-module-setup-pin">New PIN</Label>
                        <Input
                          id="sensitive-module-setup-pin"
                          type="password"
                          inputMode="numeric"
                          autoComplete="off"
                          value={setupPin}
                          onChange={(event) => setSetupPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="4 or 6 digits"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="sensitive-module-confirm-pin">Confirm PIN</Label>
                        <Input
                          id="sensitive-module-confirm-pin"
                          type="password"
                          inputMode="numeric"
                          autoComplete="off"
                          value={confirmSetupPin}
                          onChange={(event) => setConfirmSetupPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="Repeat PIN"
                        />
                      </div>
                    </div>
                    <p className="text-center text-xs text-muted-foreground">
                      This PIN cannot be the same or similar to your normal account password.
                    </p>
                    <Button
                      type="button"
                      onClick={() => void requestPinSetup()}
                      disabled={working || !setupPin || !confirmSetupPin}
                      className="mx-auto w-fit bg-avs-yellow text-slate-900 hover:bg-[#d1b82f] disabled:opacity-60"
                    >
                      {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                      Set PIN and Unlock Protected Modules
                    </Button>
                  </>
                ) : (
                  <div className="space-y-3 rounded-xl border border-avs-yellow/35 bg-avs-yellow/10 p-4">
                    <p className="text-center text-sm text-foreground">
                      Enter the 6-digit verification code sent to {setupEmail || 'your email address'}.
                    </p>
                    <Input
                      value={verificationCode}
                      onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      className="mx-auto max-w-48 text-center text-lg tracking-[0.35em]"
                    />
                    <Button
                      type="button"
                      onClick={() => void confirmPinSetup()}
                      disabled={working || verificationCode.length !== 6}
                      className="w-full bg-avs-yellow text-slate-900 hover:bg-[#d1b82f] disabled:opacity-60"
                    >
                      {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Set PIN and Unlock Protected Modules
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <form
                className="mx-auto grid max-w-md gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleUnlock();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="sensitive-module-pin">Sensitive PIN</Label>
                  <Input
                    ref={pinInputRef}
                    id="sensitive-module-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={pin}
                    onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="4 or 6 digits"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={working || !pinCanUnlock}
                  className="mx-auto w-fit bg-avs-yellow text-slate-900 hover:bg-[#d1b82f] disabled:opacity-60"
                >
                  {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LockKeyhole className="mr-2 h-4 w-4" />}
                  Unlock {moduleLabel}
                </Button>
              </form>
            )}
          </CardContent>
        </div>
      </Card>
    </div>
  );
}
