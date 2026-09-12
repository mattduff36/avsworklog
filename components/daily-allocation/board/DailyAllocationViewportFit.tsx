'use client';

import Link from 'next/link';
import { MonitorUp } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import {
  DAILY_ALLOCATION_MOBILE_MAX_WIDTH_PX,
  getDailyAllocationRemainingViewportHeight,
  getDailyAllocationViewportFit,
  measureDailyAllocationMinContentWidth,
  readDailyAllocationMainBottomInset,
  type DailyAllocationViewportFit,
} from '@/components/daily-allocation/board/daily-allocation-viewport-fit';

export function DailyAllocationUnsupportedWidthMessage() {
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

export function DailyAllocationViewportFit({
  header,
  children,
}: {
  header?: ReactNode;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<DailyAllocationViewportFit>({ mode: 'full', scale: 1 });
  const [availableHeight, setAvailableHeight] = useState<number | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const main = root.closest('main');
    const previousPaddingBottom = main?.style.paddingBottom ?? '';
    if (main) {
      main.dataset.dailyAllocationBoard = 'true';
      main.style.paddingBottom = '0.5rem';
    }
    const update = () => {
      const availableWidth = root.clientWidth;
      const viewportWidth = window.visualViewport?.width || window.innerWidth;
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
      setFit(getDailyAllocationViewportFit({
        availableWidth,
        minContentWidth: measureDailyAllocationMinContentWidth(root),
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
      if (main) {
        delete main.dataset.dailyAllocationBoard;
        if (previousPaddingBottom) main.style.paddingBottom = previousPaddingBottom;
        else main.style.removeProperty('padding-bottom');
      }
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  const scale = fit.mode === 'scaled' ? fit.scale : 1;
  return (
    <>
      <div
        ref={rootRef}
        className="hidden min-h-0 w-full flex-1 overflow-hidden md:flex md:flex-col md:gap-4"
        style={availableHeight ? { height: availableHeight } : undefined}
        data-testid="daily-allocation-viewport-fit"
        data-viewport-fit={fit.mode}
        data-viewport-scale={scale.toFixed(3)}
      >
        {header ? <div className="w-full shrink-0">{header}</div> : null}
        {fit.mode === 'blocked' ? (
          <DailyAllocationUnsupportedWidthMessage />
        ) : (
          <div className="relative min-h-0 w-full flex-1">
            <div
              className="absolute inset-0 flex min-h-0 min-w-0 flex-col origin-top-left"
              data-testid="daily-allocation-workspace"
              style={{
                transform: scale < 1 ? `scale(${scale}, 1)` : undefined,
                width: scale < 1 ? `${100 / scale}%` : '100%',
              }}
            >
              {children}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
