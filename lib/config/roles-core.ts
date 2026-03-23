export const CORE_ROLE_NAMES = ['employee', 'contractor', 'supervisor', 'manager', 'admin'] as const;

const CORE_ROLE_NAME_SET = new Set<string>(CORE_ROLE_NAMES);

const RETIRED_ROLE_NAMES = new Set<string>([
  'employee-civils',
  'employee-transport',
  'employee-groundworks',
  'employee-plant',
  'employee-workshop',
  'managing-director',
  'sheq-manager',
  'company-accountant-manager',
  'heavy-plant-earthworks-contracts-manager',
  'civils-project-manager',
  'civils-contracts-manager',
  'civils-manager',
  'transport-manager',
  'workshop-manager',
  'civils-site-managers-supervisors-manager',
]);

const CORE_ROLE_PRIORITY: Record<string, number> = {
  admin: 0,
  manager: 1,
  supervisor: 2,
  employee: 3,
  contractor: 4,
};

export function isCoreRoleName(roleName: string | null | undefined): boolean {
  if (!roleName) return false;
  return CORE_ROLE_NAME_SET.has(roleName.trim().toLowerCase());
}

export function isRetiredRoleName(roleName: string | null | undefined): boolean {
  if (!roleName) return false;
  return RETIRED_ROLE_NAMES.has(roleName.trim().toLowerCase());
}

export function getRoleSortPriority(roleName: string | null | undefined): number {
  const normalized = (roleName || '').trim().toLowerCase();
  if (normalized in CORE_ROLE_PRIORITY) {
    return CORE_ROLE_PRIORITY[normalized];
  }
  return 100;
}
