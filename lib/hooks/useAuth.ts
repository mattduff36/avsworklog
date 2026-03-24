'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { Database } from '@/types/database';
import { getViewAsSelection } from '@/lib/utils/view-as-cookie';

type Profile = Database['public']['Tables']['profiles']['Row'] & {
  email?: string | null;
  super_admin?: boolean | null;
  team_id?: string | null;
  role?: {
    name: string;
    display_name: string;
    role_class?: 'admin' | 'manager' | 'employee';
    is_manager_admin: boolean;
    is_super_admin: boolean;
  } | null;
};

interface EffectiveRole {
  name: string;
  display_name: string;
  role_class?: 'admin' | 'manager' | 'employee';
  is_manager_admin: boolean;
  is_super_admin: boolean;
  team_id?: string | null;
  team_name?: string | null;
}

const isNetworkFetchError = (err: unknown): boolean => {
  if (!err) return false;
  if (err instanceof TypeError) {
    return (
      err.message.includes('Failed to fetch') ||
      err.message.includes('NetworkError') ||
      err.message.toLowerCase().includes('network')
    );
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = String((err as { message?: unknown }).message || '');
    return (
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.toLowerCase().includes('network')
    );
  }
  return false;
};

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [effectiveRole, setEffectiveRole] = useState<EffectiveRole | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const fetchProfile = useCallback(async (userId: string) => {
    const profileSelect = `
      id,
      full_name,
      phone_number,
      employee_id,
      role_id,
      super_admin,
      team_id,
      must_change_password,
      created_at,
      updated_at,
      role:roles(
        name,
        display_name,
        role_class,
        is_manager_admin,
        is_super_admin
      )
    `;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(profileSelect)
        .eq('id', userId)
        .single();

      if (error) {
        // If profile doesn't exist, it might be created by trigger
        // Wait a moment and try again
        if (error.code === 'PGRST116') {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const { data: retryData, error: retryError } = await supabase
            .from('profiles')
            .select(profileSelect)
            .eq('id', userId)
            .single();
          
          if (retryError) {
            // Not actionable in most cases (profile creation trigger timing) + avoid console.error interception
            console.warn('Profile not found after retry:', retryError);
            // Only clear profile if we didn't already have one
            setProfile(prev => prev ?? null);
          } else {
            setProfile(retryData as Profile);
          }
        } else {
          // If offline / flaky network, don't wipe the existing profile and don't escalate to console.error.
          if (isNetworkFetchError(error)) {
            console.warn('Profile fetch failed (network issue)');
            return;
          }
          console.error('Error fetching profile:', error);
          setProfile(prev => prev ?? null);
        }
      } else {
        setProfile(data as Profile);
      }
    } catch (error) {
      if (isNetworkFetchError(error)) {
        console.warn('Profile fetch failed (network issue)');
      } else {
        console.error('Error fetching profile:', error);
      }
      setProfile(prev => prev ?? null);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile, supabase]);

  // Auto-detect role changes and force re-login
  useEffect(() => {
    if (!user || !profile) return;

    // Store current role_id in localStorage
    const storageKey = `role_cache_${user.id}`;
    const cachedRoleId = localStorage.getItem(storageKey);
    const currentRoleId = profile.role?.name || '';

    if (cachedRoleId && cachedRoleId !== currentRoleId) {
      // Role changed! Force logout and show message
      console.log('Role change detected - forcing re-login');
      localStorage.removeItem(storageKey);
      
      // Show user-friendly message
      if (typeof window !== 'undefined') {
        // Dynamic import to avoid SSR issues
        import('sonner').then(({ toast }) => {
          toast.info('Account Updated', {
            description: 'Your account permissions have been updated. Please log in again to continue.',
            duration: 5000,
          });
        });
      }

      // Force logout
      supabase.auth.signOut().then(() => {
        window.location.href = '/login';
      });
    } else if (!cachedRoleId) {
      // First time or after logout - store current role
      localStorage.setItem(storageKey, currentRoleId);
    }
  }, [user, profile, supabase]);

  // Realtime subscription for profile changes (immediate detection)
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`profile_changes_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        () => {
          console.log('Profile updated in database - checking for role changes...');
          // Force re-fetch to get latest data
          fetchProfile(user.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchProfile, supabase]);

  // Periodic check as a low-frequency backup when realtime misses updates.
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select(`
            role:roles(
              name
            )
          `)
          .eq('id', user.id)
          .single();

        if (data && data.role) {
          const storageKey = `role_cache_${user.id}`;
          const cachedRoleId = localStorage.getItem(storageKey);
          const currentRoleId = (data.role as { name?: string } | null)?.name || '';

          if (cachedRoleId && cachedRoleId !== currentRoleId) {
            // Role changed! Force logout
            console.log('Role change detected via periodic check - forcing re-login');
            localStorage.removeItem(storageKey);

            if (typeof window !== 'undefined') {
              // Dynamic import to avoid SSR issues
              import('sonner').then(({ toast }) => {
                toast.info('Account Updated', {
                  description: 'Your account permissions have been updated. Please log in again to continue.',
                  duration: 5000,
                });
              });
            }

            await supabase.auth.signOut();
            window.location.href = '/login';
          }
        }
      } catch (error) {
        // Avoid escalating transient network issues (common on mobile)
        if (!isNetworkFetchError(error)) {
          console.error('Error checking for role changes:', error);
        } else {
          console.warn('Role change check skipped (network issue)');
        }
      }
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user, supabase]);

  // Fetch effective role/team when view-as cookies are set and user is actual super admin
  useEffect(() => {
    const { roleId: viewAsRoleId, teamId: viewAsTeamId } = getViewAsSelection();
    const isActualSuper =
      profile?.super_admin === true || profile?.role?.is_super_admin === true;

    if ((!viewAsRoleId && !viewAsTeamId) || !isActualSuper) {
      setEffectiveRole(null);
      return;
    }

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
          const { data, error } = await supabase
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
          const { data: teamData, error: teamError } = await supabase
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
    fetchEffectiveRole();
  }, [profile, supabase]);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (!error) {
      // Clear role cache
      if (user) {
        localStorage.removeItem(`role_cache_${user.id}`);
      }
      
      setUser(null);
      setProfile(null);
      
      // Clear remember me preference on logout
      localStorage.removeItem('rememberMe');
    }
    return { error };
  };

  const signUp = async (email: string, password: string, fullName: string, employeeId?: string) => {
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
    return { data, error };
  };

  // Actual (real) super admin flag – never affected by view-as
  const isActualSuperAdmin =
    profile?.super_admin === true || profile?.role?.is_super_admin === true;

  // When viewing as another role, derive flags from the effective role
  const isViewingAs = isActualSuperAdmin && effectiveRole !== null;
  const roleForFlags = isViewingAs ? effectiveRole : profile?.role ?? null;

  return {
    user,
    profile,
    loading,
    signIn,
    signOut,
    signUp,
    // These flags reflect the EFFECTIVE role (overridden when viewing-as)
    isAdmin: roleForFlags?.role_class === 'admin' || roleForFlags?.name === 'admin',
    isManager: roleForFlags?.role_class === 'manager' || false,
    isEmployee: roleForFlags?.role_class === 'employee' || false,
    isSuperAdmin: isViewingAs ? (roleForFlags?.is_super_admin || false) : isActualSuperAdmin,
    // Always reflects the real user, unaffected by view-as
    isActualSuperAdmin,
    isViewingAs,
    effectiveRole,
  };
}

