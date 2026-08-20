'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { useEffect, useState } from 'react';
import {
  APP_WIDESCREEN_CHANGED_EVENT,
  readAppWidescreenPreference,
} from '@/lib/config/layout-preferences';
import { cn } from '@/lib/utils/cn';

interface DashboardContentProps {
  children: React.ReactNode;
  fullWidth?: boolean;
}

export function DashboardContent({ children, fullWidth = false }: DashboardContentProps) {
  const { isManager, isActualSuperAdmin } = useAuth();
  const { tabletModeEnabled } = useTabletMode();
  const [appWidescreenEnabled, setAppWidescreenEnabled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncPreference = () => {
      setAppWidescreenEnabled(readAppWidescreenPreference());
    };

    syncPreference();
    window.addEventListener('storage', syncPreference);
    window.addEventListener(APP_WIDESCREEN_CHANGED_EVENT, syncPreference);

    return () => {
      window.removeEventListener('storage', syncPreference);
      window.removeEventListener(APP_WIDESCREEN_CHANGED_EVENT, syncPreference);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('app-widescreen-enabled', appWidescreenEnabled);
    return () => document.body.classList.remove('app-widescreen-enabled');
  }, [appWidescreenEnabled]);

  const shouldApplySidebarOffset = !tabletModeEnabled && (isManager || isActualSuperAdmin);
  const expandToViewport = appWidescreenEnabled || fullWidth;

  return (
    <div
      className={cn(
        'transition-all duration-300',
        shouldApplySidebarOffset && 'md:pl-16',
        fullWidth && 'xl:flex xl:min-h-0 xl:flex-1 xl:flex-col',
      )}
    >
      <main
        className={cn(
          'app-content relative pt-[calc(68px+2rem)] pb-8 md:py-8',
          appWidescreenEnabled
            ? 'mx-0 max-w-none'
            : fullWidth
              ? 'mx-0 max-w-none px-4 sm:px-6 lg:px-8'
              : 'mx-auto max-w-7xl px-4 sm:px-6 lg:px-8',
          fullWidth && 'xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden',
        )}
        data-content-width={expandToViewport ? 'full' : 'default'}
        style={
          appWidescreenEnabled
            ? {
                paddingLeft: shouldApplySidebarOffset ? '64px' : '65px',
                paddingRight: '65px',
              }
            : undefined
        }
      >
        {children}
      </main>
    </div>
  );
}

