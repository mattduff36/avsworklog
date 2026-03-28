import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getActorAbsenceSecondaryPermissions } from '@/lib/server/absence-secondary-permissions';

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
    const snapshot = await getActorAbsenceSecondaryPermissions(user.id);
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

