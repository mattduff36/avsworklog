'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { DashboardContent } from '@/components/layout/DashboardContent';
import { MessageBlockingCheck } from '@/components/messages/MessageBlockingCheck';
import { MobileNavBar } from '@/components/layout/MobileNavBar';
import { PullToRefresh } from '@/components/layout/PullToRefresh';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { useOfflineSync } from '@/lib/hooks/useOfflineSync';
import { getAccentFromRoute } from '@/lib/theme/getAccentFromRoute';

export function DashboardLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isOnline } = useOfflineSync();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  // Determine the accent color based on current route
  const accent = getAccentFromRoute(pathname, searchParams);

  return (
    <div 
      className="min-h-screen bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 relative"
      data-accent={accent}
    >
      {/* Subtle background pattern */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(241,214,74,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(241,214,74,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />
      
      {/* Blocking Message Check (Password Change → Toolbox Talks → Reminders) */}
      <MessageBlockingCheck />
      
      <Navbar />
      <PullToRefresh />
      <DashboardContent>
        {/* Global Offline Banner - shown on all dashboard pages */}
        {!isOnline && <OfflineBanner />}
        {children}
      </DashboardContent>
      
      {/* Mobile Navigation Bar - Bottom of screen on mobile only */}
      <MobileNavBar />
    </div>
  );
}

