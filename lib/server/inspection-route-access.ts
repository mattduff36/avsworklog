import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasWorkshopInspectionFullVisibilityOverride } from '@/lib/utils/inspection-visibility';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getEffectiveRole } from '@/lib/utils/view-as';
import type { ModuleName } from '@/types/roles';

export interface InspectionRouteActorAccess {
  userId: string;
  canManageOthers: boolean;
  canDeleteInspections: boolean;
}

export async function getInspectionRouteActorAccess(
  moduleName: ModuleName
): Promise<{ access: InspectionRouteActorAccess | null; errorResponse: NextResponse | null }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      access: null,
      errorResponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const canAccessModule = await canEffectiveRoleAccessModule(moduleName);
  if (!canAccessModule) {
    return {
      access: null,
      errorResponse: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  const effectiveRole = await getEffectiveRole();
  const hasFullAccessRole = hasEffectiveRoleFullAccess(effectiveRole);
  const isWorkshopTeam = hasWorkshopInspectionFullVisibilityOverride(effectiveRole.team_name);
  const canManageOthers = Boolean(hasFullAccessRole || (effectiveRole.is_manager_admin && isWorkshopTeam));

  return {
    access: {
      userId: user.id,
      canManageOthers,
      canDeleteInspections: canManageOthers,
    },
    errorResponse: null,
  };
}
