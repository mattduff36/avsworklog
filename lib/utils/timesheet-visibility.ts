import type { AbsenceSecondaryPermissionMap } from '@/types/absence-permissions';

interface TimesheetTargetScope {
  profileId: string;
  teamId: string | null;
}

export interface TimesheetApprovalActorScope {
  actorProfileId: string;
  actorTeamId: string | null;
  approvalsAccessLevel: number;
  hasAccountsOverride: boolean;
  permissions: AbsenceSecondaryPermissionMap | null;
}

export interface TimesheetApprovalScopeArgs {
  actor: TimesheetApprovalActorScope;
  target: TimesheetTargetScope;
}

interface TimesheetActorScope {
  isElevatedUser: boolean;
  isAdminTier: boolean;
  actorProfileId: string;
  actorTeamId: string | null;
  canAuthoriseBookings: boolean;
  permissions: AbsenceSecondaryPermissionMap | null;
}

interface TimesheetListVisibilityArgs {
  actor: TimesheetActorScope;
  target: TimesheetTargetScope;
  effectiveTeamFilter: string;
}

export function hasAccountsTimesheetFullVisibilityOverride(
  roleName: string | null | undefined,
  teamName: string | null | undefined
): boolean {
  const normalizedRoleName = (roleName || '').trim().toLowerCase();
  const normalizedTeamName = (teamName || '').trim().toLowerCase();

  return (
    normalizedTeamName === 'accounts' &&
    (normalizedRoleName === 'manager' || normalizedRoleName === 'supervisor')
  );
}

export function canActorAuthoriseTimesheetTarget({
  actor,
  target,
}: TimesheetApprovalScopeArgs): boolean {
  if (actor.approvalsAccessLevel < 3 || !actor.actorProfileId) return false;
  if (target.profileId === actor.actorProfileId) return false;
  if (actor.hasAccountsOverride) return true;
  if (!actor.permissions) return false;
  if (actor.permissions.authorise_bookings_all) return true;

  return Boolean(
    actor.permissions.authorise_bookings_team &&
      actor.actorTeamId &&
      target.teamId &&
      actor.actorTeamId === target.teamId
  );
}

function canActorAuthoriseTarget(actor: TimesheetActorScope, target: TimesheetTargetScope): boolean {
  if (!actor.permissions || !actor.actorProfileId || !actor.canAuthoriseBookings) return false;
  if (actor.permissions.authorise_bookings_all) return true;

  return Boolean(
    actor.permissions.authorise_bookings_team &&
      actor.actorTeamId &&
      target.teamId &&
      actor.actorTeamId === target.teamId
  );
}

export function canShowTimesheetInList({
  actor,
  target,
  effectiveTeamFilter,
}: TimesheetListVisibilityArgs): boolean {
  const isOwnTimesheet = Boolean(actor.actorProfileId && target.profileId === actor.actorProfileId);
  if (isOwnTimesheet) return true;

  if (!actor.isElevatedUser) return false;

  if (!actor.isAdminTier && !canActorAuthoriseTarget(actor, target)) {
    return false;
  }

  if (effectiveTeamFilter === 'all') return true;
  if (effectiveTeamFilter === 'unassigned') return !target.teamId;

  return target.teamId === effectiveTeamFilter;
}
