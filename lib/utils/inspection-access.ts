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
  canDeleteInspections: boolean;
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
  const canManageInspections = Boolean(
    input.isAdmin || input.isSuperAdmin || (input.isManager && hasWorkshopReadAllOverride)
  );

  return {
    hasOrgWideInspectionVisibility,
    hasTeamInspectionVisibility,
    canViewCrossUserInspections: hasOrgWideInspectionVisibility || hasTeamInspectionVisibility,
    // Draft management is restricted to admins/superadmins and workshop managers.
    canManageInspections,
    canDeleteInspections: canManageInspections,
  };
}

export function canEditDraftInspection(params: {
  status: string | null | undefined;
  ownerUserId: string | null | undefined;
  currentUserId: string | null | undefined;
  canManageInspections: boolean;
}): boolean {
  if (params.status !== 'draft') {
    return false;
  }

  if (!params.ownerUserId || !params.currentUserId) {
    return false;
  }

  return params.ownerUserId === params.currentUserId || params.canManageInspections;
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
