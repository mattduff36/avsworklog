'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './useAuth';
import { userHasPermission } from '../utils/permissions';
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

      // Check user permission
      try {
        const permitted = await userHasPermission(user.id, moduleName);
        setHasPermission(permitted);

        // Redirect if unauthorized
        if (!permitted && redirectOnFail) {
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

