'use client';

import { useEffect, useState } from 'react';
import { Loader2, PackageOpen } from 'lucide-react';
import type { YardKioskBootstrapResponse } from '@/lib/inventory/kiosk-types';
import {
  hasNativeKioskBridge,
  kioskFetch,
} from '@/lib/inventory/kiosk-native';
import {
  buildYardKioskUserError,
  createYardKioskDiagnosticId,
} from '@/lib/inventory/kiosk-errors';
import { YardKioskApp } from './YardKioskApp';
import { YardKioskRecoveryScreen } from './YardKioskRecoveryScreen';

export function YardKioskBootstrapLoader() {
  const [bootstrap, setBootstrap] = useState<YardKioskBootstrapResponse | null>(null);
  const [error, setError] = useState<ReturnType<typeof buildYardKioskUserError> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await kioskFetch('/api/inventory/kiosk/bootstrap', {
          cache: 'no-store',
        });
        const payload = await response.json() as YardKioskBootstrapResponse & {
          error?: string;
          code?: string;
        };
        if (response.status === 401) {
          window.location.replace(
            hasNativeKioskBridge() ? '/yard-kiosk/native' : '/yard-kiosk/activate',
          );
          return;
        }
        if (!response.ok) {
          throw new Error(payload.error || 'Yard Inventory could not be loaded');
        }
        if (!cancelled) setBootstrap(payload);
      } catch (nextError) {
        if (!cancelled) {
          setError(buildYardKioskUserError('SERVICE_UNAVAILABLE', {
            diagnosticId: createYardKioskDiagnosticId(),
            technicalDetail: nextError instanceof Error ? nextError.message : undefined,
            whatHappened: 'Live Inventory data could not be loaded for Yard Inventory.',
          }));
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (bootstrap) return <YardKioskApp bootstrap={bootstrap} />;
  if (error) {
    return (
      <YardKioskRecoveryScreen
        error={error}
        onAction={() => window.location.reload()}
      />
    );
  }
  return (
    <main className="fixed inset-0 grid place-items-center bg-slate-950 text-white">
      <div className="text-center">
        <PackageOpen className="mx-auto h-12 w-12 text-amber-300" />
        <Loader2 className="mx-auto mt-5 h-10 w-10 animate-spin text-amber-300" />
        <p className="mt-4 text-lg font-bold text-slate-200">Loading Yard Inventory…</p>
      </div>
    </main>
  );
}
