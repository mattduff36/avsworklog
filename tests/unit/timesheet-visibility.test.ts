import { describe, expect, it } from 'vitest';
import { getAbsenceSecondaryDefaultMap } from '@/types/absence-permissions';
import { canShowTimesheetInList } from '@/lib/utils/timesheet-visibility';

describe('canShowTimesheetInList', () => {
  const managerPermissions = getAbsenceSecondaryDefaultMap('manager');

  it('always allows users to see their own timesheet', () => {
    const canSeeOwnTimesheet = canShowTimesheetInList({
      actor: {
        isElevatedUser: true,
        isAdminTier: false,
        actorProfileId: 'manager-1',
        actorTeamId: 'team-a',
        canAuthoriseBookings: false,
        permissions: null,
      },
      target: {
        profileId: 'manager-1',
        teamId: 'team-b',
      },
      effectiveTeamFilter: 'team-a',
    });

    expect(canSeeOwnTimesheet).toBe(true);
  });

  it('denies non-elevated users from seeing someone else timesheet', () => {
    const canSeeOtherTimesheet = canShowTimesheetInList({
      actor: {
        isElevatedUser: false,
        isAdminTier: false,
        actorProfileId: 'employee-1',
        actorTeamId: 'team-a',
        canAuthoriseBookings: false,
        permissions: null,
      },
      target: {
        profileId: 'employee-2',
        teamId: 'team-a',
      },
      effectiveTeamFilter: 'all',
    });

    expect(canSeeOtherTimesheet).toBe(false);
  });

  it('allows manager to see team member with team-level authorise permission', () => {
    const canSeeTeamMember = canShowTimesheetInList({
      actor: {
        isElevatedUser: true,
        isAdminTier: false,
        actorProfileId: 'manager-1',
        actorTeamId: 'team-a',
        canAuthoriseBookings: true,
        permissions: managerPermissions,
      },
      target: {
        profileId: 'employee-1',
        teamId: 'team-a',
      },
      effectiveTeamFilter: 'all',
    });

    expect(canSeeTeamMember).toBe(true);
  });

  it('respects team filter for non-own rows', () => {
    const canSeeOutOfTeamRow = canShowTimesheetInList({
      actor: {
        isElevatedUser: true,
        isAdminTier: true,
        actorProfileId: 'admin-1',
        actorTeamId: null,
        canAuthoriseBookings: true,
        permissions: getAbsenceSecondaryDefaultMap('admin'),
      },
      target: {
        profileId: 'employee-1',
        teamId: 'team-a',
      },
      effectiveTeamFilter: 'team-b',
    });

    expect(canSeeOutOfTeamRow).toBe(false);
  });
});
