'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, PackageOpen } from 'lucide-react';
import { callNativeKiosk, hasNativeKioskBridge } from '@/lib/inventory/kiosk-native';

interface NativeIdentityStatus {
  paired: boolean;
  device_id: string | null;
}

interface AuthenticationChallenge {
  challenge_id: string;
  challenge: string;
  expires_at: string;
}

interface AuthenticationSignature {
  device_id: string;
  signature: string;
}

export default function YardKioskNativeActivationPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function authenticate() {
      try {
        if (!hasNativeKioskBridge()) {
          throw new Error('Open Yard Inventory from the installed Android app.');
        }
        const identity = await callNativeKiosk(
          'identity.status',
        ) as unknown as NativeIdentityStatus;
        if (!identity.paired || !identity.device_id) {
          window.location.replace('/yard-kiosk/pair');
          return;
        }
        const challengeResponse = await fetch(
          '/api/inventory/kiosk/device-auth/challenge',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({ device_id: identity.device_id }),
          },
        );
        const challenge = await challengeResponse.json() as (
          AuthenticationChallenge & { error?: string; code?: string }
        );
        if (!challengeResponse.ok) {
          if (challenge.code === 'DEVICE_UNPAIRED' || challenge.code === 'DEVICE_REVOKED') {
            await callNativeKiosk('identity.clear').catch(() => undefined);
            window.location.replace('/yard-kiosk/pair');
            return;
          }
          throw new Error(challenge.error || 'Unable to create the device challenge');
        }

        const signature = (
          await callNativeKiosk('auth.sign', {
            challenge_id: challenge.challenge_id,
            challenge: challenge.challenge,
            expires_at: challenge.expires_at,
          })
        ) as unknown as AuthenticationSignature;
        const authenticationResponse = await fetch(
          '/api/inventory/kiosk/device-auth/complete',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({
              device_id: signature.device_id,
              challenge_id: challenge.challenge_id,
              challenge: challenge.challenge,
              expires_at: challenge.expires_at,
              signature: signature.signature,
            }),
          },
        );
        const authentication = await authenticationResponse.json() as {
          authenticated?: boolean;
          error?: string;
          code?: string;
        };
        if (!authenticationResponse.ok || !authentication.authenticated) {
          if (
            authentication.code === 'DEVICE_UNPAIRED'
            || authentication.code === 'DEVICE_REVOKED'
          ) {
            await callNativeKiosk('identity.clear').catch(() => undefined);
            window.location.replace('/yard-kiosk/pair');
            return;
          }
          throw new Error(authentication.error || 'The wall tablet could not be authenticated');
        }
        if (!cancelled) window.location.replace('/yard-kiosk');
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : 'The wall tablet could not be authenticated',
          );
        }
      }
    }

    void authenticate();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="fixed inset-0 grid place-items-center bg-slate-950 p-6 text-white">
      <section className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-slate-900 p-10 text-center shadow-2xl">
        <div className="mx-auto flex w-fit items-center gap-3 rounded-2xl bg-amber-300 px-5 py-3 text-slate-950">
          <PackageOpen className="h-7 w-7" />
          <span className="text-xl font-black">Yard Inventory</span>
        </div>
        {error ? (
          <>
            <AlertTriangle className="mx-auto mt-8 h-12 w-12 text-amber-300" />
            <h1 className="mt-4 text-2xl font-black">Tablet authentication failed</h1>
            <p className="mt-3 text-slate-300">{error}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-7 h-14 rounded-xl bg-amber-300 px-7 font-black text-slate-950"
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto mt-8 h-12 w-12 animate-spin text-amber-300" />
            <h1 className="mt-4 text-2xl font-black">Authenticating this wall tablet</h1>
            <p className="mt-3 text-slate-300">Yard Inventory will open automatically.</p>
          </>
        )}
      </section>
    </main>
  );
}
