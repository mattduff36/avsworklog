'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { DashboardContent } from '@/components/layout/DashboardContent';
import { MessageBlockingCheck } from '@/components/messages/MessageBlockingCheck';
import { MobileNavBar } from '@/components/layout/MobileNavBar';
import { PullToRefresh } from '@/components/layout/PullToRefresh';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  const { tabletModeEnabled, tabletModeInfoOpen, dismissTabletModeInfo } = useTabletMode();
  
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

