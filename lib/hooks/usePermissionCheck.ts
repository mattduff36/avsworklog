'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './useAuth';
import { createClient } from '@/lib/supabase/client';
import type { ModuleName } from '@/types/roles';
import { toast } from 'sonner';

/**
 * Hook to check if user has permission to access a module
 * Redirects to dashboard with error message if unauthorized
 * 
 * @param moduleName - The module to check access for
 * @param redirectOnFail - Whether to redirect if unauthorized (default: true)
 * @returns Object with hasPermission and loading states
 */
export function usePermissionCheck(moduleName: ModuleName, redirectOnFail = true) {
  const { user, profile, isManager, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const [hasPermission, setHasPermission] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkPermission() {
      // Wait for auth to load
      if (authLoading) {
        return;
      }

      // If not authenticated, let the auth middleware handle it
      if (!user || !profile) {
        setLoading(false);
        return;
      }

      // Managers and admins always have full access
      if (isManager || isAdmin) {
        setHasPermission(true);
        setLoading(false);
        return;
      }

      // Check user permission via client Supabase
      try {
        const supabase = createClient();
        
        // Fetch role with permissions
        const { data: profileData, error } = await supabase
          .from('profiles')
          .select(`
            role_id,
            role:roles!inner(
              is_manager_admin,
              role_permissions!inner(
                module_name,
                enabled
              )
            )
          `)
          .eq('id', user.id)
          .single();

        if (error) throw error;

        // Check if user has permission for this module
        const rolePerms = profileData?.role as any;
        const hasModulePermission = rolePerms?.role_permissions?.some(
          (p: any) => p.module_name === moduleName && p.enabled
        );

        setHasPermission(hasModulePermission || false);

        // Redirect if unauthorized
        if (!hasModulePermission && redirectOnFail) {
          toast.error(`You don't have access to ${moduleName.replace(/-/g, ' ')}`);
          router.push('/dashboard');
        }
      } catch (error) {
        console.error('Error checking permission:', error);
        setHasPermission(false);
        
        if (redirectOnFail) {
          toast.error('Failed to verify permissions');
          router.push('/dashboard');
        }
      } finally {
        setLoading(false);
      }
    }

    checkPermission();
  }, [user, profile, isManager, isAdmin, authLoading, moduleName, redirectOnFail, router]);

  return { hasPermission, loading };
}

