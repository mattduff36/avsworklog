'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { LockKeyhole, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ModuleName } from '@/types/roles';

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

  return {
    loading,
    state,
    canAccess: Boolean(state && (!state.required || state.unlocked)),
    refresh,
    unlock,
  };
}

export function SensitiveModuleGate({
  moduleLabel,
  access,
}: {
  moduleLabel: string;
  access: SensitiveModuleAccessState;
}) {
  const [pin, setPin] = useState('');
  const [working, setWorking] = useState(false);
  const pinStatus = access.state?.pin_status;
  const setupRequired = !pinStatus?.configured || pinStatus.must_reset;

  async function handleUnlock() {
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

  return (
    <Card className="border-border">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-avs-yellow/15 p-2 text-avs-yellow">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>{moduleLabel} Requires Sensitive PIN</CardTitle>
            <CardDescription>
              Enter your sensitive access PIN to unlock this module for 20 minutes on this session.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {setupRequired ? (
          <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            <p>You need to set or reset your sensitive access PIN before opening this module.</p>
            <Button asChild className="bg-avs-yellow text-slate-900 hover:bg-[#d1b82f]">
              <Link href="/profile">Manage PIN in Profile</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-[220px_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="sensitive-module-pin">Sensitive PIN</Label>
              <Input
                id="sensitive-module-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="4 or 6 digits"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                onClick={() => void handleUnlock()}
                disabled={working || (pin.length !== 4 && pin.length !== 6)}
                className="bg-avs-yellow text-slate-900 hover:bg-[#d1b82f] disabled:opacity-60"
              >
                {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LockKeyhole className="mr-2 h-4 w-4" />}
                Unlock {moduleLabel}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
