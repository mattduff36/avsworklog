import { hasWorkshopInspectionFullVisibilityOverride } from '@/lib/utils/inspection-visibility';

interface InspectionVisibilityInput {
  teamName?: string | null;
  isManager?: boolean;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  isSupervisor?: boolean;
}

export interface InspectionVisibilityFlags {
  hasOrgWideInspectionVisibility: boolean;
  hasTeamInspectionVisibility: boolean;
  canViewCrossUserInspections: boolean;
  canManageInspections: boolean;
}

export function getInspectionVisibilityFlags(
  input: InspectionVisibilityInput
): InspectionVisibilityFlags {
  const hasWorkshopReadAllOverride = hasWorkshopInspectionFullVisibilityOverride(input.teamName);
  const hasOrgWideInspectionVisibility = Boolean(
    input.isManager || input.isSupervisor || input.isAdmin || input.isSuperAdmin
  );
  const hasTeamInspectionVisibility = Boolean(
    !hasOrgWideInspectionVisibility && hasWorkshopReadAllOverride
  );

  return {
    hasOrgWideInspectionVisibility,
    hasTeamInspectionVisibility,
    canViewCrossUserInspections: hasOrgWideInspectionVisibility || hasTeamInspectionVisibility,
    canManageInspections: Boolean(input.isManager || input.isAdmin || input.isSuperAdmin),
  };
}

export function canAccessScopedInspection(params: {
  ownerUserId: string | null | undefined;
  currentUserId: string | null | undefined;
  canViewCrossUserInspections: boolean;
  hasOrgWideInspectionVisibility: boolean;
  scopedUserIds: string[];
}): boolean {
  if (!params.ownerUserId || !params.currentUserId) {
    return false;
  }

  if (params.ownerUserId === params.currentUserId) {
    return true;
  }

  if (!params.canViewCrossUserInspections) {
    return false;
  }

  if (params.hasOrgWideInspectionVisibility) {
    return true;
  }

  return params.scopedUserIds.includes(params.ownerUserId);
}
