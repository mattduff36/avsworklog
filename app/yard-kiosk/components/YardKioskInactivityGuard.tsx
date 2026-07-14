'use client';

import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';

export const YARD_KIOSK_INACTIVITY_WARNING_MS = 105_000;
export const YARD_KIOSK_INACTIVITY_RESET_MS = 120_000;

interface YardKioskInactivityGuardProps {
  onTimeout: () => void;
}

export function YardKioskInactivityGuard({
  onTimeout,
}: YardKioskInactivityGuardProps) {
  const [warningSeconds, setWarningSeconds] = useState<number | null>(null);

  useEffect(() => {
    let warningTimer: number | null = null;
    let resetTimer: number | null = null;
    let countdownTimer: number | null = null;
    let deadline = 0;
    let lastActivityAt = Number.NEGATIVE_INFINITY;

    function clearTimers() {
      if (warningTimer !== null) window.clearTimeout(warningTimer);
      if (resetTimer !== null) window.clearTimeout(resetTimer);
      if (countdownTimer !== null) window.clearInterval(countdownTimer);
      warningTimer = null;
      resetTimer = null;
      countdownTimer = null;
    }

    function updateCountdown() {
      const remainingSeconds = Math.max(
        0,
        Math.ceil((deadline - Date.now()) / 1000),
      );
      setWarningSeconds(remainingSeconds);
    }

    function scheduleTimers() {
      deadline = Date.now() + YARD_KIOSK_INACTIVITY_RESET_MS;
      warningTimer = window.setTimeout(() => {
        warningTimer = null;
        updateCountdown();
        countdownTimer = window.setInterval(updateCountdown, 1000);
      }, YARD_KIOSK_INACTIVITY_WARNING_MS);
      resetTimer = window.setTimeout(() => {
        clearTimers();
        setWarningSeconds(null);
        onTimeout();
      }, YARD_KIOSK_INACTIVITY_RESET_MS);
    }

    function handleActivity(event: Event) {
      if (
        event.type === 'click'
        && event instanceof MouseEvent
        && event.detail > 0
      ) {
        return;
      }
      const activityAt = Date.now();
      if (activityAt - lastActivityAt < 250) return;
      lastActivityAt = activityAt;
      clearTimers();
      setWarningSeconds(null);
      scheduleTimers();
    }

    scheduleTimers();
    window.addEventListener('pointerdown', handleActivity, { passive: true });
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);

    return () => {
      clearTimers();
      window.removeEventListener('pointerdown', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
    };
  }, [onTimeout]);

  if (warningSeconds === null) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="pointer-events-none absolute inset-x-5 top-5 z-[60] flex justify-center"
    >
      <div className="flex max-w-3xl items-center gap-5 rounded-3xl border-[3px] border-amber-300/70 bg-slate-950/95 px-7 py-5 text-left shadow-2xl shadow-black/50 backdrop-blur-xl motion-reduce:transition-none">
        <span className="grid h-16 w-16 flex-none place-items-center rounded-2xl bg-amber-300 text-slate-950 motion-safe:animate-pulse">
          <Clock3 className="h-9 w-9" aria-hidden />
        </span>
        <div>
          <p className="text-2xl font-black tracking-tight text-white">
            Still working?
          </p>
          <p className="mt-1 text-base font-semibold text-slate-200">
            This unfinished movement will be discarded and the kiosk will
            return to the start in{' '}
            <strong className="text-xl font-black text-amber-200">
              {warningSeconds} second{warningSeconds === 1 ? '' : 's'}
            </strong>
            .
          </p>
          <p className="mt-1 text-sm font-bold text-slate-400">
            Touch the screen or press any key to continue.
          </p>
        </div>
      </div>
    </div>
  );
}
