'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

type ViewAsRole = 'actual' | 'employee' | 'manager' | 'admin';

interface ViewAsContextType {
  viewAsRole: ViewAsRole;
  setViewAsRole: (role: ViewAsRole) => void;
  isViewingAs: boolean;
  isSuperAdmin: boolean;
}

const ViewAsContext = createContext<ViewAsContextType | undefined>(undefined);

export function ViewAsProvider({ 
  children,
  userEmail 
}: { 
  children: React.ReactNode;
  userEmail: string | null;
}) {
  const isSuperAdmin = userEmail === 'admin@mpdee.co.uk';
  const [viewAsRole, setViewAsRole] = useState<ViewAsRole>(() => {
    if (typeof window === 'undefined' || !isSuperAdmin) {
      return 'actual';
    }

    const stored = window.localStorage.getItem('viewAsRole') as ViewAsRole | null;
    return stored ?? 'actual';
  });
  const isViewingAs = viewAsRole !== 'actual';

  useEffect(() => {
    if (isSuperAdmin) {
      localStorage.setItem('viewAsRole', viewAsRole);
    }
  }, [viewAsRole, isSuperAdmin]);

  // If not superadmin, always use actual role
  const effectiveViewAsRole = isSuperAdmin ? viewAsRole : 'actual';

  return (
    <ViewAsContext.Provider value={{
      viewAsRole: effectiveViewAsRole,
      setViewAsRole,
      isViewingAs: isSuperAdmin && isViewingAs,
      isSuperAdmin
    }}>
      {children}
    </ViewAsContext.Provider>
  );
}

export function useViewAs() {
  const context = useContext(ViewAsContext);
  if (context === undefined) {
    throw new Error('useViewAs must be used within a ViewAsProvider');
  }
  return context;
}

