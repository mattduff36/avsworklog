'use client';

import { Analytics } from '@vercel/analytics/react';
import dynamic from 'next/dynamic';
import { Toaster } from '@/components/ui/sonner';
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

interface AppProvidersProps {
  children: React.ReactNode;
  shouldLoadAnalytics: boolean;
}

export function AppProviders({ children, shouldLoadAnalytics }: AppProvidersProps) {
  return (
    <>
      <ErrorLoggerInit />
      <DeploymentVersionChecker />
      <QueryProvider>
        <AuthProvider>
          {children}
          <Toaster />
          {shouldLoadAnalytics ? <Analytics /> : null}
        </AuthProvider>
      </QueryProvider>
    </>
  );
}
