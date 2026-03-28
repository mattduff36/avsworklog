import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { getActorAbsenceSecondaryPermissions } from '@/lib/server/absence-secondary-permissions';

export interface WorkShiftAccessContext {
  userId: string;
  isAdmin: boolean;
  canView: boolean;
  canEdit: boolean;
  teamId: string | null;
}

export async function getWorkShiftAccessContext(): Promise<
  { context: WorkShiftAccessContext; response: null } | { context: null; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      context: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const canAccessAbsence = await canEffectiveRoleAccessModule('absence');
  if (!canAccessAbsence) {
    return {
      context: null,
      response: NextResponse.json({ error: 'Forbidden: Absence access required' }, { status: 403 }),
    };
  }

  const effectiveRole = await getEffectiveRole();
  const roleOverride =
    effectiveRole.user_id === user.id && (effectiveRole.role_name || effectiveRole.is_manager_admin || effectiveRole.is_super_admin)
      ? {
          name: effectiveRole.role_name,
          display_name: effectiveRole.display_name,
          role_class: effectiveRole.role_class,
          is_manager_admin: effectiveRole.is_manager_admin,
          is_super_admin: effectiveRole.is_super_admin,
        }
      : undefined;

  const secondary = await getActorAbsenceSecondaryPermissions(user.id, {
    role: roleOverride,
    ...(effectiveRole.user_id === user.id
      ? {
          team_id: effectiveRole.team_id,
          team_name: effectiveRole.team_name,
        }
      : {}),
  });

  const isAdmin =
    effectiveRole.is_actual_super_admin || effectiveRole.is_super_admin || effectiveRole.role_name === 'admin';

  const context: WorkShiftAccessContext = {
    userId: user.id,
    isAdmin,
    canView: isAdmin || secondary.effective.see_manage_work_shifts,
    canEdit: isAdmin || secondary.effective.edit_manage_work_shifts,
    teamId: secondary.team_id || null,
  };

  return {
    context,
    response: null,
  };
}

export async function canAccessProfileForScopedWorkShift(
  adminClient: {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => Promise<{ data: { team_id: string | null } | null; error: { message: string } | null }>;
        };
      };
    };
  },
  context: WorkShiftAccessContext,
  profileId: string
): Promise<boolean> {
  if (context.isAdmin) return true;
  if (!context.teamId) return false;

  const { data, error } = await adminClient
    .from('profiles')
    .select('team_id')
    .eq('id', profileId)
    .maybeSingle();

  if (error || !data) {
    return false;
  }

  return data.team_id === context.teamId;
}

