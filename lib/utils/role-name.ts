import type { RoleClass } from '@/types/roles';

export function normalizeRoleInternalName(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'role';
}

export function roleClassFromLegacyRoleType(
  roleType?: RoleClass,
  legacyManagerFlag?: boolean,
  nameHint?: string
): RoleClass {
  if (roleType) return roleType;
  if (nameHint?.trim().toLowerCase() === 'admin') return 'admin';
  if (legacyManagerFlag) return 'manager';
  return 'employee';
}

export function managerFlagFromRoleClass(roleClass: RoleClass): boolean {
  return roleClass === 'admin' || roleClass === 'manager';
}
