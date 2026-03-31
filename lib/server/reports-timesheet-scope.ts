import { getActorAbsenceSecondaryPermissions } from '@/lib/server/absence-secondary-permissions';
import { getReportScopeContext, getScopedProfileIdsForModule } from '@/lib/server/report-scope';
import { canShowTimesheetInList, hasAccountsTimesheetFullVisibilityOverride } from '@/lib/utils/timesheet-visibility';

interface TimesheetScopeRow {
  user_id: string;
  employee?: {
    team_id?: string | null;
  } | null;
}

export async function filterTimesheetRowsForReportScope<T extends TimesheetScopeRow>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) {
    return rows;
  }

  const scopeContext = await getReportScopeContext();
  const actorUserId = scopeContext.effectiveRole.user_id;
  if (!actorUserId) {
    return [];
  }

  const hasAccountsOverride = hasAccountsTimesheetFullVisibilityOverride(
    scopeContext.effectiveRole.role_name,
    scopeContext.effectiveRole.team_name
  );

  const isAdminTier = scopeContext.isAdminTier || hasAccountsOverride;
  const isElevatedUser = scopeContext.isManagerLike || isAdminTier || hasAccountsOverride;
  if (isAdminTier) {
    return rows;
  }

  const moduleScopedProfileIds = await getScopedProfileIdsForModule('timesheets', scopeContext);
  let candidateRows = rows;
  if (moduleScopedProfileIds) {
    candidateRows = candidateRows.filter((row) => moduleScopedProfileIds.has(row.user_id));
  }

  const actorPermissions = await getActorAbsenceSecondaryPermissions(actorUserId, {
    role: {
      name: scopeContext.effectiveRole.role_name,
      display_name: scopeContext.effectiveRole.display_name,
      role_class: scopeContext.effectiveRole.role_class,
      is_manager_admin: scopeContext.effectiveRole.is_manager_admin,
      is_super_admin: scopeContext.effectiveRole.is_super_admin,
    },
    team_id: scopeContext.effectiveRole.team_id,
    team_name: scopeContext.effectiveRole.team_name,
  });

  const canAuthoriseBookings = Boolean(
    actorPermissions.effective.authorise_bookings_all ||
      actorPermissions.effective.authorise_bookings_team ||
      actorPermissions.effective.authorise_bookings_own
  );

  const scopeTeamOnly = Boolean(
    isElevatedUser &&
      !isAdminTier &&
      canAuthoriseBookings &&
      !actorPermissions.effective.authorise_bookings_all &&
      actorPermissions.effective.authorise_bookings_team
  );

  const effectiveTeamFilter = scopeTeamOnly ? actorPermissions.team_id || '__no_team_scope__' : 'all';

  return candidateRows.filter((row) =>
    canShowTimesheetInList({
      actor: {
        isElevatedUser,
        isAdminTier,
        actorProfileId: actorUserId,
        actorTeamId: actorPermissions.team_id,
        canAuthoriseBookings,
        permissions: actorPermissions.effective,
      },
      target: {
        profileId: row.user_id,
        teamId: row.employee?.team_id || null,
      },
      effectiveTeamFilter,
    })
  );
}
