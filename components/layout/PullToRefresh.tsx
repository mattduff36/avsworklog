'use client';

import { useEffect, useState, useRef } from 'react';
import { RefreshCw } from 'lucide-react';

const PULL_THRESHOLD = 80;
const FOCUSED_FORM_CONTROL_SELECTOR = [
  'input:not([type="hidden"])',
  'textarea',
  'select',
  'button',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="spinbutton"]',
].join(',');

function isInsideMobileScrollLock(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-mobile-scroll-lock="true"]'));
}

function isFormControlFocused(): boolean {
  const activeElement = document.activeElement;
  return activeElement instanceof Element
    && Boolean(activeElement.closest(FOCUSED_FORM_CONTROL_SELECTOR));
}

function hasOpenMobileScrollLock(): boolean {
  return Boolean(document.querySelector(
    '[data-mobile-scroll-lock="true"]:not([data-state="closed"]):not([hidden]):not([aria-hidden="true"])',
  ));
}

function shouldIgnorePullToRefresh(target: EventTarget | null): boolean {
  return isFormControlFocused()
    || isInsideMobileScrollLock(target)
    || hasOpenMobileScrollLock();
}

export function PullToRefresh() {
  const [isPWA, setIsPWA] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const touchCurrentY = useRef<number | null>(null);
  const isPulling = useRef(false);
  const pullDistanceRef = useRef(0);
  const isRefreshingRef = useRef(false);

  // Sync refs with state
  useEffect(() => {
    pullDistanceRef.current = pullDistance;
  }, [pullDistance]);

  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  useEffect(() => {
    // Check if running as PWA (standalone mode)
    const checkPWAMode = () => {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
      const isIOSStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsPWA(isStandalone || isIOSStandalone);
    };

    checkPWAMode();
  }, []);

  useEffect(() => {
    // Only enable pull-to-refresh in PWA mode
    if (!isPWA) return;

    const resetPullGesture = () => {
      touchStartY.current = null;
      touchCurrentY.current = null;
      isPulling.current = false;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (shouldIgnorePullToRefresh(e.target)) {
        resetPullGesture();
        return;
      }

      // Only trigger if at the top of the page
      if (window.scrollY === 0) {
        touchStartY.current = e.touches[0].clientY;
        touchCurrentY.current = null;
        isPulling.current = true;
        pullDistanceRef.current = 0;
        setPullDistance(0);
      } else {
        resetPullGesture();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (shouldIgnorePullToRefresh(e.target)) {
        resetPullGesture();
        return;
      }
      if (!isPulling.current || touchStartY.current === null) return;

      touchCurrentY.current = e.touches[0].clientY;
      const distance = touchCurrentY.current - touchStartY.current;

      // Only allow pulling down (positive distance)
      if (distance > 0 && window.scrollY === 0) {
        // Prevent default scroll behavior
        e.preventDefault();
        pullDistanceRef.current = distance;
        setPullDistance(distance);
      } else {
        // Reset if scrolling up or page has scrolled
        resetPullGesture();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (shouldIgnorePullToRefresh(e.target)) {
        resetPullGesture();
        return;
      }

      const currentDistance = pullDistanceRef.current;
      const refreshing = isRefreshingRef.current;
      
      if (currentDistance >= PULL_THRESHOLD && !refreshing) {
        isRefreshingRef.current = true;
        setIsRefreshing(true);
        // Trigger refresh after a short delay to show the animation
        setTimeout(() => {
          window.location.reload();
        }, 300);
      } else {
        // Reset if threshold not reached
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
      isPulling.current = false;
      touchStartY.current = null;
      touchCurrentY.current = null;
    };

    // Add touch event listeners
    document.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isPWA]);

  // Don't render if not in PWA mode
  if (!isPWA) return null;

  // Calculate rotation and opacity based on pull distance
  const rotation = Math.min(pullDistance / PULL_THRESHOLD * 360, 360);
  const opacity = Math.min(pullDistance / PULL_THRESHOLD, 1);
  const translateY = Math.min(pullDistance * 0.5, PULL_THRESHOLD * 0.5);

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[100] pointer-events-none transition-opacity duration-200 ease-out"
      style={{
        transform: `translateY(${translateY}px)`,
        opacity: pullDistance > 0 ? opacity : 0,
      }}
    >
      <div className="flex items-center justify-center pt-2 pb-2">
        <div className="bg-slate-900/90 backdrop-blur-xl rounded-full p-3 border border-border/50 shadow-lg">
          <RefreshCw
            className={`h-6 w-6 text-avs-yellow transition-transform duration-200 ${
              isRefreshing ? 'animate-spin' : ''
            }`}
            style={{
              transform: isRefreshing ? 'rotate(0deg)' : `rotate(${rotation}deg)`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

