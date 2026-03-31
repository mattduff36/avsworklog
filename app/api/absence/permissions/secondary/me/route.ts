import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getActorAbsenceSecondaryPermissions } from '@/lib/server/absence-secondary-permissions';
import { getEffectiveRole } from '@/lib/utils/view-as';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const canAccessAbsenceModule = await canEffectiveRoleAccessModule('absence');
  if (!canAccessAbsenceModule) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
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
    const hasTeamOverride = effectiveRole.user_id === user.id;

    const snapshot = await getActorAbsenceSecondaryPermissions(user.id, {
      role: roleOverride,
      ...(hasTeamOverride
        ? {
            team_id: effectiveRole.team_id,
            team_name: effectiveRole.team_name,
          }
        : {}),
    });
    const permissions = snapshot.effective;

    return NextResponse.json({
      success: true,
      role_tier: snapshot.role_tier,
      role_name: snapshot.role_name,
      role_display_name: snapshot.role_display_name,
      team_id: snapshot.team_id,
      team_name: snapshot.team_name,
      has_exception_row: snapshot.has_exception_row,
      defaults: snapshot.defaults,
      permissions,
      flags: {
        can_view_bookings: permissions.see_bookings_all || permissions.see_bookings_team || permissions.see_bookings_own,
        can_add_edit_bookings:
          permissions.add_edit_bookings_all || permissions.add_edit_bookings_team || permissions.add_edit_bookings_own,
        can_view_allowances: permissions.see_allowances_all || permissions.see_allowances_team,
        can_add_edit_allowances: permissions.add_edit_allowances_all || permissions.add_edit_allowances_team,
        can_view_manage_overview: permissions.see_manage_overview_all || permissions.see_manage_overview_team,
        can_view_manage_overview_all: permissions.see_manage_overview_all,
        can_view_manage_overview_team: permissions.see_manage_overview_team,
        can_view_manage_reasons: permissions.see_manage_reasons,
        can_view_manage_work_shifts: permissions.see_manage_work_shifts_all || permissions.see_manage_work_shifts_team,
        can_view_manage_work_shifts_all: permissions.see_manage_work_shifts_all,
        can_view_manage_work_shifts_team: permissions.see_manage_work_shifts_team,
        can_edit_manage_work_shifts: permissions.edit_manage_work_shifts_all || permissions.edit_manage_work_shifts_team,
        can_edit_manage_work_shifts_all: permissions.edit_manage_work_shifts_all,
        can_edit_manage_work_shifts_team: permissions.edit_manage_work_shifts_team,
        can_authorise_bookings:
          permissions.authorise_bookings_all || permissions.authorise_bookings_team || permissions.authorise_bookings_own,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load absence secondary permissions' },
      { status: 500 }
    );
  }
}

