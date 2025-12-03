import { DashboardLayoutClient } from '@/components/layout/DashboardLayoutClient';

// Force dynamic rendering for all dashboard pages to prevent build-time prerendering
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayoutClient>{children}</DashboardLayoutClient>;
}

