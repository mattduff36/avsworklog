import { getActorAbsenceSecondaryPermissions } from '@/lib/server/absence-secondary-permissions';
import {
  canActorAuthoriseTimesheetTarget,
  canActorMarkTimesheetPayrollReceived,
  hasAccountsTimesheetFullVisibilityOverride,
} from '@/lib/utils/timesheet-visibility';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveModuleAccessLevel } from '@/lib/utils/rbac';
import { getEffectiveRole, type EffectiveRoleInfo } from '@/lib/utils/view-as';
import type { PermissionAccessLevel } from '@/types/roles';

export interface TimesheetApprovalTarget {
  profileId: string;
  teamId: string | null;
}

interface TimesheetApprovalScopeOptions {
  effectiveRole?: EffectiveRoleInfo;
  approvalsAccessLevel?: PermissionAccessLevel;
}

export async function canCurrentActorAuthoriseTimesheetTarget(
  target: TimesheetApprovalTarget,
  options: TimesheetApprovalScopeOptions = {}
): Promise<boolean> {
  const [effectiveRole, approvalsAccessLevel] = await Promise.all([
    options.effectiveRole ? Promise.resolve(options.effectiveRole) : getEffectiveRole(),
    options.approvalsAccessLevel !== undefined
      ? Promise.resolve(options.approvalsAccessLevel)
      : getEffectiveModuleAccessLevel('approvals'),
  ]);

  if (!effectiveRole.user_id || approvalsAccessLevel < 3) {
    return false;
  }

  const actorPermissions = await getActorAbsenceSecondaryPermissions(effectiveRole.user_id, {
    role: {
      name: effectiveRole.role_name,
      display_name: effectiveRole.display_name,
      role_class: effectiveRole.role_class,
      is_manager_admin: effectiveRole.is_manager_admin,
      is_super_admin: effectiveRole.is_super_admin,
    },
    role_id: effectiveRole.role_id,
    team_id: effectiveRole.team_id,
    team_name: effectiveRole.team_name,
    include_user_overrides: effectiveRole.is_viewing_as !== true,
    include_secondary_overrides: effectiveRole.is_viewing_as !== true,
  });

  return canActorAuthoriseTimesheetTarget({
    actor: {
      actorProfileId: effectiveRole.user_id,
      actorTeamId: effectiveRole.team_id,
      approvalsAccessLevel,
      // Admin tier keeps global access even if secondary exceptions strip authorise_*.
      // Self-approval remains denied inside canActorAuthoriseTimesheetTarget.
      hasAccountsOverride:
        hasEffectiveRoleFullAccess(effectiveRole) ||
        hasAccountsTimesheetFullVisibilityOverride(
          effectiveRole.role_name,
          effectiveRole.team_name
        ),
      permissions: actorPermissions.effective,
    },
    target,
  });
}

export async function canCurrentActorMarkTimesheetPayrollReceived(
  options: TimesheetApprovalScopeOptions = {}
): Promise<boolean> {
  const [effectiveRole, approvalsAccessLevel] = await Promise.all([
    options.effectiveRole ? Promise.resolve(options.effectiveRole) : getEffectiveRole(),
    options.approvalsAccessLevel !== undefined
      ? Promise.resolve(options.approvalsAccessLevel)
      : getEffectiveModuleAccessLevel('approvals'),
  ]);

  if (!effectiveRole.user_id || approvalsAccessLevel < 3) {
    return false;
  }

  return canActorMarkTimesheetPayrollReceived({
    hasFullAdminAccess: hasEffectiveRoleFullAccess(effectiveRole),
    roleName: effectiveRole.role_name,
    teamName: effectiveRole.team_name,
  });
}
