'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useCallback } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { DashboardContent } from '@/components/layout/DashboardContent';
import { MessageBlockingCheck } from '@/components/messages/MessageBlockingCheck';
import { MobileNavBar } from '@/components/layout/MobileNavBar';
import { PullToRefresh } from '@/components/layout/PullToRefresh';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getAccentFromRoute } from '@/lib/theme/getAccentFromRoute';
import { TabletModeProvider, useTabletMode } from '@/components/layout/tablet-mode-context';
import { useAuth } from '@/lib/hooks/useAuth';
import { fetchWithAuth } from '@/lib/utils/fetch-with-auth';

const PAGE_VISIT_DEBOUNCE_MS = 250;
const PAGE_VISIT_HEARTBEAT_MS = 60_000;

export function DashboardLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TabletModeProvider>
      <DashboardLayoutShell>{children}</DashboardLayoutShell>
    </TabletModeProvider>
  );
}

function DashboardLayoutShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { profile, loading: authLoading, locked } = useAuth();
  const { tabletModeEnabled, tabletModeInfoOpen, dismissTabletModeInfo } = useTabletMode();
  const lastTrackedPathRef = useRef<string>('');
  const heartbeatIntervalRef = useRef<number | null>(null);
  
  const getCurrentTrackedPath = useCallback(() => {
    if (!pathname) return '';
    const query = searchParams?.toString() || '';
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  const trackPageVisit = useCallback((path: string) => {
    if (!path || authLoading || locked || !profile?.id) return;
    fetchWithAuth('/api/me/page-visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).catch(() => {
      // Avoid noisy console logs for non-critical tracking telemetry.
    });
  }, [authLoading, locked, profile?.id]);

  const stopHeartbeat = useCallback(() => {
    if (!heartbeatIntervalRef.current) return;
    window.clearInterval(heartbeatIntervalRef.current);
    heartbeatIntervalRef.current = null;
  }, []);

  const sendHeartbeat = useCallback(() => {
    if (document.hidden || authLoading || locked || !profile?.id) return;
    const currentPath = getCurrentTrackedPath();
    if (!currentPath) return;
    trackPageVisit(currentPath);
  }, [authLoading, getCurrentTrackedPath, locked, profile?.id, trackPageVisit]);
  
  // Determine the accent color based on current route
  const accent = getAccentFromRoute(pathname, searchParams);

  useEffect(() => {
    const nextPath = getCurrentTrackedPath();
    if (!nextPath) return;
    if (lastTrackedPathRef.current === nextPath) return;
    lastTrackedPathRef.current = nextPath;

    const timer = window.setTimeout(() => {
      trackPageVisit(nextPath);
    }, PAGE_VISIT_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [getCurrentTrackedPath, trackPageVisit]);

  useEffect(() => {
    const startHeartbeat = () => {
      stopHeartbeat();
      if (document.hidden) return;
      heartbeatIntervalRef.current = window.setInterval(sendHeartbeat, PAGE_VISIT_HEARTBEAT_MS);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopHeartbeat();
        return;
      }
      sendHeartbeat();
      startHeartbeat();
    };

    startHeartbeat();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopHeartbeat();
    };
  }, [sendHeartbeat, stopHeartbeat]);

  return (
    <div 
      className="min-h-screen bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 relative"
      data-accent={accent}
      data-tablet-mode={tabletModeEnabled ? 'on' : undefined}
    >
      {/* Plain gradient background - no grid pattern */}
      
      {/* Blocking Message Check (Password Change → Toolbox Talks → Reminders) */}
      <MessageBlockingCheck />
      
      <Navbar />
      <PullToRefresh />
      <DashboardContent>
        {children}
      </DashboardContent>
      
      {/* Mobile Navigation Bar - Bottom of screen on mobile only */}
      <MobileNavBar />

      <Dialog open={tabletModeInfoOpen} onOpenChange={(open) => !open && dismissTabletModeInfo()}>
        <DialogContent className="max-w-lg border-border text-white p-7 sm:p-8 gap-5">
          <DialogHeader className="space-y-3">
            <DialogTitle className="text-xl">Information</DialogTitle>
            <DialogDescription className="text-base leading-relaxed">
              Tablet mode is still under development. You might notice incomplete layouts or interactions while
              we continue improving it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2 sm:justify-center">
            <Button
              type="button"
              onClick={dismissTabletModeInfo}
              className="w-full sm:w-auto min-h-12 text-base px-10 font-semibold bg-avs-yellow text-slate-900 hover:bg-avs-yellow-hover"
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

