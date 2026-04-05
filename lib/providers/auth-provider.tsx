'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type SupabaseClient, type User } from '@supabase/supabase-js';
import {
  broadcastAuthStateChange,
  clearLegacyAccountSwitchClientState,
  subscribeToAuthStateChange,
} from '@/lib/app-auth/client';
import {
  loadClientAuthSession,
  type ClientAuthSessionResponse,
  type ClientAuthSessionResult,
} from '@/lib/app-auth/client-session';
import {
  createClient,
  invalidateCachedDataToken,
} from '@/lib/supabase/client';
import type { Database } from '@/types/database';
import { isAdminRole } from '@/lib/utils/role-access';
import { clearViewAsSelection, getViewAsSelection } from '@/lib/utils/view-as-cookie';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

interface Profile extends ProfileRow {
  email?: string | null;
  super_admin?: boolean | null;
  team_id?: string | null;
  team?: {
    id: string;
    name: string;
  } | null;
  role?: {
    name: string;
    display_name: string;
    role_class?: 'admin' | 'manager' | 'employee';
    is_manager_admin: boolean;
    is_super_admin: boolean;
  } | null;
}

interface EffectiveRole {
  name: string;
  display_name: string;
  role_class?: 'admin' | 'manager' | 'employee';
  is_manager_admin: boolean;
  is_super_admin: boolean;
  team_id?: string | null;
  team_name?: string | null;
}

interface OrgTeamsQueryClient {
  from: (relation: 'org_teams') => {
    select: (columns: 'id, name') => {
      eq: (column: 'id', value: string) => {
        single: () => Promise<{
          data: { id: string; name: string } | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
}

interface AuthRecoveryOptions {
  statusCode?: number | null;
  reason?: string;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  locked: boolean;
  signIn: (
    email: string,
    password: string,
    options?: { rememberMe?: boolean; deviceId?: string | null; deviceLabel?: string | null }
  ) => Promise<{
    data: {
      error?: string;
      user?: { id: string; email: string | null };
      profile?: { id: string; must_change_password?: boolean | null };
    } | null;
    error: { message: string } | null;
  }>;
  signOut: (options?: { deviceId?: string | null }) => Promise<{ error: { message: string } | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    employeeId?: string
  ) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
  isAdmin: boolean;
  isManager: boolean;
  isSupervisor: boolean;
  isEmployee: boolean;
  isSuperAdmin: boolean;
  isActualSuperAdmin: boolean;
  isViewingAs: boolean;
  effectiveRole: EffectiveRole | null;
  refreshSession: () => Promise<ClientAuthSessionResult>;
  recoverFromAuthFailure: (options?: AuthRecoveryOptions) => Promise<boolean>;
  forceAuthRedirect: (statusCode?: number | null) => Promise<void>;
}

interface AuthProviderProps {
  children: React.ReactNode;
}

type BrowserSupabaseClient = SupabaseClient<Database>;

const PUBLIC_PATHS = ['/login', '/change-password', '/offline'];

const AuthContext = createContext<AuthContextValue | null>(null);

function extractErrorMessage(err: unknown): string {
  if (!err) return '';
  if (err instanceof Error) return err.message || '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message?: unknown }).message || '');
  }
  return '';
}

function buildSyntheticUser(payload: ClientAuthSessionResponse): User | null {
  if (!payload.user?.id) {
    return null;
  }

  return {
    id: payload.user.id,
    email: payload.user.email || undefined,
    app_metadata: {
      provider: 'app_session',
      providers: ['app_session'],
    },
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  } as User;
}

function getCurrentPath(): string {
  if (typeof window === 'undefined') {
    return '/';
  }

  return `${window.location.pathname}${window.location.search}`;
}

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some((publicPath) => path.startsWith(publicPath));
}

function buildLoginRedirectUrl(): string {
  if (typeof window === 'undefined') {
    return '/login';
  }

  const url = new URL('/login', window.location.origin);
  const currentPath = getCurrentPath();

  if (!isPublicPath(currentPath) && !currentPath.startsWith('/lock')) {
    url.searchParams.set('redirect', currentPath);
  }

  return url.toString();
}

function buildLockRedirectUrl(): string {
  if (typeof window === 'undefined') {
    return '/lock';
  }

  const url = new URL('/lock', window.location.origin);
  const currentPath = getCurrentPath();

  if (!currentPath.startsWith('/lock')) {
    url.searchParams.set('returnTo', currentPath);
  }

  return url.toString();
}

export function AuthProvider({ children }: AuthProviderProps) {
  const previousUserIdRef = useRef<string | null>(null);
  const redirectInProgressRef = useRef<'login' | 'lock' | null>(null);
  const recoveryPromiseRef = useRef<Promise<boolean> | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [effectiveRole, setEffectiveRole] = useState<EffectiveRole | null>(null);
  const [supabase, setSupabase] = useState<BrowserSupabaseClient | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setSupabase(createClient());
  }, []);

