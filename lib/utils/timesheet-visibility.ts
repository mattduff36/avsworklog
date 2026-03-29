import type { AbsenceSecondaryPermissionMap } from '@/types/absence-permissions';

interface TimesheetTargetScope {
  profileId: string;
  teamId: string | null;
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

function canActorAuthoriseTarget(actor: TimesheetActorScope, target: TimesheetTargetScope): boolean {
  if (!actor.permissions || !actor.actorProfileId || !actor.canAuthoriseBookings) return false;
  if (actor.permissions.authorise_bookings_all) return true;
  if (target.profileId === actor.actorProfileId && actor.permissions.authorise_bookings_own) return true;

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
