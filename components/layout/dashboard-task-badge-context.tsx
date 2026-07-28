'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface DashboardTaskBadgeCounts {
  approvals: number;
  actions: number;
  suggestions: number;
  quotes: number;
  errorReports: number;
}

interface DashboardTaskBadgeState {
  counts: DashboardTaskBadgeCounts;
  ready: boolean;
}

interface DashboardTaskBadgeContextValue extends DashboardTaskBadgeState {
  publish: (counts: DashboardTaskBadgeCounts) => void;
  reset: () => void;
}

interface DashboardTaskBadgeProviderProps {
  children: ReactNode;
}

const emptyCounts: DashboardTaskBadgeCounts = {
  approvals: 0,
  actions: 0,
  suggestions: 0,
  quotes: 0,
  errorReports: 0,
};

const DashboardTaskBadgeContext = createContext<DashboardTaskBadgeContextValue | null>(null);

export function DashboardTaskBadgeProvider({ children }: DashboardTaskBadgeProviderProps) {
  const [state, setState] = useState<DashboardTaskBadgeState>({
    counts: emptyCounts,
    ready: false,
  });

  const publish = useCallback((counts: DashboardTaskBadgeCounts) => {
    setState({ counts, ready: true });
  }, []);

  const reset = useCallback(() => {
    setState({ counts: emptyCounts, ready: false });
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      publish,
      reset,
    }),
    [publish, reset, state]
  );

  return (
    <DashboardTaskBadgeContext.Provider value={value}>
      {children}
    </DashboardTaskBadgeContext.Provider>
  );
}

export function useDashboardTaskBadges(): DashboardTaskBadgeContextValue {
  const context = useContext(DashboardTaskBadgeContext);
  if (!context) {
    throw new Error('useDashboardTaskBadges must be used within DashboardTaskBadgeProvider');
  }
  return context;
}
