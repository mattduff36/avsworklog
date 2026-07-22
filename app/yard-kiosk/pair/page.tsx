'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PackageOpen,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  buildYardKioskUserError,
  createYardKioskDiagnosticId,
  mapPairingStatusToYardKioskErrorCode,
  type YardKioskUserError,
} from '@/lib/inventory/kiosk-errors';

interface PairingView {
  id: string;
  device_label: string;
  confirmation_code: string | null;
  status: 'active' | 'confirmed' | 'consumed' | 'cancelled' | 'expired';
  candidate_seen_at: string | null;
  expires_at: string;
}

interface PairingPayload {
  status: 'pairing' | 'paired' | 'expired' | 'unavailable';
  pairing?: PairingView | null;
  message?: string;
  error?: string;
  code?: string;
}

type PairUiPhase = 'loading' | 'waiting' | 'code' | 'success' | 'error';

export default function YardKioskPairPage() {
  const [payload, setPayload] = useState<PairingPayload | null>(null);
  const [phase, setPhase] = useState<PairUiPhase>('loading');
  const [userError, setUserError] = useState<YardKioskUserError | null>(null);
  const navigatingRef = useRef(false);
  const diagnosticIdRef = useRef(createYardKioskDiagnosticId());

  const showError = useCallback((next: PairingPayload) => {
    const code = mapPairingStatusToYardKioskErrorCode(
      next.status,
      next.error || next.message,
    ) || 'PAIRING_NOT_STARTED';
    setUserError(buildYardKioskUserError(code, {
      diagnosticId: diagnosticIdRef.current,
      technicalDetail: next.error || next.message,
      whatHappened: next.error || next.message || undefined,
    }));
    setPhase('error');
  }, []);

  const requestPairing = useCallback(async () => {
    if (navigatingRef.current) return;
    try {
      const response = await fetch('/api/inventory/kiosk/pairing', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'X-Yard-Kiosk-Diagnostic-Id': diagnosticIdRef.current,
        },
      });
      const result = await response.json() as PairingPayload;
      setPayload(result);

      if (result.status === 'pairing') {
        setPhase(result.pairing?.confirmation_code ? 'code' : 'waiting');
        return;
      }
      if (result.status === 'paired') {
        setPhase('success');
        navigatingRef.current = true;
        window.location.replace('/yard-kiosk/activate');
        return;
      }
      showError(result);
    } catch {
      showError({
        status: 'unavailable',
        error: 'This device could not reach the pairing service.',
        code: 'FLAKY_CONNECTION',
      });
    }
  }, [showError]);

  const startPairing = useCallback(() => {
    if (navigatingRef.current) return;
    setPhase('loading');
    setUserError(null);
    diagnosticIdRef.current = createYardKioskDiagnosticId();
    void requestPairing();
  }, [requestPairing]);

  useEffect(() => {
    void requestPairing();
  }, [requestPairing]);

  useEffect(() => {
    if (payload?.status !== 'pairing' || navigatingRef.current) return;

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch('/api/inventory/kiosk/pairing', {
          cache: 'no-store',
          headers: {
            'X-Yard-Kiosk-Diagnostic-Id': diagnosticIdRef.current,
          },
        });
        const result = await response.json() as PairingPayload;

        if (result.status === 'paired') {
          navigatingRef.current = true;
          setPayload(result);
          setPhase('success');
          window.clearInterval(interval);
          window.location.replace('/yard-kiosk/activate');
          return;
        }

        setPayload(result);
        if (result.status === 'pairing') {
          setPhase(result.pairing?.confirmation_code ? 'code' : 'waiting');
          return;
        }
        showError(result);
      } catch {
        // Keep the visible code in place through transient connection errors.
      }
    }, 2_000);

    return () => window.clearInterval(interval);
  }, [payload?.status, showError]);

  const pairing = payload?.pairing || null;

  return (
    <main className="fixed inset-x-0 top-0 grid h-[var(--yard-kiosk-viewport-height,100svh)] place-items-center overflow-hidden bg-slate-950 p-6 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(251,191,36,0.16),transparent_34%),radial-gradient(circle_at_85%_85%,rgba(14,165,233,0.1),transparent_30%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:42px_42px]" />

      <section className="relative w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/10 bg-slate-900/85 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div className="h-2 bg-amber-300" />
        <div className="p-8 text-center sm:p-12">
          <div className="mx-auto flex w-fit items-center gap-3 rounded-2xl bg-amber-300 px-5 py-3 text-slate-950">
            <PackageOpen className="h-7 w-7" />
            <span className="text-xl font-black">Yard Inventory</span>
          </div>

          {phase === 'success' ? (
            <>
              <CheckCircle2 className="mx-auto mt-10 h-14 w-14 text-emerald-300" />
              <h1 className="mt-5 text-3xl font-black">
                Pairing complete — starting Yard Inventory
              </h1>
              <p className="mx-auto mt-3 max-w-xl text-lg leading-relaxed text-slate-300">
                This tablet is trusted. Opening the kiosk now.
              </p>
              <div className="mx-auto mt-7 flex w-fit items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-slate-300">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-300" />
                Starting…
              </div>
            </>
          ) : null}

          {phase === 'code' && pairing?.confirmation_code ? (
            <>
              <ShieldCheck className="mx-auto mt-9 h-14 w-14 text-amber-300" />
              <p className="mt-4 text-sm font-black uppercase tracking-[0.24em] text-amber-200">
                Pairing code
              </p>
              <div className="mx-auto mt-4 max-w-xl rounded-[1.75rem] border-2 border-amber-300/60 bg-black/30 px-5 py-7">
                <p className="font-mono text-6xl font-black tracking-[0.22em] text-white sm:text-8xl">
                  {pairing.confirmation_code}
                </p>
              </div>
              <h1 className="mt-7 text-3xl font-black tracking-tight">
                Confirm this code in Inventory Settings
              </h1>
              <p className="mx-auto mt-3 max-w-xl text-lg leading-relaxed text-slate-300">
                Pairing <span className="font-bold text-white">{pairing.device_label}</span>.
                Keep this screen open while an Inventory manager confirms the matching code.
              </p>
              <div className="mx-auto mt-7 flex w-fit items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-slate-300">
                <Loader2 className="h-5 w-5 animate-spin text-amber-300" />
                Waiting for approval
              </div>
            </>
          ) : null}

          {phase === 'loading' || phase === 'waiting' ? (
            <>
              <Loader2 className="mx-auto mt-10 h-14 w-14 animate-spin text-amber-300" />
              <h1 className="mt-5 text-3xl font-black">Looking for an approved pairing window</h1>
              <p className="mt-3 text-lg text-slate-300">
                Ask an Inventory manager to open Settings and start Yard kiosk pairing.
              </p>
            </>
          ) : null}

          {phase === 'error' && userError ? (
            <>
              <AlertTriangle className="mx-auto mt-10 h-14 w-14 text-amber-300" />
              <h1 className="mt-5 text-3xl font-black">{userError.title}</h1>
              <p className="mx-auto mt-3 max-w-xl text-lg leading-relaxed text-slate-300">
                {userError.whatHappened}
              </p>
              <p className="mx-auto mt-2 max-w-xl text-base text-slate-400">
                {userError.whatToDoNext}
              </p>
              <p className="mx-auto mt-4 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                Ref {userError.diagnosticId}
              </p>
              <Button
                type="button"
                onClick={() => void startPairing()}
                className="mt-7 h-14 rounded-xl bg-amber-300 px-7 text-base font-black text-slate-950 hover:bg-amber-200"
              >
                <RefreshCw className="mr-2 h-5 w-5" />
                Try again
              </Button>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
