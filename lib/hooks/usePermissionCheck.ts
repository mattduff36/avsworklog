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
  const { user, profile, isManager, isAdmin, isViewingAs, effectiveRole, loading: authLoading } = useAuth();
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
        let hasModulePermission = false;

        // When viewing as another role, fetch permissions from the EFFECTIVE role
        // (not the actual profile's role which is still admin/superadmin).
        // If viewAsRoleId is empty (stale cookie), deny to avoid privilege escalation.
        const viewAsRoleId =
          isViewingAs && effectiveRole
            ? (await import('@/lib/utils/view-as-cookie')).getViewAsRoleId()
            : '';

        if (viewAsRoleId) {
          const { data: perms, error } = await supabase
            .from('role_permissions')
            .select('module_name, enabled')
            .eq('role_id', viewAsRoleId)
            .eq('module_name', moduleName)
            .eq('enabled', true)
            .maybeSingle();

          if (error) throw error;
          hasModulePermission = !!perms;
        } else if (!(isViewingAs && effectiveRole)) {
          // Normal flow: fetch from profile → role → permissions
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
          hasModulePermission = rolePerms?.role_permissions?.some(
            (p: any) => p.module_name === moduleName && p.enabled
          ) || false;
        }

        setHasPermission(hasModulePermission);

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
  }, [user, profile, isManager, isAdmin, isViewingAs, effectiveRole, authLoading, moduleName, redirectOnFail, router]);

  return { hasPermission, loading };
}

