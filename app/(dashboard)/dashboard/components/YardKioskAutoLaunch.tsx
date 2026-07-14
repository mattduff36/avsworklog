'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export const YARD_KIOSK_AUTO_LAUNCH_DELAY_MS = 10_000;

interface YardKioskAutoLaunchProps {
  enabled: boolean;
}

export function YardKioskAutoLaunch({ enabled }: YardKioskAutoLaunchProps) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    const timeoutId = window.setTimeout(() => {
      router.replace('/yard-kiosk');
    }, YARD_KIOSK_AUTO_LAUNCH_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [enabled, router]);

  return null;
}
