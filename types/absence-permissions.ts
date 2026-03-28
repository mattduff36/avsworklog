export type AbsenceSecondaryRoleTier = 'admin' | 'manager' | 'supervisor' | 'employee';

export const ABSENCE_SECONDARY_PERMISSION_KEYS = [
  'see_bookings_all',
  'see_bookings_team',
  'see_bookings_own',
  'add_edit_bookings_all',
  'add_edit_bookings_team',
  'add_edit_bookings_own',
  'see_allowances_all',
  'see_allowances_team',
  'add_edit_allowances_all',
  'add_edit_allowances_team',
  'see_manage_overview',
  'see_manage_reasons',
  'see_manage_work_shifts',
  'edit_manage_work_shifts',
  'authorise_bookings_all',
  'authorise_bookings_team',
  'authorise_bookings_own',
] as const;

export type AbsenceSecondaryPermissionKey = (typeof ABSENCE_SECONDARY_PERMISSION_KEYS)[number];

export type AbsenceSecondaryPermissionMap = Record<AbsenceSecondaryPermissionKey, boolean>;

export interface AbsenceSecondaryPermissionExceptionRecord {
  see_bookings_all?: boolean | null;
  see_bookings_team?: boolean | null;
  see_bookings_own?: boolean | null;
  add_edit_bookings_all?: boolean | null;
  add_edit_bookings_team?: boolean | null;
  add_edit_bookings_own?: boolean | null;
  see_allowances_all?: boolean | null;
  see_allowances_team?: boolean | null;
  add_edit_allowances_all?: boolean | null;
  add_edit_allowances_team?: boolean | null;
  see_manage_overview?: boolean | null;
  see_manage_reasons?: boolean | null;
  see_manage_work_shifts?: boolean | null;
  edit_manage_work_shifts?: boolean | null;
  authorise_bookings_all?: boolean | null;
  authorise_bookings_team?: boolean | null;
  authorise_bookings_own?: boolean | null;
}

export interface AbsenceSecondaryPermissionColumn {
  key: AbsenceSecondaryPermissionKey;
  scope: 'all' | 'team' | 'own' | 'toggle';
  label: 'ALL' | 'TEAM' | 'OWN' | 'ALLOW';
}

export interface AbsenceSecondaryPermissionHeaderGroup {
  id:
    | 'see-bookings'
    | 'add-edit-bookings'
    | 'see-allowances'
    | 'add-edit-allowances'
    | 'see-manage-overview'
    | 'see-manage-reasons'
    | 'see-manage-work-shifts'
    | 'edit-manage-work-shifts'
    | 'authorise-bookings';
  title: string;
  subtitle: string;
  columns: AbsenceSecondaryPermissionColumn[];
}

export interface AbsenceSecondaryPermissionHeaderConfig {
  groups: AbsenceSecondaryPermissionHeaderGroup[];
  orderedKeys: AbsenceSecondaryPermissionKey[];
}

export interface AbsenceSecondaryExceptionUserRow {
  profile_id: string;
  full_name: string;
  employee_id: string | null;
  role_name: string | null;
  role_display_name: string | null;
  role_tier: AbsenceSecondaryRoleTier;
  team_id: string | null;
  team_name: string | null;
  has_exception_row: boolean;
  defaults: AbsenceSecondaryPermissionMap;
  effective: AbsenceSecondaryPermissionMap;
  overrides: Record<AbsenceSecondaryPermissionKey, boolean | null>;
}

export interface AbsenceSecondaryExceptionMatrixResponse {
  headers: AbsenceSecondaryPermissionHeaderConfig;
  rows: AbsenceSecondaryExceptionUserRow[];
}

export function createEmptyAbsenceSecondaryPermissionMap(): AbsenceSecondaryPermissionMap {
  return ABSENCE_SECONDARY_PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {} as AbsenceSecondaryPermissionMap);
}

export function createNullAbsenceSecondaryOverrideRecord(): Record<AbsenceSecondaryPermissionKey, boolean | null> {
  return ABSENCE_SECONDARY_PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = null;
    return acc;
  }, {} as Record<AbsenceSecondaryPermissionKey, boolean | null>);
}

const MANAGER_TRUE_KEYS = new Set<AbsenceSecondaryPermissionKey>([
  'see_bookings_all',
  'see_bookings_team',
  'see_bookings_own',
  'add_edit_bookings_team',
  'add_edit_bookings_own',
  'see_allowances_team',
  'see_manage_work_shifts',
  'edit_manage_work_shifts',
  'authorise_bookings_team',
  'authorise_bookings_own',
]);

const SUPERVISOR_TRUE_KEYS = new Set<AbsenceSecondaryPermissionKey>([
  'see_bookings_all',
  'see_bookings_team',
  'see_bookings_own',
  'add_edit_bookings_team',
  'see_manage_work_shifts',
  'authorise_bookings_team',
]);

const EMPLOYEE_TRUE_KEYS = new Set<AbsenceSecondaryPermissionKey>([
  'see_bookings_own',
  'add_edit_bookings_own',
]);

