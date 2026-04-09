import { describe, expect, it } from 'vitest';
import {
  canEditDraftInspection,
  canAccessScopedInspection,
  getInspectionVisibilityFlags,
} from '@/lib/utils/inspection-access';

describe('getInspectionVisibilityFlags', () => {
  it('grants supervisors org-wide visibility and keeps non-workshop managers read-only', () => {
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
      canDeleteInspections: false,
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
      canManageInspections: false,
      canDeleteInspections: false,
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
      canDeleteInspections: false,
    });
  });

  it('grants workshop managers draft management rights', () => {
    expect(
      getInspectionVisibilityFlags({
        teamName: 'Workshop',
        isManager: true,
      })
    ).toMatchObject({
      hasOrgWideInspectionVisibility: true,
      hasTeamInspectionVisibility: false,
      canViewCrossUserInspections: true,
      canManageInspections: true,
      canDeleteInspections: true,
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
      canDeleteInspections: false,
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

describe('canEditDraftInspection', () => {
  it('allows the owner to edit their own draft', () => {
    expect(
      canEditDraftInspection({
        status: 'draft',
        ownerUserId: 'user-1',
        currentUserId: 'user-1',
        canManageInspections: false,
      })
    ).toBe(true);
  });

  it('allows workshop managers to edit cross-user drafts', () => {
    expect(
      canEditDraftInspection({
        status: 'draft',
        ownerUserId: 'user-2',
        currentUserId: 'user-1',
        canManageInspections: true,
      })
    ).toBe(true);
  });

  it('keeps supervisors and other read-only viewers out of cross-user draft editing', () => {
    expect(
      canEditDraftInspection({
        status: 'draft',
        ownerUserId: 'user-2',
        currentUserId: 'user-1',
        canManageInspections: false,
      })
    ).toBe(false);
  });

  it('never grants edit access for submitted inspections', () => {
    expect(
      canEditDraftInspection({
        status: 'submitted',
        ownerUserId: 'user-1',
        currentUserId: 'user-1',
        canManageInspections: true,
      })
    ).toBe(false);
  });
});
