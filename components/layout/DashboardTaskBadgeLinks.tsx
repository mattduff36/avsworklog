'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface DashboardTaskBadgeLink {
  href: string;
  label: string;
  count: number;
  icon: LucideIcon;
}

interface DashboardTaskBadgeLinksProps {
  items: DashboardTaskBadgeLink[];
  variant?: 'dashboard' | 'navbar';
  navbarSpacing?: 'compact' | 'comfortable' | 'responsive';
  navbarLabels?: 'hidden' | 'responsive' | 'always';
  animateOnLoad?: boolean;
  animationStartIndex?: number;
  className?: string;
}

function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

export function DashboardTaskBadgeLinks({
  items,
  variant = 'dashboard',
  navbarSpacing = 'compact',
  navbarLabels = 'hidden',
  animateOnLoad = false,
  animationStartIndex = 0,
  className,
}: DashboardTaskBadgeLinksProps) {
  const isNavbar = variant === 'navbar';
  const navRef = useRef<HTMLElement | null>(null);
  const measurementRef = useRef<HTMLDivElement | null>(null);
  const [responsiveLabelsFit, setResponsiveLabelsFit] = useState(true);
  const measurementKey = items.map(item => item.label).join('|');

  useLayoutEffect(() => {
    if (!isNavbar || navbarLabels !== 'responsive') {
      return;
    }

    const nav = navRef.current;
    const measurement = measurementRef.current;
    if (!nav || !measurement) {
      return;
    }

    const updateLabelVisibility = () => {
      setResponsiveLabelsFit(measurement.scrollWidth <= nav.clientWidth);
    };

    updateLabelVisibility();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(updateLabelVisibility);
    observer.observe(nav);
    observer.observe(measurement);

    return () => observer.disconnect();
  }, [isNavbar, measurementKey, navbarLabels, navbarSpacing]);

  if (items.length === 0) {
    return null;
  }

  const showNavbarLabels =
    navbarLabels === 'always' ||
    (navbarLabels === 'responsive' && responsiveLabelsFit);
  const navbarGapClass =
    navbarSpacing === 'comfortable'
      ? 'gap-3'
      : navbarSpacing === 'responsive'
        ? 'gap-1 sm:gap-3'
        : 'gap-1';

  return (
    <nav
      ref={navRef}
      aria-label="Pending management tasks"
      className={cn(
        isNavbar
          ? cn(
              'pointer-events-auto relative',
              navbarLabels === 'responsive' &&
                'w-[calc(100%-7rem)] min-[420px]:w-[calc(100%-15rem)]'
            )
          : 'min-w-0 w-full md:w-auto md:max-w-[58%]',
        className
      )}
    >
      <TooltipProvider>
        {isNavbar && navbarLabels === 'responsive' ? (
          <div
            ref={measurementRef}
            aria-hidden="true"
            className={cn(
              'pointer-events-none invisible absolute flex w-max items-start px-1 pb-1 pt-2',
              navbarGapClass
            )}
          >
            {items.map(({ href, label }) => (
              <span
                key={href}
                className="flex min-w-8 shrink-0 flex-col items-center gap-1"
              >
                <span className="h-8 w-8" />
                <span className="max-w-20 truncate whitespace-nowrap text-[10px] font-medium leading-tight">
                  {label}
                </span>
              </span>
            ))}
          </div>
        ) : null}
        <div
          className={cn(
            'flex items-start overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            isNavbar
              ? cn(navbarGapClass, 'justify-center px-1 pb-1 pt-2')
              : 'gap-2 px-1 pb-1 pt-2 md:justify-end'
          )}
        >
          {items.map(({ href, label, count, icon: Icon }, index) => (
            <Tooltip key={href}>
              <TooltipTrigger asChild>
                <Link
                  href={href}
                  aria-label={`${label}: ${count} pending`}
                  style={
                    animateOnLoad
                      ? { animationDelay: `${75 + ((animationStartIndex + index) * 75)}ms` }
                      : undefined
                  }
                  className={cn(
                    'group flex shrink-0 flex-col items-center rounded-md text-slate-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-avs-yellow focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
                    isNavbar
                      ? cn('min-w-8', showNavbarLabels ? 'gap-1' : 'gap-0')
                      : 'min-w-14 gap-1',
                    animateOnLoad &&
                      'animate-badge-pop motion-reduce:animate-none motion-reduce:opacity-100'
                  )}
                >
                  <span
                    className={cn(
                      'relative flex items-center justify-center rounded-full border border-slate-600 bg-slate-800/80 shadow-sm transition-colors group-hover:border-slate-500 group-hover:bg-slate-700',
                      isNavbar ? 'h-8 w-8' : 'h-10 w-10'
                    )}
                  >
                    <Icon className={isNavbar ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden="true" />
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute flex items-center justify-center rounded-full bg-red-500 font-bold leading-none text-white shadow-md ring-2 ring-slate-900',
                        isNavbar
                          ? '-right-1 -top-1 h-4 min-w-4 px-0.5 text-[9px]'
                          : '-right-1.5 -top-1.5 h-5 min-w-5 px-1 text-[10px]'
                      )}
                    >
                      {formatBadgeCount(count)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'max-w-20 truncate text-[10px] font-medium leading-tight',
                      isNavbar && !showNavbarLabels && 'sr-only'
                    )}
                  >
                    {label}
                  </span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {label}: {count} pending
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    </nav>
  );
}
