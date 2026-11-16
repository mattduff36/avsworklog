'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Toaster } from '@/components/ui/sonner';
import { PwaShellBridge } from '@/components/layout/PwaShellBridge';
import { DatabaseOutageBlocker } from '@/components/system/DatabaseOutageBlocker';
import { AuthProvider } from '@/lib/providers/auth-provider';
import { QueryProvider } from '@/lib/providers/query-provider';

const ErrorLoggerInit = dynamic(
  () => import('@/components/ErrorLoggerInit').then((mod) => mod.ErrorLoggerInit),
  { ssr: false }
);

const DeploymentVersionChecker = dynamic(
  () => import('@/components/DeploymentVersionChecker').then((mod) => mod.DeploymentVersionChecker),
  { ssr: false }
);

const Analytics = dynamic(
  () => import('@vercel/analytics/react').then((mod) => mod.Analytics),
  { ssr: false }
);

const SpeedInsights = dynamic(
  () => import('@vercel/speed-insights/next').then((mod) => mod.SpeedInsights),
  { ssr: false }
);

interface AppProvidersProps {
  children: React.ReactNode;
  shouldLoadAnalytics: boolean;
}

export function AppProviders({ children, shouldLoadAnalytics }: AppProvidersProps) {
  const pathname = usePathname();
  // Guest capability fragments, names and signatures must never enter app analytics/error capture.
  // No authenticated providers/data-token bootstrap are needed on this isolated public form.
  if (pathname === '/guest-plant-checks') return <>{children}<Toaster /></>;
  return (
    <>
      <PwaShellBridge />
      <ErrorLoggerInit />
      <DeploymentVersionChecker />
      <QueryProvider>
        <AuthProvider>
          {children}
          <DatabaseOutageBlocker />
          <Toaster />
          {shouldLoadAnalytics ? (
            <>
              <Analytics />
              <SpeedInsights />
            </>
          ) : null}
        </AuthProvider>
      </QueryProvider>
    </>
  );
}
