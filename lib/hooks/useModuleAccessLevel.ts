'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionSnapshot } from '@/lib/hooks/usePermissionSnapshot';
import type { ModuleName, PermissionAccessLevel } from '@/types/roles';

/**
 * Client-side module access level from /api/me/permissions snapshot.
 * Admins/superadmins are treated as Level 5 (matches server full-access behavior).
 */
export function useModuleAccessLevel(moduleName: ModuleName) {
  const { isAdmin, isSuperAdmin } = useAuth();
  const { permissionLevels, isLoading } = usePermissionSnapshot();

  const accessLevel: PermissionAccessLevel =
    isAdmin || isSuperAdmin
      ? 5
      : ((permissionLevels?.[moduleName] ?? 0) as PermissionAccessLevel);

  function canUseLevel(minimumLevel: PermissionAccessLevel): boolean {
    return accessLevel >= minimumLevel;
  }

  return {
    accessLevel,
    canUseLevel,
    isLoading,
  };
}
