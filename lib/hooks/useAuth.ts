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

