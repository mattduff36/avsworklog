'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { useEffect, useState } from 'react';

interface DashboardContentProps {
  children: React.ReactNode;
}

export function DashboardContent({ children }: DashboardContentProps) {
  const { isManager } = useAuth();
  const [isPWA, setIsPWA] = useState(false);

  useEffect(() => {
    // Check if running as PWA (standalone mode)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIOSStandalone = (window.navigator as any).standalone === true;
    setIsPWA(isStandalone || isIOSStandalone);
  }, []);

  return (
    <div className={`transition-all duration-300 ${isManager ? 'md:pl-16' : ''}`}>
      <main className={`relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:pb-8 ${
        isPWA ? 'pb-24' : 'pb-8'
      }`}>
        {children}
      </main>
    </div>
  );
}

