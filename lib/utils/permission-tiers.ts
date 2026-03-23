import type { RoleClass } from '@/types/roles';

export const CORE_PERMISSION_TIER_RANKS = {
  contractor: 1,
  employee: 2,
  supervisor: 3,
  manager: 4,
  admin: 999,
} as const;

export function defaultHierarchyRankForRole(
  roleClass: RoleClass,
  roleName?: string | null
): number | null {
  const normalizedName = (roleName || '').trim().toLowerCase();

  if (normalizedName === 'admin' || roleClass === 'admin') {
    return CORE_PERMISSION_TIER_RANKS.admin;
  }
  if (normalizedName === 'manager' || roleClass === 'manager') {
    return CORE_PERMISSION_TIER_RANKS.manager;
  }
  if (normalizedName === 'supervisor') {
    return CORE_PERMISSION_TIER_RANKS.supervisor;
  }
  if (normalizedName === 'contractor') {
    return CORE_PERMISSION_TIER_RANKS.contractor;
  }
  if (roleClass === 'employee') {
    return CORE_PERMISSION_TIER_RANKS.employee;
  }

  return null;
}

export function normalizeHierarchyRankInput(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const integer = Math.trunc(parsed);
  return integer > 0 ? integer : null;
}

export function isMatrixTierRole(input: {
  name?: string | null;
  hierarchy_rank?: number | null;
  is_super_admin?: boolean | null;
}): boolean {
  return Boolean(
    input.name &&
      input.name !== 'admin' &&
      input.is_super_admin !== true &&
      typeof input.hierarchy_rank === 'number'
  );
}
