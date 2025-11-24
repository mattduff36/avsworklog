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
  const [viewAsRole, setViewAsRole] = useState<ViewAsRole>('actual');
  const isSuperAdmin = userEmail === 'admin@mpdee.co.uk';
  const isViewingAs = viewAsRole !== 'actual';

  // Persist view-as mode in localStorage
  useEffect(() => {
    const stored = localStorage.getItem('viewAsRole');
    if (stored && isSuperAdmin) {
      setViewAsRole(stored as ViewAsRole);
    }
  }, [isSuperAdmin]);

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

