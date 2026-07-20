'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  YardKioskRecoveryScreen,
  resolveRecoveryError,
} from '../components/YardKioskRecoveryScreen';
import type { YardKioskRecoveryAction } from '@/lib/inventory/kiosk-errors';
import { forceAppRefresh } from '@/lib/client/force-app-refresh';
import { createYardKioskDiagnosticId } from '@/lib/inventory/kiosk-errors';
import { Loader2, PackageOpen } from 'lucide-react';

function YardKioskRecoverContent() {
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const diagnosticId = useMemo(
    () => searchParams.get('ref') || createYardKioskDiagnosticId(),
    [searchParams],
  );
  const error = useMemo(
    () => resolveRecoveryError(searchParams.get('code'), diagnosticId),
    [diagnosticId, searchParams],
  );

  async function handleAction(action: YardKioskRecoveryAction) {
    setBusy(true);
    try {
      if (action === 'retry' || action === 'reload_stock') {
        window.location.replace('/yard-kiosk/activate');
        return;
      }
      if (action === 'check_connection') {
        if (window.navigator.onLine) {
          window.location.replace('/yard-kiosk/activate');
        }
        return;
      }
      if (action === 'refresh_app') {
        await forceAppRefresh({ redirectTo: '/yard-kiosk' });
        return;
      }
      if (action === 'return_to_pairing') {
        window.location.replace('/yard-kiosk/pair');
        return;
      }
      if (action === 'sign_in') {
        window.location.replace('/login?redirect=%2Fyard-kiosk');
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <YardKioskRecoveryScreen
      error={error}
      busy={busy}
      onAction={handleAction}
    />
  );
}

function RecoverFallback() {
  return (
    <main className="fixed inset-0 grid place-items-center bg-slate-950 text-white">
      <div className="text-center">
        <PackageOpen className="mx-auto h-10 w-10 text-amber-300" />
        <Loader2 className="mx-auto mt-4 h-8 w-8 animate-spin text-amber-300" />
        <p className="mt-3 text-slate-300">Loading recovery options…</p>
      </div>
    </main>
  );
}

export default function YardKioskRecoverPage() {
  return (
    <Suspense fallback={<RecoverFallback />}>
      <YardKioskRecoverContent />
    </Suspense>
  );
}
