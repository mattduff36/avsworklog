import { describe, expect, it } from 'vitest';
import { getAbsenceSecondaryDefaultMap } from '@/types/absence-permissions';
import {
  canActorAuthoriseTimesheetTarget,
  canActorMarkTimesheetPayrollReceived,
  canActorPerformTimesheetPayrollReceived,
  canActorShowTimesheetPayrollReceived,
  canShowTimesheetInList,
  hasAccountsTimesheetFullVisibilityOverride,
  resolveClientApprovalsAccessLevel,
} from '@/lib/utils/timesheet-visibility';

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

describe('hasAccountsTimesheetFullVisibilityOverride', () => {
  it('returns true for Accounts manager', () => {
    expect(hasAccountsTimesheetFullVisibilityOverride('manager', 'Accounts')).toBe(true);
  });

  it('returns true for Accounts supervisor with mixed casing', () => {
    expect(hasAccountsTimesheetFullVisibilityOverride('Supervisor', 'aCCoUnts')).toBe(true);
  });

  it('returns false for non-Accounts manager', () => {
    expect(hasAccountsTimesheetFullVisibilityOverride('manager', 'Operations')).toBe(false);
  });

  it('returns false for Accounts employee', () => {
    expect(hasAccountsTimesheetFullVisibilityOverride('employee', 'Accounts')).toBe(false);
  });
});

describe('canActorMarkTimesheetPayrollReceived', () => {
  it('PAY-APPROVE-PAYROLL-ACTOR-001 allows admin and Accounts manager or supervisor', () => {
    expect(canActorMarkTimesheetPayrollReceived({
      hasFullAdminAccess: true,
      roleName: 'employee',
      teamName: 'Transport',
    })).toBe(true);
    expect(canActorMarkTimesheetPayrollReceived({
      hasFullAdminAccess: false,
      roleName: 'manager',
      teamName: 'Accounts',
    })).toBe(true);
    expect(canActorMarkTimesheetPayrollReceived({
      hasFullAdminAccess: false,
      roleName: 'Supervisor',
      teamName: 'accounts',
    })).toBe(true);
  });

  it('PAY-APPROVE-MANAGER-DENIED-001 denies team managers outside Accounts', () => {
    expect(canActorMarkTimesheetPayrollReceived({
      hasFullAdminAccess: false,
      roleName: 'manager',
      teamName: 'Transport',
    })).toBe(false);
    expect(canActorMarkTimesheetPayrollReceived({
      hasFullAdminAccess: false,
      roleName: 'manager',
      teamName: 'Plant',
    })).toBe(false);
  });

  it('PAY-UI-AUTHZ-001 hides Payroll Received on the actor’s own timesheet', () => {
    expect(canActorShowTimesheetPayrollReceived({
      canMarkPayrollReceived: true,
      actorProfileId: 'accounts-1',
      targetProfileId: 'accounts-1',
    })).toBe(false);
    expect(canActorShowTimesheetPayrollReceived({
      canMarkPayrollReceived: true,
      actorProfileId: 'accounts-1',
      targetProfileId: 'employee-2',
    })).toBe(true);
    expect(canActorShowTimesheetPayrollReceived({
      canMarkPayrollReceived: false,
      actorProfileId: 'accounts-1',
      targetProfileId: 'employee-2',
    })).toBe(false);
  });

  it('PAY-UI-AUTHZ-001 requires payroll actor, target authorise, and not-self together', () => {
    expect(canActorPerformTimesheetPayrollReceived({
      canMarkPayrollReceived: true,
      canAuthoriseTarget: true,
      actorProfileId: 'accounts-1',
      targetProfileId: 'employee-2',
    })).toBe(true);
    expect(canActorPerformTimesheetPayrollReceived({
      canMarkPayrollReceived: true,
      canAuthoriseTarget: false,
      actorProfileId: 'accounts-1',
      targetProfileId: 'employee-2',
    })).toBe(false);
    expect(canActorPerformTimesheetPayrollReceived({
      canMarkPayrollReceived: true,
      canAuthoriseTarget: true,
      actorProfileId: 'accounts-1',
      targetProfileId: 'accounts-1',
    })).toBe(false);
    expect(canActorPerformTimesheetPayrollReceived({
      canMarkPayrollReceived: false,
      canAuthoriseTarget: true,
      actorProfileId: 'manager-1',
      targetProfileId: 'employee-2',
    })).toBe(false);
  });

  it('PAY-UI-AUTHZ-001 uses the real Approvals access level instead of boolean module access', () => {
    expect(resolveClientApprovalsAccessLevel({
      isAdminTier: true,
      permissionLevels: { approvals: 1 },
    })).toBe(5);
    expect(resolveClientApprovalsAccessLevel({
      isAdminTier: false,
      permissionLevels: { approvals: 2 },
    })).toBe(2);
    expect(resolveClientApprovalsAccessLevel({
      isAdminTier: false,
      permissionLevels: { approvals: 3 },
    })).toBe(3);
    expect(resolveClientApprovalsAccessLevel({
      isAdminTier: false,
      permissionLevels: null,
    })).toBe(0);
    expect(canActorAuthoriseTimesheetTarget({
      actor: {
        actorProfileId: 'viewer-1',
        actorTeamId: 'team-a',
        approvalsAccessLevel: resolveClientApprovalsAccessLevel({
          isAdminTier: false,
          permissionLevels: { approvals: 1 },
        }),
        hasAccountsOverride: true,
        permissions: null,
      },
      target: { profileId: 'employee-2', teamId: 'team-a' },
    })).toBe(false);
  });
});

