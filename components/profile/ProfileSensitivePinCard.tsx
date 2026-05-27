'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface SensitivePinStatus {
  configured: boolean;
  must_reset: boolean;
  locked_until: string | null;
}

type SensitivePinMode = 'setup' | 'change' | 'reset';

export function ProfileSensitivePinCard() {
  const [status, setStatus] = useState<SensitivePinStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [pendingMode, setPendingMode] = useState<SensitivePinMode | null>(null);
  const [sentToEmail, setSentToEmail] = useState('');

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/me/sensitive-pin/status', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load sensitive PIN status');
      }
      setStatus(payload.status);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load sensitive PIN status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const mode: SensitivePinMode = useMemo(() => {
    if (!status?.configured || status.must_reset) return 'setup';
    return 'change';
  }, [status]);

  const actionLabel = mode === 'setup' ? 'Set sensitive PIN' : 'Change sensitive PIN';

  async function requestVerification(nextMode: SensitivePinMode) {
    if (pin !== confirmPin) {
      toast.error('PINs do not match');
      return;
    }
    if (!/^\d{4}$|^\d{6}$/.test(pin)) {
      toast.error('PIN must be either 4 or 6 digits');
      return;
    }

    setWorking(true);
    try {
      const response = await fetch(`/api/me/sensitive-pin/${nextMode}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to send verification email');
      }

      setPendingMode(nextMode);
      setSentToEmail(payload.email || '');
      setVerificationCode('');
      toast.success('Verification code sent');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to send verification email');
    } finally {
      setWorking(false);
    }
  }

  async function confirmVerification() {
    if (!pendingMode) return;

    setWorking(true);
    try {
      const response = await fetch(`/api/me/sensitive-pin/${pendingMode}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verificationCode }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to confirm verification code');
      }

      setPin('');
      setConfirmPin('');
      setVerificationCode('');
      setPendingMode(null);
      setSentToEmail('');
      toast.success(payload.eventType === 'set' ? 'Sensitive PIN set' : 'Sensitive PIN changed');
      await loadStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to confirm verification code');
    } finally {
      setWorking(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-avs-yellow/15 p-2 text-avs-yellow">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>Sensitive Access PIN</CardTitle>
            <CardDescription>
              Manage the extra PIN used for protected modules such as Quotes and Customers.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Checking sensitive PIN status...</span>
          </div>
        ) : (
          <>
            <div className="rounded-md border border-border bg-slate-900/30 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {status?.configured && !status.must_reset
                  ? 'PIN configured'
                  : status?.must_reset
                    ? 'Reset required'
                    : 'No PIN configured'}
              </p>
              {status?.locked_until ? (
                <p className="mt-1 text-xs text-amber-300">
                  Temporarily locked until {new Date(status.locked_until).toLocaleString()}.
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sensitive-pin">New PIN</Label>
                <Input
                  id="sensitive-pin"
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="off"
                  type="password"
                  placeholder="4 or 6 digits"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sensitive-pin-confirm">Confirm PIN</Label>
                <Input
                  id="sensitive-pin-confirm"
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="off"
                  type="password"
                  placeholder="Repeat PIN"
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Choose 4 or 6 digits. This PIN cannot be the same as your normal account password.
              A verification code will be emailed before the PIN is activated.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void requestVerification(mode)}
                disabled={working || !pin || !confirmPin}
                className="bg-avs-yellow text-slate-900 hover:bg-[#d1b82f] disabled:opacity-60"
              >
                {working && !pendingMode ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                {actionLabel}
              </Button>
              {status?.configured && !status.must_reset ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void requestVerification('reset')}
                  disabled={working || !pin || !confirmPin}
                  className="border-border bg-slate-900/40 text-foreground hover:bg-slate-800"
                >
                  Reset with email verification
                </Button>
              ) : null}
            </div>

            {pendingMode ? (
              <div className="space-y-3 rounded-lg border border-avs-yellow/40 bg-avs-yellow/10 p-4">
                <p className="text-sm text-foreground">
                  Enter the 6-digit verification code sent to {sentToEmail || 'your email address'}.
                </p>
                <div className="grid gap-3 md:grid-cols-[180px_auto]">
                  <Input
                    value={verificationCode}
                    onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                  />
                  <Button
                    type="button"
                    onClick={() => void confirmVerification()}
                    disabled={working || verificationCode.length !== 6}
                    className="bg-avs-yellow text-slate-900 hover:bg-[#d1b82f] disabled:opacity-60"
                  >
                    {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Confirm PIN
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