  const clearLocalAuthState = useCallback((options?: { clearRoleCache?: boolean; clearViewAs?: boolean }) => {
    const activeUserId = previousUserIdRef.current;

    if (options?.clearRoleCache !== false && activeUserId) {
      localStorage.removeItem(`role_cache_${activeUserId}`);
    }

    if (options?.clearViewAs !== false) {
      clearViewAsSelection();
    }

    localStorage.removeItem('rememberMe');
    invalidateCachedDataToken();
    previousUserIdRef.current = null;
    setUser(null);
    setProfile(null);
    setLocked(false);
    setEffectiveRole(null);
  }, []);

  const redirectToLogin = useCallback(async () => {
    if (typeof window === 'undefined') {
      return;
    }

    const currentPath = getCurrentPath();
    if (isPublicPath(currentPath) || redirectInProgressRef.current === 'login') {
      return;
    }

    redirectInProgressRef.current = 'login';
    clearLocalAuthState();

    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }).catch(() => undefined);

    broadcastAuthStateChange('signed_out');
    window.location.replace(buildLoginRedirectUrl());
  }, [clearLocalAuthState]);

  const redirectToLock = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const currentPath = getCurrentPath();
    if (currentPath.startsWith('/lock') || redirectInProgressRef.current === 'lock' || isPublicPath(currentPath)) {
      return;
    }

    redirectInProgressRef.current = 'lock';
    invalidateCachedDataToken();
    window.location.replace(buildLockRedirectUrl());
  }, []);

  const applySessionPayload = useCallback((payload: ClientAuthSessionResponse) => {
    const nextUser = buildSyntheticUser(payload);
    const nextUserId = nextUser?.id ?? null;
    const previousUserId = previousUserIdRef.current;

    if (previousUserId && nextUserId && previousUserId !== nextUserId) {
      clearViewAsSelection();
      localStorage.removeItem(`role_cache_${previousUserId}`);
    }

    previousUserIdRef.current = nextUserId;
    setUser(nextUser);
    setProfile(payload.profile ? ({ ...payload.profile } as Profile) : null);
    setLocked(payload.locked === true);
  }, []);

  const loadAuthSession = useCallback(async (options?: { silent?: boolean }) => {
    const result = await loadClientAuthSession();

    if (result.status === 'authenticated' && result.payload) {
      redirectInProgressRef.current = null;
      applySessionPayload(result.payload);
      setLoading(false);
      return result;
    }

    if (result.status === 'locked' && result.payload) {
      redirectInProgressRef.current = null;
      applySessionPayload(result.payload);
      setLoading(false);
      redirectToLock();
      return result;
    }

    if (result.status === 'unauthenticated') {
      clearLocalAuthState();
      setLoading(false);
      void redirectToLogin();
      return result;
    }

    if (!options?.silent) {
      const errorMessage = extractErrorMessage(result.error);
      if (errorMessage) {
        console.warn('Failed to load auth session:', errorMessage);
      }
    }

    setLoading(false);
    return result;
  }, [applySessionPayload, clearLocalAuthState, redirectToLock, redirectToLogin]);

  useEffect(() => {
    clearLegacyAccountSwitchClientState();
    void loadAuthSession();

    const unsubscribe = subscribeToAuthStateChange(() => {
      void loadAuthSession({ silent: true });
    });

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void loadAuthSession({ silent: true });
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadAuthSession]);

  useEffect(() => {
    if (!user || !profile) return;

    const storageKey = `role_cache_${user.id}`;
    const cachedRoleId = localStorage.getItem(storageKey);
    const currentRoleId = profile.role?.name || '';

    if (cachedRoleId && cachedRoleId !== currentRoleId) {
      localStorage.removeItem(storageKey);

      if (typeof window !== 'undefined') {
        import('sonner').then(({ toast }) => {
          toast.info('Account Updated', {
            description: 'Your account permissions have been updated. Please log in again to continue.',
            duration: 5000,
          });
        });
      }

      fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }).finally(() => {
        clearLocalAuthState();
        broadcastAuthStateChange('signed_out');
        window.location.href = '/login';
      });
    } else if (!cachedRoleId) {
      localStorage.setItem(storageKey, currentRoleId);
    }
  }, [clearLocalAuthState, profile, user]);

  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      void loadAuthSession({ silent: true });
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [loadAuthSession, user]);

  useEffect(() => {
    const { roleId: viewAsRoleId, teamId: viewAsTeamId } = getViewAsSelection();
    const isActualSuper =
      profile?.super_admin === true || profile?.role?.is_super_admin === true;

    if ((!viewAsRoleId && !viewAsTeamId) || !isActualSuper || !supabase) {
      setEffectiveRole(null);
      return;
    }

    const currentSupabase = supabase;

    async function fetchEffectiveRole() {
      try {
        let nextRole: EffectiveRole | null =
          profile?.role
            ? {
                name: profile.role.name,
                display_name: profile.role.display_name,
                role_class: profile.role.role_class,
                is_manager_admin: profile.role.is_manager_admin,
                is_super_admin: profile.role.is_super_admin,
                team_id: profile.team_id,
                team_name: null,
              }
            : null;

        if (viewAsRoleId) {
          const { data, error } = await currentSupabase
            .from('roles')
            .select('name, display_name, role_class, is_manager_admin, is_super_admin')
            .eq('id', viewAsRoleId)
            .single();
          if (!error && data) {
            nextRole = {
              ...(data as EffectiveRole),
              team_id: nextRole?.team_id ?? profile?.team_id ?? null,
              team_name: null,
            };
          }
        }

        if (viewAsTeamId) {
          const orgTeamsClient = currentSupabase as unknown as OrgTeamsQueryClient;
          const { data: teamData, error: teamError } = await orgTeamsClient
            .from('org_teams')
            .select('id, name')
            .eq('id', viewAsTeamId)
            .single();

          if (!teamError && teamData) {
            nextRole = {
              ...(nextRole ?? {
                name: profile?.role?.name || '',
                display_name: profile?.role?.display_name || '',
                role_class: profile?.role?.role_class,
                is_manager_admin: profile?.role?.is_manager_admin || false,
                is_super_admin: profile?.role?.is_super_admin || false,
              }),
              team_id: teamData.id,
              team_name: teamData.name,
            };
          }
        }

        setEffectiveRole(nextRole);
      } catch {
        setEffectiveRole(null);
      }
    }

    void fetchEffectiveRole();
  }, [profile, supabase]);

  const forceAuthRedirect = useCallback(async (statusCode?: number | null) => {
    if (statusCode === 423 || locked) {
      redirectToLock();
      return;
    }

    await redirectToLogin();
  }, [locked, redirectToLock, redirectToLogin]);

  const recoverFromAuthFailure = useCallback(async (options?: AuthRecoveryOptions) => {
    if (recoveryPromiseRef.current) {
      return recoveryPromiseRef.current;
    }

    recoveryPromiseRef.current = (async () => {
      invalidateCachedDataToken();
      const result = await loadAuthSession({ silent: true });

      if (result.status === 'authenticated') {
        return true;
      }

      await forceAuthRedirect(options?.statusCode ?? result.responseStatus);
      return false;
    })().finally(() => {
      recoveryPromiseRef.current = null;
    });

    return recoveryPromiseRef.current;
  }, [forceAuthRedirect, loadAuthSession]);

  const signIn = useCallback(async (
    email: string,
    password: string,
    options?: { rememberMe?: boolean; deviceId?: string | null; deviceLabel?: string | null }
  ) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        rememberMe: options?.rememberMe === true,
        deviceId: options?.deviceId || null,
        deviceLabel: options?.deviceLabel || null,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      user?: { id: string; email: string | null };
      profile?: { id: string; must_change_password?: boolean | null };
    };

    if (!response.ok) {
      return {
        data: null,
        error: { message: payload.error || 'Login failed' },
      };
    }

    broadcastAuthStateChange('signed_in');
    await loadAuthSession({ silent: true });
    return {
      data: payload,
      error: null,
    };
  }, [loadAuthSession]);

  const signOut = useCallback(async (options?: { deviceId?: string | null }) => {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: options?.deviceId || null,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      return { error: { message: payload.error || 'Logout failed' } };
    }

    clearLocalAuthState();
    broadcastAuthStateChange('signed_out');
    redirectInProgressRef.current = null;
    return { error: null };
  }, [clearLocalAuthState]);

  const signUp = useCallback(async (
    email: string,
    password: string,
    fullName: string,
    employeeId?: string
  ) => {
    if (!supabase) {
      return { data: null, error: { message: 'Unable to initialize authentication client' } };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          employee_id: employeeId,
        },
      },
    });

    return {
      data,
      error: error ? { message: error.message || 'Unable to sign up' } : null,
    };
  }, [supabase]);

  const isActualSuperAdmin =
    profile?.super_admin === true || profile?.role?.is_super_admin === true;
  const isViewingAs = isActualSuperAdmin && effectiveRole !== null;
  const roleForFlags = isViewingAs ? effectiveRole : profile?.role ?? null;

  const value = useMemo<AuthContextValue>(() => ({
    user,
    profile,
    loading,
    locked,
    signIn,
    signOut,
    signUp,
    isAdmin: isAdminRole(roleForFlags),
    isManager: roleForFlags?.role_class === 'manager' || false,
    isSupervisor: (roleForFlags?.name || '').trim().toLowerCase() === 'supervisor',
    isEmployee: roleForFlags?.role_class === 'employee' || false,
    isSuperAdmin: isViewingAs ? (roleForFlags?.is_super_admin || false) : isActualSuperAdmin,
    isActualSuperAdmin,
    isViewingAs,
    effectiveRole,
    refreshSession: () => loadAuthSession({ silent: true }),
    recoverFromAuthFailure,
    forceAuthRedirect,
  }), [
    effectiveRole,
    forceAuthRedirect,
    isActualSuperAdmin,
    isViewingAs,
    loadAuthSession,
    loading,
    locked,
    profile,
    recoverFromAuthFailure,
    roleForFlags,
    signIn,
    signOut,
    signUp,
    user,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}
