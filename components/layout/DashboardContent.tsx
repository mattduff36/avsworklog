'use client';

import { useAuth } from '@/lib/hooks/useAuth';

interface DashboardContentProps {
  children: React.ReactNode;
}

export function DashboardContent({ children }: DashboardContentProps) {
  const { isManager } = useAuth();

  return (
    <main 
      className={`relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 transition-all duration-300 ${
        isManager ? 'ml-16' : ''
      }`}
    >
      {children}
    </main>
  );
}

