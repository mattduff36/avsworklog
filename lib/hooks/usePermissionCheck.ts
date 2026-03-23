'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './useAuth';
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
  const { user, profile, isAdmin, isSuperAdmin, isViewingAs, effectiveRole, loading: authLoading } = useAuth();
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

      try {
        const response = await fetch('/api/me/permissions', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load permissions');
        }

        const hasModulePermission = Boolean(data.permissions?.[moduleName]);

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
  }, [user, profile, isAdmin, isSuperAdmin, isViewingAs, effectiveRole, authLoading, moduleName, redirectOnFail, router]);

  return { hasPermission, loading };
}

