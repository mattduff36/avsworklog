'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { useEffect, useState } from 'react';
import {
  APP_WIDESCREEN_CHANGED_EVENT,
  readAppWidescreenPreference,
} from '@/lib/config/layout-preferences';

interface DashboardContentProps {
  children: React.ReactNode;
}

export function DashboardContent({ children }: DashboardContentProps) {
  const { isManager, isActualSuperAdmin } = useAuth();
  const { tabletModeEnabled } = useTabletMode();
  const [isPWA] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    // Check if running as PWA (standalone mode)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIOSStandalone =
      'standalone' in window.navigator &&
      (window.navigator as { standalone?: boolean }).standalone === true;

    return isStandalone || isIOSStandalone;
  });
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

  return (
    <div className={`transition-all duration-300 ${shouldApplySidebarOffset ? 'md:pl-16' : ''}`}>
      <main
        className={`relative z-10 py-8 md:pb-8 ${
          appWidescreenEnabled
            ? 'max-w-none mx-0'
            : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'
        } ${isPWA ? 'pb-24' : 'pb-8'}`}
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

