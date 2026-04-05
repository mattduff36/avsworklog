import { describe, expect, it } from 'vitest';
import {
  canAccessScopedInspection,
  getInspectionVisibilityFlags,
} from '@/lib/utils/inspection-access';

describe('getInspectionVisibilityFlags', () => {
  it('grants org-wide visibility to supervisors and managers', () => {
    expect(
      getInspectionVisibilityFlags({
        teamName: 'Civils',
        isSupervisor: true,
      })
    ).toMatchObject({
      hasOrgWideInspectionVisibility: true,
      hasTeamInspectionVisibility: false,
      canViewCrossUserInspections: true,
      canManageInspections: false,
    });

    expect(
      getInspectionVisibilityFlags({
        teamName: 'Civils',
        isManager: true,
      })
    ).toMatchObject({
      hasOrgWideInspectionVisibility: true,
      hasTeamInspectionVisibility: false,
      canViewCrossUserInspections: true,
      canManageInspections: true,
    });
  });

  it('grants workshop employees team-wide read visibility only', () => {
    expect(
      getInspectionVisibilityFlags({
        teamName: 'Workshop',
      })
    ).toMatchObject({
      hasOrgWideInspectionVisibility: false,
      hasTeamInspectionVisibility: true,
      canViewCrossUserInspections: true,
      canManageInspections: false,
    });
  });

  it('keeps non-workshop employees scoped to their own inspections', () => {
    expect(
      getInspectionVisibilityFlags({
        teamName: 'Groundworks',
      })
    ).toMatchObject({
      hasOrgWideInspectionVisibility: false,
      hasTeamInspectionVisibility: false,
      canViewCrossUserInspections: false,
      canManageInspections: false,
    });
  });
});

describe('canAccessScopedInspection', () => {
  it('always allows the inspection owner', () => {
    expect(
      canAccessScopedInspection({
        ownerUserId: 'user-1',
        currentUserId: 'user-1',
        canViewCrossUserInspections: false,
        hasOrgWideInspectionVisibility: false,
        scopedUserIds: [],
      })
    ).toBe(true);
  });

  it('allows org-wide viewers to open other inspections', () => {
    expect(
      canAccessScopedInspection({
        ownerUserId: 'user-2',
        currentUserId: 'user-1',
        canViewCrossUserInspections: true,
        hasOrgWideInspectionVisibility: true,
        scopedUserIds: [],
      })
    ).toBe(true);
  });

  it('allows workshop team viewers to open inspections from scoped teammates only', () => {
    expect(
      canAccessScopedInspection({
        ownerUserId: 'user-2',
        currentUserId: 'user-1',
        canViewCrossUserInspections: true,
        hasOrgWideInspectionVisibility: false,
        scopedUserIds: ['user-1', 'user-2'],
      })
    ).toBe(true);

    expect(
      canAccessScopedInspection({
        ownerUserId: 'user-3',
        currentUserId: 'user-1',
        canViewCrossUserInspections: true,
        hasOrgWideInspectionVisibility: false,
        scopedUserIds: ['user-1', 'user-2'],
      })
    ).toBe(false);
  });
});
