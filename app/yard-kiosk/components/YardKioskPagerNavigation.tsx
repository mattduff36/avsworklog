'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

export const YARD_KIOSK_INLINE_CONTROL_HEIGHT = 'h-14';
export const YARD_KIOSK_INLINE_CONTROL_RADIUS = 'rounded-2xl';
export const YARD_KIOSK_INLINE_CONTROL_SURFACE = 'border border-white/10 bg-white/5';

interface YardKioskPagerNavigationProps {
  label: string;
  previousLabel: string;
  nextLabel: string;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export function YardKioskPagerNavigation({
  label,
  previousLabel,
  nextLabel,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
}: YardKioskPagerNavigationProps) {
  const buttonClassName = [
    'grid w-14 flex-none place-items-center text-white disabled:opacity-25',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300',
    YARD_KIOSK_INLINE_CONTROL_HEIGHT,
    YARD_KIOSK_INLINE_CONTROL_RADIUS,
    YARD_KIOSK_INLINE_CONTROL_SURFACE,
  ].join(' ');

  return (
    <div
      aria-label={label}
      data-yard-kiosk-pager-navigation="horizontal"
      className="flex flex-none flex-row flex-nowrap items-center gap-2"
    >
      <button
        type="button"
        aria-label={previousLabel}
        onClick={onPrevious}
        disabled={!canGoPrevious}
        className={buttonClassName}
      >
        <ChevronLeft className="h-7 w-7" />
      </button>
      <button
        type="button"
        aria-label={nextLabel}
        onClick={onNext}
        disabled={!canGoNext}
        className={buttonClassName}
      >
        <ChevronRight className="h-7 w-7" />
      </button>
    </div>
  );
}
