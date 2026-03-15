'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

const TABLET_MODE_STORAGE_KEY_PREFIX = 'tablet_mode:';
const TABLET_MODE_ON_VALUE = 'on';
const TABLET_MODE_INFO_MODAL_FEATURE_ENABLED = true;
const TABLET_MODE_INFO_ACK_KEY_PREFIX = 'tablet_mode_info_ack:';
const TABLET_MODE_INFO_ACK_VALUE = 'acknowledged';
const TABLET_MODE_INFO_ACK_VERSION = 'v1';

interface TabletModeContextValue {
  tabletModeEnabled: boolean;
  tabletModeInfoOpen: boolean;
  enableTabletMode: () => void;
  disableTabletMode: () => void;
  toggleTabletMode: () => void;
  dismissTabletModeInfo: () => void;
}

interface TabletModeProviderProps {
  children: React.ReactNode;
}

const TabletModeContext = createContext<TabletModeContextValue | undefined>(undefined);

function getTabletModeStorageKey(userId: string): string {
  return `${TABLET_MODE_STORAGE_KEY_PREFIX}${userId}`;
}

function getTabletModeInfoAckKey(userId: string): string {
  return `${TABLET_MODE_INFO_ACK_KEY_PREFIX}${userId}:${TABLET_MODE_INFO_ACK_VERSION}`;
}

function safeLocalStorageGet(key: string): string | null {
  if (typeof window === 'undefined') return null;

  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures (private mode / quota / denied access).
  }
}

export function TabletModeProvider({ children }: TabletModeProviderProps) {
  const supabase = useMemo(() => createClient(), []);
  const [tabletModeEnabled, setTabletModeEnabled] = useState(false);
  const [tabletModeInfoOpen, setTabletModeInfoOpen] = useState(false);
  const [storageUserId, setStorageUserId] = useState<string | null>(null);
  const [hydratedStorage, setHydratedStorage] = useState(false);

  useEffect(() => {
    let mounted = true;

    function applyUserStorageState(userId: string | null) {
      if (!mounted) return;

      if (!userId) {
        setStorageUserId(null);
        setTabletModeEnabled(false);
        setHydratedStorage(true);
        return;
      }

      const storedValue = safeLocalStorageGet(getTabletModeStorageKey(userId));
      setStorageUserId(userId);
      setTabletModeEnabled(storedValue === TABLET_MODE_ON_VALUE);
      setHydratedStorage(true);
    }

    async function loadInitialUser() {
      const { data } = await supabase.auth.getUser();
      applyUserStorageState(data.user?.id ?? null);
    }

    void loadInitialUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      applyUserStorageState(session?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!hydratedStorage || !storageUserId) return;

    safeLocalStorageSet(
      getTabletModeStorageKey(storageUserId),
      tabletModeEnabled ? TABLET_MODE_ON_VALUE : 'off'
    );
  }, [hydratedStorage, storageUserId, tabletModeEnabled]);

  const maybeShowTabletModeInfo = useCallback(() => {
    if (!TABLET_MODE_INFO_MODAL_FEATURE_ENABLED || !storageUserId) return;
    if (safeLocalStorageGet(getTabletModeInfoAckKey(storageUserId)) === TABLET_MODE_INFO_ACK_VALUE) return;
    setTabletModeInfoOpen(true);
  }, [storageUserId]);

  const markTabletModeInfoAcknowledged = useCallback(() => {
    if (!storageUserId) return;
    safeLocalStorageSet(getTabletModeInfoAckKey(storageUserId), TABLET_MODE_INFO_ACK_VALUE);
  }, [storageUserId]);

  const enableTabletMode = useCallback(() => {
    setTabletModeEnabled(true);
    maybeShowTabletModeInfo();
  }, [maybeShowTabletModeInfo]);

  const disableTabletMode = useCallback(() => {
    setTabletModeEnabled(false);
  }, []);

  const toggleTabletMode = useCallback(() => {
    setTabletModeEnabled((current) => {
      const next = !current;
      if (next) {
        maybeShowTabletModeInfo();
      }
      return next;
    });
  }, [maybeShowTabletModeInfo]);

  const dismissTabletModeInfo = useCallback(() => {
    setTabletModeInfoOpen(false);
    markTabletModeInfoAcknowledged();
  }, [markTabletModeInfoAcknowledged]);

  const value = useMemo<TabletModeContextValue>(
    () => ({
      tabletModeEnabled,
      tabletModeInfoOpen,
      enableTabletMode,
      disableTabletMode,
      toggleTabletMode,
      dismissTabletModeInfo,
    }),
    [tabletModeEnabled, tabletModeInfoOpen, enableTabletMode, disableTabletMode, toggleTabletMode, dismissTabletModeInfo]
  );

  return <TabletModeContext.Provider value={value}>{children}</TabletModeContext.Provider>;
}

export function useTabletMode(): TabletModeContextValue {
  const context = useContext(TabletModeContext);

  if (!context) {
    throw new Error('useTabletMode must be used within TabletModeProvider');
  }

  return context;
}

export { getTabletModeStorageKey };