describe('canActorAuthoriseTimesheetTarget', () => {
  const supervisorPermissions = getAbsenceSecondaryDefaultMap('supervisor');

  it('APPROVAL-SCOPE-001 allows Level 3 team scope and denies self or out-of-team', () => {
    const actor = {
      actorProfileId: 'supervisor-1',
      actorTeamId: 'team-a',
      approvalsAccessLevel: 3,
      hasAccountsOverride: false,
      permissions: supervisorPermissions,
    };

    expect(
      canActorAuthoriseTimesheetTarget({
        actor,
        target: { profileId: 'employee-1', teamId: 'team-a' },
      })
    ).toBe(true);
    expect(
      canActorAuthoriseTimesheetTarget({
        actor,
        target: { profileId: 'supervisor-1', teamId: 'team-a' },
      })
    ).toBe(false);
    expect(
      canActorAuthoriseTimesheetTarget({
        actor,
        target: { profileId: 'employee-2', teamId: 'team-b' },
      })
    ).toBe(false);
    expect(
      canActorAuthoriseTimesheetTarget({
        actor: { ...actor, actorTeamId: null },
        target: { profileId: 'employee-3', teamId: null },
      })
    ).toBe(false);
  });

  it('APPROVAL-SCOPE-002 allows ALL cross-team but never Reports-only or self', () => {
    const allPermissions = {
      ...supervisorPermissions,
      authorise_bookings_all: true,
      authorise_bookings_team: false,
    };

    expect(
      canActorAuthoriseTimesheetTarget({
        actor: {
          actorProfileId: 'authoriser-1',
          actorTeamId: 'team-a',
          approvalsAccessLevel: 3,
          hasAccountsOverride: false,
          permissions: allPermissions,
        },
        target: { profileId: 'employee-1', teamId: 'team-b' },
      })
    ).toBe(true);
    expect(
      canActorAuthoriseTimesheetTarget({
        actor: {
          actorProfileId: 'authoriser-1',
          actorTeamId: 'team-a',
          approvalsAccessLevel: 0,
          hasAccountsOverride: false,
          permissions: allPermissions,
        },
        target: { profileId: 'employee-1', teamId: 'team-b' },
      })
    ).toBe(false);
    expect(
      canActorAuthoriseTimesheetTarget({
        actor: {
          actorProfileId: 'authoriser-1',
          actorTeamId: 'team-a',
          approvalsAccessLevel: 5,
          hasAccountsOverride: true,
          permissions: allPermissions,
        },
        target: { profileId: 'authoriser-1', teamId: 'team-a' },
      })
    ).toBe(false);
  });

  it('ACCOUNTS-SCOPE-001 grants Accounts override only with Approvals Level 3+', () => {
    const target = { profileId: 'employee-1', teamId: 'team-b' };

    expect(
      canActorAuthoriseTimesheetTarget({
        actor: {
          actorProfileId: 'accounts-supervisor',
          actorTeamId: 'accounts',
          approvalsAccessLevel: 3,
          hasAccountsOverride: true,
          permissions: null,
        },
        target,
      })
    ).toBe(true);
    expect(
      canActorAuthoriseTimesheetTarget({
        actor: {
          actorProfileId: 'accounts-supervisor',
          actorTeamId: 'accounts',
          approvalsAccessLevel: 2,
          hasAccountsOverride: true,
          permissions: null,
        },
        target,
      })
    ).toBe(false);
  });
});
