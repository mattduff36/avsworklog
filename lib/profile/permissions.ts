interface ProfileRoleShape {
  role?: {
    name?: string | null;
    role_class?: 'admin' | 'manager' | 'employee' | null;
    is_manager_admin?: boolean | null;
    is_super_admin?: boolean | null;
  } | null;
  super_admin?: boolean | null;
}

export function canEditOwnBasicProfileFields(profile: ProfileRoleShape | null | undefined): boolean {
  if (!profile) return false;

  if (profile.super_admin) return true;
  if (profile.role?.is_super_admin) return true;
  if (profile.role?.name === 'admin') return true;
  if (profile.role?.role_class === 'admin') return true;
  if (profile.role?.is_manager_admin) return true;
  if (profile.role?.role_class === 'manager') return true;

  return false;
}

