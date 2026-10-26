import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/me/permissions/route';
import { reportAccessDeniedReason, type ReportAccessSnapshot } from '@/lib/reports/report-access';
import { ALL_MODULES, type ModuleName } from '@/types/roles';

const permissionApi = vi.hoisted(() => ({
  profile: vi.fn(),
  role: vi.fn(),
  modules: vi.fn(),
  levels: vi.fn(),
  map: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/server/app-auth/session', () => ({
  getCurrentAuthenticatedProfile: permissionApi.profile,
}));
vi.mock('@/lib/utils/view-as', () => ({ getEffectiveRole: permissionApi.role }));
vi.mock('@/lib/server/team-permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/team-permissions')>('@/lib/server/team-permissions');
  return {
    ...actual,
    getPermissionModules: permissionApi.modules,
    getPermissionLevelsForUser: permissionApi.levels,
    getPermissionMapForUser: permissionApi.map,
  };
});

const MODULES = ['reports', 'timesheets', 'absence', 'daily-allocation', 'inspections', 'plant-inspections', 'hgv-inspections'] as const satisfies readonly ModuleName[];

function ready(
  levels: Partial<Record<ModuleName, number>>,
  minima: Partial<Record<ModuleName, number>> = {},
): ReportAccessSnapshot {
  return {
    state: 'ready',
    permissionLevels: Object.fromEntries(MODULES.map((name) => [name, levels[name] ?? 0])),
    moduleMinimumAccessLevels: Object.fromEntries(MODULES.map((name) => [name, minima[name] ?? 1])),
  };
}

describe('report access snapshot', () => {
  it('uses the configured minimum and does not upgrade a viewed-as snapshot', () => {
    expect(reportAccessDeniedReason('job-labour', ready({ reports: 1, timesheets: 0 }, { timesheets: 2 }))).toBe('Requires Timesheets level 2 or higher.');
    expect(reportAccessDeniedReason('payroll-export', ready({ reports: 1, timesheets: 0 }, { timesheets: 4 }))).toBe('Requires Timesheets level 4 or higher.');
    expect(reportAccessDeniedReason('timesheet-summary', ready({ reports: 1, timesheets: 4 }, { timesheets: 4 }))).toBeNull();
    expect(reportAccessDeniedReason('job-labour', ready({ reports: 5, 'daily-allocation': 5, timesheets: 0 }, { timesheets: 2 }))).toMatch(/Timesheets level 2/);
  });

  it('fails closed while loading, after an error with stale levels, or when metadata is missing', () => {
    const granted = ready({ reports: 5, timesheets: 5, absence: 5 });
    expect(reportAccessDeniedReason('payroll-export', { ...granted, state: 'loading' })).toBe('Permissions are still loading.');
    expect(reportAccessDeniedReason('payroll-export', { ...granted, state: 'error' })).toBe('Report permissions could not be confirmed.');
    expect(reportAccessDeniedReason('payroll-export', { state: 'ready', permissionLevels: null, moduleMinimumAccessLevels: granted.moduleMinimumAccessLevels })).toBe('Report permissions could not be confirmed.');
    expect(reportAccessDeniedReason('absence-bookings', ready({ reports: 1, absence: 1 }, { absence: Number.NaN }))).toMatch(/could not be confirmed/);
  });

  it('requires positive access and fails closed on missing plant metadata', () => {
    expect(reportAccessDeniedReason('absence-bookings', ready({ reports: 1, absence: 0 }, { absence: 0 }))).toBe('Requires Absence & Leave level 1 or higher.');
    const snapshot = ready({ reports: 5, 'daily-allocation': 5 });
    delete snapshot.moduleMinimumAccessLevels!['daily-allocation'];
    expect(reportAccessDeniedReason('plant-usage', snapshot)).toMatch(/could not be confirmed/);
  });

  it('matches plant level 4 and any one daily-check module', () => {
    expect(reportAccessDeniedReason('plant-usage', ready({ reports: 1, 'daily-allocation': 3 }))).toBe('Requires Daily Allocation level 4 or higher.');
    expect(reportAccessDeniedReason('plant-usage', ready({ reports: 1, 'daily-allocation': 4 }))).toBeNull();
    expect(reportAccessDeniedReason('plant-usage', ready({ reports: 1, 'daily-allocation': 4 }, { 'daily-allocation': 5 }))).toBe('Requires Daily Allocation level 5 or higher.');
    const inspectionsOnly = ready({ reports: 1, inspections: 1, 'plant-inspections': 0, 'hgv-inspections': 0 });
    expect(reportAccessDeniedReason('daily-checks-defects', inspectionsOnly)).toBeNull();
    expect(reportAccessDeniedReason('bulk-daily-check-pdfs', ready({ reports: 1 }))).toMatch(/one of Van Daily Checks level 1 or higher/);
  });
});

describe('permissions snapshot minima', () => {
  const matrix = [
    { module_name: 'timesheets', requires_sensitive_pin: false, enforced_minimum_access_level: 2 },
    { module_name: 'reports', requires_sensitive_pin: true, enforced_minimum_access_level: 1 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    permissionApi.profile.mockResolvedValue({ profile: { id: 'user' } });
    permissionApi.modules.mockResolvedValue(matrix);
    permissionApi.map.mockResolvedValue({ reports: true, timesheets: false });
    permissionApi.levels.mockResolvedValue({ reports: 1, timesheets: 0 });
  });

  it('returns effective level 5 and the fetched minima for an admin', async () => {
    permissionApi.role.mockResolvedValue({
      role_id: 'role', role_name: 'Admin', role_class: 'admin', is_super_admin: true,
      is_actual_super_admin: true, is_viewing_as: false, team_id: 'team', team_name: 'Team',
    });
    const body = await (await GET()).json();
    expect(permissionApi.modules).toHaveBeenCalledOnce();
    expect(permissionApi.levels).not.toHaveBeenCalled();
    expect(ALL_MODULES.every((moduleName) => body.permission_levels[moduleName] === 5)).toBe(true);
    expect(body.module_minimum_access_levels).toEqual({ timesheets: 2, reports: 1 });
    expect(body.sensitive_pin_modules).toEqual(['reports']);
  });

  it('keeps viewed-as effective levels and does not grant a missing schema', async () => {
    permissionApi.role.mockResolvedValue({
      role_id: 'role', role_name: 'Employee', role_class: 'employee', is_super_admin: false,
      is_actual_super_admin: true, is_viewing_as: true, team_id: 'team', team_name: 'Team',
    });
    const viewed = await (await GET()).json();
    expect(permissionApi.levels).toHaveBeenCalledWith('user', 'role', expect.anything(), 'team', { includeUserOverrides: false });
    expect(viewed.permission_levels.timesheets).toBe(0);
    expect(viewed.module_minimum_access_levels.timesheets).toBe(2);
    expect(ALL_MODULES.some((moduleName) => viewed.permission_levels[moduleName] === 5)).toBe(false);

    permissionApi.role.mockRejectedValue(Object.assign(new Error('relation permission_modules does not exist'), { code: '42P01' }));
    const missing = await (await GET()).json();
    expect(Object.values(missing.permissions).every((granted) => granted === false)).toBe(true);
    expect(Object.values(missing.permission_levels).every((level) => level === 0)).toBe(true);
    expect(missing.module_minimum_access_levels).toEqual({});
    expect(missing.enabled_modules).toEqual([]);
  });
});
