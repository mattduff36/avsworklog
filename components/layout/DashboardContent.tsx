'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const WORKSHOP_WIDESCREEN_STORAGE_KEY = 'workshop-tasks-widescreen-view';

interface DashboardContentProps {
  children: React.ReactNode;
}

export function DashboardContent({ children }: DashboardContentProps) {
  const { isManager, isActualSuperAdmin } = useAuth();
  const { tabletModeEnabled } = useTabletMode();
  const pathname = usePathname();
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
  const [workshopWidescreenEnabled, setWorkshopWidescreenEnabled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncPreference = () => {
      try {
        setWorkshopWidescreenEnabled(localStorage.getItem(WORKSHOP_WIDESCREEN_STORAGE_KEY) === 'true');
      } catch {
        setWorkshopWidescreenEnabled(false);
      }
    };

    syncPreference();
    window.addEventListener('storage', syncPreference);
    window.addEventListener('workshop-widescreen-changed', syncPreference);

    return () => {
      window.removeEventListener('storage', syncPreference);
      window.removeEventListener('workshop-widescreen-changed', syncPreference);
    };
  }, []);

  const isWorkshopWidescreen =
    pathname?.startsWith('/workshop-tasks') &&
    workshopWidescreenEnabled;
  const shouldApplySidebarOffset = !tabletModeEnabled && (isManager || isActualSuperAdmin);

  return (
    <div className={`transition-all duration-300 ${shouldApplySidebarOffset ? 'md:pl-16' : ''}`}>
      <main
        className={`relative z-10 py-8 md:pb-8 ${
          isWorkshopWidescreen
            ? 'max-w-none mx-0'
            : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'
        } ${isPWA ? 'pb-24' : 'pb-8'}`}
        style={
          isWorkshopWidescreen
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

