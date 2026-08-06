'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionSnapshot } from '@/lib/hooks/usePermissionSnapshot';
import { getDemoRoute } from '@/components/demo-ui/route-manifest';
import {
  DemoErrorState,
  DemoLoadingState,
} from '@/components/demo-ui/demo-primitives';

interface DemoAccessBoundaryProps {
  children: ReactNode;
}

export function DemoAccessBoundary({ children }: DemoAccessBoundaryProps) {
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const permissions = usePermissionSnapshot();
  const route = getDemoRoute(pathname);

  if (authLoading || permissions.isLoading) {
    return <DemoLoadingState label="Checking demo access" rows={7} />;
  }

  if (!user) {
    return (
      <DemoErrorState
        title="Sign in required"
        message="Your session is not available. Sign in again before opening this protected demo page."
      />
    );
  }

  if (permissions.error) {
    return (
      <DemoErrorState
        title="Permissions unavailable"
        message="Access cannot be confirmed right now, so this demo view has been closed safely."
        onRetry={() => void permissions.refetch()}
      />
    );
  }

  if (!route) {
    return (
      <DemoErrorState
        title="Demo route unavailable"
        message="This path is not registered in the Fresh UI route manifest."
      />
    );
  }

  if (route.module && !permissions.enabledModuleSet.has(route.module)) {
    return (
      <DemoErrorState
        title="Module access denied"
        message={`Your current role does not include access to ${route.label}. No protected data was requested.`}
      />
    );
  }

  return children;
}
