'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

export const YARD_KIOSK_INSTRUCTION_VISIBLE_MS = 3_000;
export const YARD_KIOSK_INSTRUCTION_FADE_MS = 300;

type OverlayStage = 'visible' | 'fading' | 'hidden';

interface OverlayState {
  instructionKey: string;
  stage: OverlayStage;
}

interface YardKioskInstructionOverlayProps {
  instructionKey: string;
  message: string;
}

export function YardKioskInstructionOverlay({
  instructionKey,
  message,
}: YardKioskInstructionOverlayProps) {
  const [overlayState, setOverlayState] = useState<OverlayState>({
    instructionKey,
    stage: 'visible',
  });
  const fadeTimerRef = useRef<number | null>(null);
  const removeTimerRef = useRef<number | null>(null);
  const stage =
    overlayState.instructionKey === instructionKey
      ? overlayState.stage
      : 'visible';

  const clearTimers = useCallback(() => {
    if (fadeTimerRef.current !== null) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    if (removeTimerRef.current !== null) {
      window.clearTimeout(removeTimerRef.current);
      removeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearTimers();
    const prefersReducedMotion =
      typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    fadeTimerRef.current = prefersReducedMotion
      ? null
      : window.setTimeout(
        () => {
          fadeTimerRef.current = null;
          setOverlayState({ instructionKey, stage: 'fading' });
        },
        YARD_KIOSK_INSTRUCTION_VISIBLE_MS,
      );
    removeTimerRef.current = window.setTimeout(
      () => {
        removeTimerRef.current = null;
        setOverlayState({ instructionKey, stage: 'hidden' });
      },
      YARD_KIOSK_INSTRUCTION_VISIBLE_MS
        + (prefersReducedMotion ? 0 : YARD_KIOSK_INSTRUCTION_FADE_MS),
    );

    return clearTimers;
  }, [clearTimers, instructionKey]);

  function dismissOverlay() {
    clearTimers();
    setOverlayState({ instructionKey, stage: 'hidden' });
  }

  function handleDismissKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    dismissOverlay();
  }

  if (stage === 'hidden') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-state={stage}
      className={[
        'pointer-events-none absolute inset-0 z-40 grid place-items-center px-5',
        'transition-opacity duration-300 ease-out motion-reduce:transition-none',
        stage === 'fading' ? 'opacity-0' : 'opacity-100',
      ].join(' ')}
    >
      <button
        type="button"
        aria-label={`Dismiss guidance: ${message}`}
        onClick={dismissOverlay}
        onKeyDown={handleDismissKeyDown}
        className="pointer-events-auto max-w-[calc(100vw-2.5rem)] rounded-full border-[3px] border-amber-200/30 bg-slate-950/90 px-[clamp(3rem,12vw,9rem)] py-[clamp(3rem,14vh,5.25rem)] text-center shadow-2xl shadow-black/50 backdrop-blur-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300"
      >
        <p className="text-balance text-4xl font-black tracking-tight text-white min-[1180px]:text-5xl">
          {message}
        </p>
      </button>
    </div>
  );
}