export function getAbsenceSecondaryDefaultMap(roleTier: AbsenceSecondaryRoleTier): AbsenceSecondaryPermissionMap {
  const base = createEmptyAbsenceSecondaryPermissionMap();

  if (roleTier === 'admin') {
    ABSENCE_SECONDARY_PERMISSION_KEYS.forEach((key) => {
      base[key] = true;
    });
    return base;
  }

  const enabled =
    roleTier === 'manager'
      ? MANAGER_TRUE_KEYS
      : roleTier === 'supervisor'
      ? SUPERVISOR_TRUE_KEYS
      : EMPLOYEE_TRUE_KEYS;

  enabled.forEach((key) => {
    base[key] = true;
  });

  return base;
}

export function applyAbsenceSecondaryOverrides(
  defaults: AbsenceSecondaryPermissionMap,
  overrides: Partial<Record<AbsenceSecondaryPermissionKey, boolean | null | undefined>>
): AbsenceSecondaryPermissionMap {
  const next: AbsenceSecondaryPermissionMap = { ...defaults };
  ABSENCE_SECONDARY_PERMISSION_KEYS.forEach((key) => {
    const overrideValue = overrides[key];
    if (typeof overrideValue === 'boolean') {
      next[key] = overrideValue;
    }
  });
  return next;
}

export const ABSENCE_SECONDARY_PERMISSION_HEADERS: AbsenceSecondaryPermissionHeaderConfig = {
  groups: [
    {
      id: 'see-bookings',
      title: 'See Bookings',
      subtitle: 'See and use /absence page',
      columns: [
        { key: 'see_bookings_all', scope: 'all', label: 'ALL' },
        { key: 'see_bookings_team', scope: 'team', label: 'TEAM' },
        { key: 'see_bookings_own', scope: 'own', label: 'OWN' },
      ],
    },
    {
      id: 'add-edit-bookings',
      title: 'Add/Edit Bookings',
      subtitle: 'See and edit /absence/manage?tab=calendar tab',
      columns: [
        { key: 'add_edit_bookings_all', scope: 'all', label: 'ALL' },
        { key: 'add_edit_bookings_team', scope: 'team', label: 'TEAM' },
        { key: 'add_edit_bookings_own', scope: 'own', label: 'OWN' },
      ],
    },
    {
      id: 'see-allowances',
      title: 'See Allowances',
      subtitle: 'See and use /absence/manage?tab=allowances tab',
      columns: [
        { key: 'see_allowances_all', scope: 'all', label: 'ALL' },
        { key: 'see_allowances_team', scope: 'team', label: 'TEAM' },
      ],
    },
    {
      id: 'add-edit-allowances',
      title: 'Add/Edit Allowances',
      subtitle: 'See and edit details on /absence/manage?tab=allowances tab',
      columns: [
        { key: 'add_edit_allowances_all', scope: 'all', label: 'ALL' },
        { key: 'add_edit_allowances_team', scope: 'team', label: 'TEAM' },
      ],
    },
    {
      id: 'see-manage-overview',
      title: 'See Records & Admin Tab',
      subtitle: 'Show /absence/manage?tab=overview tab',
      columns: [{ key: 'see_manage_overview', scope: 'toggle', label: 'ALLOW' }],
    },
    {
      id: 'see-manage-reasons',
      title: 'See Reasons Tab',
      subtitle: 'Show /absence/manage?tab=reasons tab',
      columns: [{ key: 'see_manage_reasons', scope: 'toggle', label: 'ALLOW' }],
    },
    {
      id: 'see-manage-work-shifts',
      title: 'See Work Shifts Tab',
      subtitle: 'Show /absence/manage?tab=work-shifts tab',
      columns: [{ key: 'see_manage_work_shifts', scope: 'toggle', label: 'ALLOW' }],
    },
    {
      id: 'edit-manage-work-shifts',
      title: 'Edit Work Shifts Tab',
      subtitle: 'Allow updates on /absence/manage?tab=work-shifts tab',
      columns: [{ key: 'edit_manage_work_shifts', scope: 'toggle', label: 'ALLOW' }],
    },
    {
      id: 'authorise-bookings',
      title: 'Authorise Bookings',
      subtitle: 'See and edit /approvals page',
      columns: [
        { key: 'authorise_bookings_all', scope: 'all', label: 'ALL' },
        { key: 'authorise_bookings_team', scope: 'team', label: 'TEAM' },
        { key: 'authorise_bookings_own', scope: 'own', label: 'OWN' },
      ],
    },
  ],
  orderedKeys: [
    'see_bookings_all',
    'see_bookings_team',
    'see_bookings_own',
    'add_edit_bookings_all',
    'add_edit_bookings_team',
    'add_edit_bookings_own',
    'see_allowances_all',
    'see_allowances_team',
    'add_edit_allowances_all',
    'add_edit_allowances_team',
    'see_manage_overview',
    'see_manage_reasons',
    'see_manage_work_shifts',
    'edit_manage_work_shifts',
    'authorise_bookings_all',
    'authorise_bookings_team',
    'authorise_bookings_own',
  ],
};

