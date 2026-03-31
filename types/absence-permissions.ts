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
  'see_manage_overview_all',
  'see_manage_overview_team',
  'see_manage_reasons',
  'see_manage_work_shifts_all',
  'see_manage_work_shifts_team',
  'edit_manage_work_shifts_all',
  'edit_manage_work_shifts_team',
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
  see_manage_overview_all?: boolean | null;
  see_manage_overview_team?: boolean | null;
  see_manage_reasons?: boolean | null;
  see_manage_work_shifts_all?: boolean | null;
  see_manage_work_shifts_team?: boolean | null;
  edit_manage_work_shifts_all?: boolean | null;
  edit_manage_work_shifts_team?: boolean | null;
  authorise_bookings_all?: boolean | null;
  authorise_bookings_team?: boolean | null;
  authorise_bookings_own?: boolean | null;
}

export type AbsenceSecondaryPermissionColumnMode = 'binary' | 'tri-state';

export interface AbsenceSecondaryPermissionColumn {
  id: string;
  mode: AbsenceSecondaryPermissionColumnMode;
  scope: 'all' | 'team' | 'own' | 'toggle';
  label: 'ALL' | 'TEAM' | 'OWN' | 'ALLOW';
  key?: AbsenceSecondaryPermissionKey;
  viewKey?: AbsenceSecondaryPermissionKey;
  editKey?: AbsenceSecondaryPermissionKey;
}

export interface AbsenceSecondaryPermissionHeaderGroup {
  id:
    | 'bookings'
    | 'allowances'
    | 'records-admin'
    | 'reasons'
    | 'work-shifts'
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
  'see_manage_work_shifts_team',
  'edit_manage_work_shifts_team',
  'authorise_bookings_team',
  'authorise_bookings_own',
]);

const SUPERVISOR_TRUE_KEYS = new Set<AbsenceSecondaryPermissionKey>([
  'see_bookings_all',
  'see_bookings_team',
  'see_bookings_own',
  'add_edit_bookings_team',
  'see_manage_work_shifts_team',
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
      id: 'bookings',
      title: 'Bookings',
      subtitle: 'View/edit booking scope on /absence pages',
      columns: [
        {
          id: 'bookings-all',
          mode: 'tri-state',
          scope: 'all',
          label: 'ALL',
          viewKey: 'see_bookings_all',
          editKey: 'add_edit_bookings_all',
        },
        {
          id: 'bookings-team',
          mode: 'tri-state',
          scope: 'team',
          label: 'TEAM',
          viewKey: 'see_bookings_team',
          editKey: 'add_edit_bookings_team',
        },
        {
          id: 'bookings-own',
          mode: 'tri-state',
          scope: 'own',
          label: 'OWN',
          viewKey: 'see_bookings_own',
          editKey: 'add_edit_bookings_own',
        },
      ],
    },
    {
      id: 'allowances',
      title: 'Allowances',
      subtitle: 'View/edit allowance scope on /absence/manage?tab=allowances',
      columns: [
        {
          id: 'allowances-all',
          mode: 'tri-state',
          scope: 'all',
          label: 'ALL',
          viewKey: 'see_allowances_all',
          editKey: 'add_edit_allowances_all',
        },
        {
          id: 'allowances-team',
          mode: 'tri-state',
          scope: 'team',
          label: 'TEAM',
          viewKey: 'see_allowances_team',
          editKey: 'add_edit_allowances_team',
        },
      ],
    },
    {
      id: 'records-admin',
      title: 'See Records & Admin Tab',
      subtitle: 'Show /absence/manage?tab=overview tab',
      columns: [
        { id: 'records-admin-all', mode: 'binary', key: 'see_manage_overview_all', scope: 'all', label: 'ALL' },
        { id: 'records-admin-team', mode: 'binary', key: 'see_manage_overview_team', scope: 'team', label: 'TEAM' },
      ],
    },
    {
      id: 'reasons',
      title: 'See Reasons Tab',
      subtitle: 'Show /absence/manage?tab=reasons tab',
      columns: [{ id: 'reasons-allow', mode: 'binary', key: 'see_manage_reasons', scope: 'toggle', label: 'ALLOW' }],
    },
    {
      id: 'work-shifts',
      title: 'Work Shifts Tab',
      subtitle: 'View/edit scope on /absence/manage?tab=work-shifts',
      columns: [
        {
          id: 'work-shifts-all',
          mode: 'tri-state',
          scope: 'all',
          label: 'ALL',
          viewKey: 'see_manage_work_shifts_all',
          editKey: 'edit_manage_work_shifts_all',
        },
        {
          id: 'work-shifts-team',
          mode: 'tri-state',
          scope: 'team',
          label: 'TEAM',
          viewKey: 'see_manage_work_shifts_team',
          editKey: 'edit_manage_work_shifts_team',
        },
      ],
    },
    {
      id: 'authorise-bookings',
      title: 'Authorise Bookings',
      subtitle: 'See and edit /approvals page',
      columns: [
        { id: 'authorise-bookings-all', mode: 'binary', key: 'authorise_bookings_all', scope: 'all', label: 'ALL' },
        { id: 'authorise-bookings-team', mode: 'binary', key: 'authorise_bookings_team', scope: 'team', label: 'TEAM' },
        { id: 'authorise-bookings-own', mode: 'binary', key: 'authorise_bookings_own', scope: 'own', label: 'OWN' },
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
    'see_manage_overview_all',
    'see_manage_overview_team',
    'see_manage_reasons',
    'see_manage_work_shifts_all',
    'see_manage_work_shifts_team',
    'edit_manage_work_shifts_all',
    'edit_manage_work_shifts_team',
    'authorise_bookings_all',
    'authorise_bookings_team',
    'authorise_bookings_own',
  ],
};

