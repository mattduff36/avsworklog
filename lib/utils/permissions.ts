import { createClient } from '@/lib/supabase/server';
import type { ModuleName, UserPermissions } from '@/types/roles';

/**
 * Check if a user has permission to access a specific module
 */
export async function userHasPermission(
  userId: string,
  module: ModuleName
): Promise<boolean> {
  const supabase = await createClient();

  try {
    // Check if user is manager/admin (they always have access)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role_id, roles!inner(is_manager_admin)')
      .eq('id', userId)
      .single();

    if (profile?.roles?.is_manager_admin) {
      return true;
    }

    // Check specific permission
    const { data: permission } = await supabase
      .from('role_permissions')
      .select('enabled')
      .eq('role_id', profile?.role_id)
      .eq('module_name', module)
      .single();

    return permission?.enabled ?? false;
  } catch (error) {
    console.error('Error checking permission:', error);
    return false;
  }
}

/**
 * Get all permissions for a user
 */
export async function getUserPermissions(
  userId: string
): Promise<UserPermissions> {
  const supabase = await createClient();

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select(`
        role_id,
        roles!inner(
          is_manager_admin
        ),
        role_permissions(
          module_name,
          enabled
        )
      `)
      .eq('id', userId)
      .single();

    // If manager/admin, return all permissions as enabled
    if (profile?.roles?.is_manager_admin) {
      return {
        'timesheets': true,
        'inspections': true,
        'rams': true,
        'absence': true,
        'toolbox-talks': true,
        'approvals': true,
        'actions': true,
        'reports': true,
        'admin-users': true,
        'admin-vehicles': true,
      };
    }

    // Build permissions object from role_permissions
    const permissions: UserPermissions = {};
    profile?.role_permissions?.forEach((perm: any) => {
      permissions[perm.module_name] = perm.enabled;
    });

    return permissions;
  } catch (error) {
    console.error('Error getting user permissions:', error);
    return {};
  }
}

/**
 * Check if a user is a manager or admin
 */
export async function isManagerOrAdmin(userId: string): Promise<boolean> {
  const supabase = await createClient();

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role_id, roles!inner(is_manager_admin)')
      .eq('id', userId)
      .single();

    return profile?.roles?.is_manager_admin ?? false;
  } catch (error) {
    console.error('Error checking manager/admin status:', error);
    return false;
  }
}

/**
 * Check if a user is a super admin
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const supabase = await createClient();

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('super_admin')
      .eq('id', userId)
      .single();

    return profile?.super_admin ?? false;
  } catch (error) {
    console.error('Error checking super admin status:', error);
    return false;
  }
}

/**
 * Get users with permission for a specific module
 * Used for filtering dropdowns in assignment flows
 */
export async function getUsersWithPermission(
  module: ModuleName
): Promise<string[]> {
  const supabase = await createClient();

  try {
    // Get all users who either:
    // 1. Have manager/admin role (auto-access), OR
    // 2. Have specific permission enabled for this module
    const { data: profiles } = await supabase
      .from('profiles')
      .select(`
        id,
        role_id,
        roles!inner(
          is_manager_admin,
          role_permissions!inner(
            module_name,
            enabled
          )
        )
      `)
      .or(`roles.is_manager_admin.eq.true,and(roles.role_permissions.module_name.eq.${module},roles.role_permissions.enabled.eq.true)`);

    return profiles?.map((p: any) => p.id) ?? [];
  } catch (error) {
    console.error('Error getting users with permission:', error);
    return [];
  }
}

/**
 * Validate that a user can be assigned to a task requiring a specific module
 */
export async function validateUserAssignment(
  userId: string,
  module: ModuleName
): Promise<{ valid: boolean; error?: string }> {
  const hasPermission = await userHasPermission(userId, module);

  if (!hasPermission) {
    const supabase = await createClient();
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, roles!inner(display_name)')
      .eq('id', userId)
      .single();

    return {
      valid: false,
      error: `${profile?.full_name || 'This user'} (${profile?.roles?.display_name}) does not have access to ${module}. Please update their role permissions or choose a different user.`,
    };
  }

  return { valid: true };
}

