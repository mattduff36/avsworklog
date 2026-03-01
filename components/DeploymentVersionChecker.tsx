'use client';

/**
 * DeploymentVersionChecker
 *
 * Compares the deployment ID baked into the running JavaScript bundle
 * (NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID, set at build time by Vercel) against
 * the deployment ID currently reported by the server (/api/version).
 *
 * If they differ it means a new Vercel deployment has gone live while this
 * tab was open.  We force a full page reload so the user always runs the
 * current bundle.
 *
 * Checks are triggered:
 *   - On component mount (catches tabs restored from bfcache or long-lived tabs)
 *   - On document.visibilitychange → visible (user switches back to the tab)
 *   - On every pathname change (client-side navigation)
 *
 * Does nothing in local development (no NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID).
 */

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

// Baked in at build time by Vercel's system env vars.
// Will be undefined in local dev → checker is a no-op.
const CLIENT_DEPLOYMENT_ID = process.env.NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID;

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // don't hammer the API – max once per 5 min

export function DeploymentVersionChecker() {
  const pathname = usePathname();
  const lastCheckRef = useRef<number>(0);
  const reloadingRef = useRef(false);

  const checkVersion = async (reason: string) => {
    // No-op in local dev or if already reloading
    if (!CLIENT_DEPLOYMENT_ID || reloadingRef.current) return;

    const now = Date.now();
    if (now - lastCheckRef.current < CHECK_INTERVAL_MS) return;
    lastCheckRef.current = now;

    try {
      const res = await fetch('/api/version', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) return;

      const { deploymentId } = await res.json() as { deploymentId: string };

      if (deploymentId && deploymentId !== 'local' && deploymentId !== CLIENT_DEPLOYMENT_ID) {
        console.info(
          `[DeploymentChecker] Stale bundle detected (running=${CLIENT_DEPLOYMENT_ID}, server=${deploymentId}, reason=${reason}). Reloading…`
        );
        reloadingRef.current = true;
        window.location.reload();
      }
    } catch {
      // Network error – don't reload, silently skip
    }
  };

  // Mount check (also fires after bfcache restore since the component remounts)
  useEffect(() => {
    checkVersion('mount');

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkVersion('visibility');
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Route-change check (client-side navigation)
  useEffect(() => {
    checkVersion('navigation');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
