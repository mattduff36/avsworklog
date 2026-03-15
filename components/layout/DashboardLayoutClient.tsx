'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { DashboardContent } from '@/components/layout/DashboardContent';
import { MessageBlockingCheck } from '@/components/messages/MessageBlockingCheck';
import { MobileNavBar } from '@/components/layout/MobileNavBar';
import { PullToRefresh } from '@/components/layout/PullToRefresh';
import { getAccentFromRoute } from '@/lib/theme/getAccentFromRoute';
import { TabletModeProvider, useTabletMode } from '@/components/layout/tablet-mode-context';

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
  const { tabletModeEnabled } = useTabletMode();
  
  // Determine the accent color based on current route
  const accent = getAccentFromRoute(pathname, searchParams);

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
    </div>
  );
}

