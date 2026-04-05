interface AdminRoleLike {
  name?: string | null;
  role_class?: 'admin' | 'manager' | 'employee' | null;
  is_super_admin?: boolean | null;
}

interface EffectiveAdminRoleLike {
  role_name?: string | null;
  role_class?: 'admin' | 'manager' | 'employee' | null;
  is_super_admin?: boolean | null;
  is_actual_super_admin?: boolean | null;
}

function normalizeRoleName(name: string | null | undefined): string {
  return (name || '').trim().toLowerCase();
}

export function isAdminRole(role: Pick<AdminRoleLike, 'name' | 'role_class'> | null | undefined): boolean {
  if (!role) {
    return false;
  }

  return role.role_class === 'admin' || normalizeRoleName(role.name) === 'admin';
}

export function hasRoleFullAccess(
  role: Pick<AdminRoleLike, 'name' | 'role_class' | 'is_super_admin'> | null | undefined
): boolean {
  if (!role) {
    return false;
  }

  return Boolean(role.is_super_admin) || isAdminRole(role);
}

export function hasEffectiveRoleFullAccess(
  role: Pick<
    EffectiveAdminRoleLike,
    'role_name' | 'role_class' | 'is_super_admin' | 'is_actual_super_admin'
  > | null | undefined
): boolean {
  if (!role) {
    return false;
  }

  return (
    Boolean(role.is_actual_super_admin) ||
    Boolean(role.is_super_admin) ||
    role.role_class === 'admin' ||
    normalizeRoleName(role.role_name) === 'admin'
  );
}
