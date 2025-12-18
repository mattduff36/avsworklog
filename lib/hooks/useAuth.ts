'use client';

import { useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { Database } from '@/types/database';

type Profile = Database['public']['Tables']['profiles']['Row'] & {
  role?: {
    name: string;
    display_name: string;
    is_manager_admin: boolean;
    is_super_admin: boolean;
  } | null;
};

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
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
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

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
  }, [user, profile]);

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
        (payload) => {
          console.log('Profile updated in database - checking for role changes...');
          // Force re-fetch to get latest data
          fetchProfile(user.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Periodic check as backup (every 30 seconds)
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
          const currentRoleId = (data.role as any).name;

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
        console.error('Error checking for role changes:', error);
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [user]);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          *,
          role:roles(
            name,
            display_name,
            is_manager_admin,
            is_super_admin
          )
        `)
        .eq('id', userId)
        .single();

      if (error) {
        // If profile doesn't exist, it might be created by trigger
        // Wait a moment and try again
        if (error.code === 'PGRST116') {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const { data: retryData, error: retryError } = await supabase
            .from('profiles')
            .select(`
              *,
              role:roles(
                name,
                display_name,
                is_manager_admin,
                is_super_admin
              )
            `)
            .eq('id', userId)
            .single();
          
          if (retryError) {
            console.error('Profile not found after retry:', retryError);
            setProfile(null);
          } else {
            setProfile(retryData as Profile);
          }
        } else {
          console.error('Error fetching profile:', error);
          setProfile(null);
        }
      } else {
        setProfile(data as Profile);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

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

  return {
    user,
    profile,
    loading,
    signIn,
    signOut,
    signUp,
    isAdmin: profile?.role?.name === 'admin',
    isManager: profile?.role?.is_manager_admin || false,
    isEmployee: profile?.role?.name?.startsWith('employee-') || false,
    isSuperAdmin: profile?.is_super_admin || profile?.role?.is_super_admin || false,
  };
}

