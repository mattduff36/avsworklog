'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './useAuth';
import { usePermissionSnapshot } from './usePermissionSnapshot';
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
  const { user, profile, isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const { permissions, enabledModuleSet, isLoading: permissionsLoading, error } = usePermissionSnapshot();
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

      // Admin and superadmin keep full access by definition.
      if (isAdmin || isSuperAdmin) {
        setHasPermission(true);
        setLoading(false);
        return;
      }

      if (permissionsLoading) {
        return;
      }

      if (error) {
        console.error('Error checking permission:', error);
        setHasPermission(false);
        
        if (redirectOnFail) {
          toast.error('Failed to verify permissions');
          router.push('/dashboard');
        }
        setLoading(false);
        return;
      }

      const hasModulePermission = Boolean(permissions?.[moduleName] || enabledModuleSet.has(moduleName));

      setHasPermission(hasModulePermission);

      if (!hasModulePermission && redirectOnFail) {
        toast.error(`You don't have access to ${moduleName.replace(/-/g, ' ')}`);
        router.push('/dashboard');
      }

      setLoading(false);
    }

    checkPermission();
  }, [user, profile, isAdmin, isSuperAdmin, authLoading, permissionsLoading, permissions, enabledModuleSet, error, moduleName, redirectOnFail, router]);

  return { hasPermission, loading };
}

