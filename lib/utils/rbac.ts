import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveRole } from '@/lib/utils/view-as';
import type { ModuleName } from '@/types/roles';

interface RoleRecord {
  id: string;
  name: string;
  role_class: 'admin' | 'manager' | 'employee';
  is_super_admin: boolean;
}

export async function canEffectiveRoleAccessModule(moduleName: ModuleName): Promise<boolean> {
  const effectiveRole = await getEffectiveRole();
  if (!effectiveRole.user_id || !effectiveRole.role_id) {
    return false;
  }

  if (effectiveRole.is_super_admin || effectiveRole.role_name === 'admin') {
    return true;
  }

  const admin = createAdminClient();
  const { data: permission } = await admin
    .from('role_permissions')
    .select('enabled')
    .eq('role_id', effectiveRole.role_id)
    .eq('module_name', moduleName)
    .maybeSingle();

  return !!permission?.enabled;
}

export async function canEffectiveRoleAssignRole(targetRoleId: string): Promise<boolean> {
  const effectiveRole = await getEffectiveRole();
  if (!effectiveRole.user_id) {
    return false;
  }

  if (effectiveRole.is_super_admin || effectiveRole.role_name === 'admin') {
    return true;
  }

  if (!effectiveRole.is_manager_admin) {
    return false;
  }

  const admin = createAdminClient();
  const { data: targetRole } = await admin
    .from('roles')
    .select('role_class, is_super_admin')
    .eq('id', targetRoleId)
    .maybeSingle();

  return targetRole?.role_class === 'employee' && targetRole?.is_super_admin !== true;
}

export async function isEffectiveRoleAdminOrSuper(): Promise<boolean> {
  const effectiveRole = await getEffectiveRole();
  if (!effectiveRole.user_id) {
    return false;
  }

  return effectiveRole.is_super_admin || effectiveRole.role_name === 'admin';
}

export async function getAssignableRolesForEffectiveActor(): Promise<RoleRecord[]> {
  const effectiveRole = await getEffectiveRole();
  if (!effectiveRole.user_id) {
    return [];
  }

  const admin = createAdminClient();
  let query = admin
    .from('roles')
    .select('id, name, role_class, is_super_admin')
    .order('is_super_admin', { ascending: false })
    .order('is_manager_admin', { ascending: false })
    .order('display_name', { ascending: true });

  if (!(effectiveRole.is_super_admin || effectiveRole.role_name === 'admin')) {
    if (effectiveRole.is_manager_admin) {
      query = query.eq('role_class', 'employee').eq('is_super_admin', false);
    } else {
      return [];
    }
  }

  const { data } = await query;
  return (data || []) as RoleRecord[];
}
