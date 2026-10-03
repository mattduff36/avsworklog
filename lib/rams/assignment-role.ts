export const RAMS_ASSIGNMENT_EMPLOYEE_EMBED =
  'employee:profiles!rams_assignments_employee_id_fkey(id, full_name, role:roles!profiles_role_id_fkey(display_name, name))';

export interface RamsJobRole {
  display_name?: string | null;
  name?: string | null;
}

export function assignmentRoleLabel(
  role: RamsJobRole | RamsJobRole[] | null | undefined,
): string {
  const record = Array.isArray(role) ? role[0] : role;
  const displayName = record?.display_name?.trim();
  if (displayName) {
    return displayName;
  }

  return record?.name?.trim() ?? '';
}
