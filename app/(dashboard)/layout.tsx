import { Navbar } from '@/components/layout/Navbar';
import { DashboardContent } from '@/components/layout/DashboardContent';
import { MessageBlockingCheck } from '@/components/messages/MessageBlockingCheck';
import { MobileNavBar } from '@/components/layout/MobileNavBar';
import { PullToRefresh } from '@/components/layout/PullToRefresh';

// Force dynamic rendering to prevent build-time errors
export const dynamic = 'force-dynamic';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 relative">
      {/* Subtle background pattern */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(241,214,74,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(241,214,74,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />
      
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

