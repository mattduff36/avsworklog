'use client';

import Link from 'next/link';
import { MonitorUp } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import {
  DAILY_ALLOCATION_BOARD_MIN_CONTENT_WIDTH_PX,
  DAILY_ALLOCATION_MOBILE_MAX_WIDTH_PX,
  getDailyAllocationRemainingViewportHeight,
  getDailyAllocationViewportFit,
  readDailyAllocationMainBottomInset,
  type DailyAllocationViewportFit,
} from '@/components/daily-allocation/board/daily-allocation-viewport-fit';

function UnsupportedWidthMessage() {
  return (
    <div
      className="flex min-h-[28rem] items-center justify-center rounded-lg border border-slate-700 bg-slate-900 p-6 text-center"
      data-testid="daily-allocation-unsupported-width"
    >
      <div className="max-w-md space-y-4">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300">
          <MonitorUp className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-slate-50">Use a wider screen to edit allocations</h1>
          <p className="text-sm text-slate-300">
            The manager board needs a tablet or desktop at least 768px wide. Phone editing is disabled so timed visits and resource conflicts stay clear.
          </p>
        </div>
        <Button asChild className={boardControlStyles.outline} variant="outline">
          <Link href="/daily-allocation/my">Open employee allocation view</Link>
        </Button>
      </div>
    </div>
  );
}

export function DailyAllocationViewportFit({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<DailyAllocationViewportFit>({ mode: 'full', scale: 1 });
  const [availableHeight, setAvailableHeight] = useState<number | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => {
      const availableWidth = root.clientWidth;
      const viewportWidth = window.visualViewport?.width || window.innerWidth;
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
      setFit(getDailyAllocationViewportFit({
        availableWidth,
        minContentWidth: DAILY_ALLOCATION_BOARD_MIN_CONTENT_WIDTH_PX,
        isMobile: viewportWidth <= DAILY_ALLOCATION_MOBILE_MAX_WIDTH_PX,
        isCoarsePointer,
      }));
      setAvailableHeight(getDailyAllocationRemainingViewportHeight({
        top: root.getBoundingClientRect().top,
        viewportHeight,
        bottomInset: readDailyAllocationMainBottomInset(root),
      }));
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(root);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  const scale = fit.mode === 'scaled' ? fit.scale : 1;
  return (
    <>
      <div className="md:hidden">
        <UnsupportedWidthMessage />
      </div>
      <div
        ref={rootRef}
        className="hidden min-h-0 w-full overflow-hidden md:block"
        style={availableHeight ? { height: availableHeight } : undefined}
        data-testid="daily-allocation-viewport-fit"
        data-viewport-fit={fit.mode}
        data-viewport-scale={scale.toFixed(3)}
      >
        {fit.mode === 'blocked' ? (
          <UnsupportedWidthMessage />
        ) : (
          <div
            className="h-full min-h-0 origin-top-left"
            style={{
              transform: scale < 1 ? `scale(${scale})` : undefined,
              width: scale < 1 ? `${100 / scale}%` : '100%',
              height: scale < 1 ? `${100 / scale}%` : '100%',
            }}
          >
            {children}
          </div>
        )}
      </div>
    </>
  );
}
