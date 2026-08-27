import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNullAbsenceSecondaryOverrideRecord,
  getAbsenceSecondaryDefaultMap,
} from '@/types/absence-permissions';

vi.mock('@/lib/server/absence-secondary-permissions', () => ({
  getActorAbsenceSecondaryPermissions: vi.fn(),
}));
vi.mock('@/lib/utils/rbac', () => ({
  getEffectiveModuleAccessLevel: vi.fn(),
}));
vi.mock('@/lib/utils/view-as', () => ({
  getEffectiveRole: vi.fn(),
}));

import { getActorAbsenceSecondaryPermissions } from '@/lib/server/absence-secondary-permissions';
import {
  canCurrentActorAuthoriseTimesheetTarget,
  canCurrentActorMarkTimesheetPayrollReceived,
} from '@/lib/server/timesheet-approval-scope';
import { getEffectiveModuleAccessLevel } from '@/lib/utils/rbac';
import { getEffectiveRole, type EffectiveRoleInfo } from '@/lib/utils/view-as';

const supervisorRole: EffectiveRoleInfo = {
  role_id: 'supervisor-role',
  role_name: 'supervisor',
  display_name: 'Supervisor',
  role_class: 'employee',
  is_manager_admin: false,
  is_super_admin: false,
  is_viewing_as: true,
  is_actual_super_admin: true,
  user_id: 'actual-admin',
  team_id: 'team-a',
  team_name: 'Operations',
};

describe('canCurrentActorAuthoriseTimesheetTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEffectiveRole).mockResolvedValue(supervisorRole);
    vi.mocked(getEffectiveModuleAccessLevel).mockResolvedValue(3);
    vi.mocked(getActorAbsenceSecondaryPermissions).mockResolvedValue({
      user_id: supervisorRole.user_id!,
      team_id: supervisorRole.team_id,
      team_name: supervisorRole.team_name,
      role_name: supervisorRole.role_name,
      role_display_name: supervisorRole.display_name,
      role_tier: 'supervisor',
      defaults: getAbsenceSecondaryDefaultMap('supervisor'),
      effective: getAbsenceSecondaryDefaultMap('supervisor'),
      overrides: createNullAbsenceSecondaryOverrideRecord(),
      has_exception_row: false,
    });
  });

  it('VIEW-AS-001 evaluates effective role/team without actual-user overrides', async () => {
    await expect(
      canCurrentActorAuthoriseTimesheetTarget({
        profileId: 'employee-1',
        teamId: 'team-a',
      })
    ).resolves.toBe(true);

    expect(getActorAbsenceSecondaryPermissions).toHaveBeenCalledWith(
      'actual-admin',
      expect.objectContaining({
        role_id: 'supervisor-role',
        team_id: 'team-a',
        include_user_overrides: false,
        include_secondary_overrides: false,
      })
    );
  });

  it('APPROVAL-SCOPE-001 denies a viewed-as Supervisor outside the effective team', async () => {
    await expect(
      canCurrentActorAuthoriseTimesheetTarget({
        profileId: 'employee-2',
        teamId: 'team-b',
      })
    ).resolves.toBe(false);
  });

  it('APPROVAL-SCOPE-002 fails closed below Approvals Level 3', async () => {
    vi.mocked(getEffectiveModuleAccessLevel).mockResolvedValue(2);

    await expect(
      canCurrentActorAuthoriseTimesheetTarget({
        profileId: 'employee-1',
        teamId: 'team-a',
      })
    ).resolves.toBe(false);
    expect(getActorAbsenceSecondaryPermissions).not.toHaveBeenCalled();
  });

  it('APPROVAL-ADMIN-GLOBAL-001 keeps admin global access when secondary authorise flags are stripped', async () => {
    const adminRole: EffectiveRoleInfo = {
      ...supervisorRole,
      role_id: 'admin-role',
      role_name: 'admin',
      display_name: 'Admin',
      role_class: 'admin',
      is_manager_admin: true,
      is_super_admin: true,
      is_viewing_as: false,
      is_actual_super_admin: true,
      team_id: 'team-a',
      team_name: 'Operations',
    };
    vi.mocked(getEffectiveRole).mockResolvedValue(adminRole);
    vi.mocked(getActorAbsenceSecondaryPermissions).mockResolvedValue({
      user_id: adminRole.user_id!,
      team_id: adminRole.team_id,
      team_name: adminRole.team_name,
      role_name: adminRole.role_name,
      role_display_name: adminRole.display_name,
      role_tier: 'admin',
      defaults: getAbsenceSecondaryDefaultMap('admin'),
      effective: {
        ...getAbsenceSecondaryDefaultMap('admin'),
        authorise_bookings_all: false,
        authorise_bookings_team: false,
        authorise_bookings_own: false,
      },
      overrides: createNullAbsenceSecondaryOverrideRecord(),
      has_exception_row: true,
    });

    await expect(
      canCurrentActorAuthoriseTimesheetTarget({
        profileId: 'employee-2',
        teamId: 'team-b',
      })
    ).resolves.toBe(true);

    await expect(
      canCurrentActorAuthoriseTimesheetTarget({
        profileId: adminRole.user_id!,
        teamId: adminRole.team_id,
      })
    ).resolves.toBe(false);
  });

  it('PAY-APPROVE-PAYROLL-ACTOR-001 and PAY-APPROVE-MANAGER-DENIED-001 gate Payroll Received by effective role', async () => {
    await expect(canCurrentActorMarkTimesheetPayrollReceived()).resolves.toBe(false);

    vi.mocked(getEffectiveRole).mockResolvedValue({
      ...supervisorRole,
      role_name: 'manager',
      team_name: 'Accounts',
      is_viewing_as: false,
      is_actual_super_admin: false,
    });
    await expect(canCurrentActorMarkTimesheetPayrollReceived()).resolves.toBe(true);

    vi.mocked(getEffectiveModuleAccessLevel).mockResolvedValue(2);
    await expect(canCurrentActorMarkTimesheetPayrollReceived()).resolves.toBe(false);
  });
});
