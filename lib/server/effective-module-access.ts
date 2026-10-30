import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getPermissionLevelsForUser } from '@/lib/server/team-permissions';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import type { EffectiveRoleInfo } from '@/lib/utils/view-as';
import type { ModuleName, PermissionAccessLevel } from '@/types/roles';

/**
 * Numeric module level for an already validated effective role.
 * Callers must pass the result of getEffectiveRole / getEffectiveRoleForUser.
 * This does not read cookies, sessions, or request JSON, and it does not cache.
 */
export async function getModuleAccessLevelForEffectiveRole(
  effectiveRole: Readonly<EffectiveRoleInfo>,
  moduleName: ModuleName
): Promise<PermissionAccessLevel> {
  if (!effectiveRole.user_id || !effectiveRole.role_id) {
    return 0;
  }

  if (hasEffectiveRoleFullAccess(effectiveRole)) {
    return 5;
  }

  const permissionLevels = await getPermissionLevelsForUser(
    effectiveRole.user_id,
    effectiveRole.role_id,
    createAdminClient(),
    effectiveRole.team_id,
    { includeUserOverrides: effectiveRole.is_viewing_as !== true }
  );

  return permissionLevels[moduleName] || 0;
}
