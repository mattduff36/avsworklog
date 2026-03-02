// @ts-nocheck
import { createClient } from '@/lib/supabase/server';
import type { ModuleName, UserPermissions } from '@/types/roles';

export type ProfileWithRole = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
  employee_id: string | null;
  role_id: string | null;
  must_change_password: boolean | null;
  is_super_admin: boolean | null;
  created_at: string;
  updated_at: string;
  role: {
    name: string;
    display_name: string;
    is_manager_admin: boolean;
    is_super_admin: boolean;
  } | null;
};

/**
 * Fetch a profile with role information included
 * Use this in API routes instead of direct profile fetch
 */
export async function getProfileWithRole(userId: string): Promise<ProfileWithRole | null> {
  const supabase = await createClient();

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
      console.error('Error fetching profile with role:', error);
      console.error('User ID:', userId);
      return null;
    }

    const typedData = data as ProfileWithRole | null;
    const role = typedData?.role;
    console.log('getProfileWithRole result:', {
      user_id: userId,
      profile_id: typedData?.id,
      role_id: typedData?.role_id,
      role_name: role?.name,
      role_display_name: role?.display_name,
      is_manager_admin: role?.is_manager_admin
    });

    return typedData;
  } catch (error) {
    console.error('Error fetching profile with role:', error);
    return null;
  }
}

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
    const typedProfile = profile as { role_id: string | null; roles: { is_manager_admin: boolean } | null } | null;

    if (typedProfile?.roles?.is_manager_admin) {
      return true;
    }

    // Check specific permission
    const { data: permission } = await supabase
      .from('role_permissions')
      .select('enabled')
      .eq('role_id', (typedProfile?.role_id ?? '') as never)
      .eq('module_name', module)
      .single();
    const typedPermission = permission as { enabled: boolean } | null;

    return typedPermission?.enabled ?? false;
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
    const typedProfile = profile as {
      roles: { is_manager_admin: boolean } | null;
      role_permissions: Array<{ module_name: ModuleName; enabled: boolean }> | null;
    } | null;

    // If manager/admin, return all permissions as enabled
    if (typedProfile?.roles?.is_manager_admin) {
      return {
        'timesheets': true,
        'inspections': true,
        'plant-inspections': true,
        'hgv-inspections': true,
        'rams': true,
        'absence': true,
        'maintenance': true,
        'toolbox-talks': true,
        'workshop-tasks': true,
        'approvals': true,
        'actions': true,
        'reports': true,
        'admin-users': true,
        'admin-vans': true,
      };
    }

    // Build permissions object from role_permissions
    const permissions: UserPermissions = {};
    typedProfile?.role_permissions?.forEach((perm) => {
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
    const typedProfile = profile as { roles: { is_manager_admin: boolean } | null } | null;

    return typedProfile?.roles?.is_manager_admin ?? false;
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
    const typedProfile = profile as { super_admin: boolean | null } | null;

    return typedProfile?.super_admin ?? false;
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
    const typedProfiles = profiles as Array<{ id: string }> | null;

    return typedProfiles?.map((p) => p.id) ?? [];
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
    const typedProfile = profile as { full_name: string | null; roles: { display_name: string | null } | null } | null;

    return {
      valid: false,
      error: `${typedProfile?.full_name || 'This user'} (${typedProfile?.roles?.display_name}) does not have access to ${module}. Please update their role permissions or choose a different user.`,
    };
  }

  return { valid: true };
}

