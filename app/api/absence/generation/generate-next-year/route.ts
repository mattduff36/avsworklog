import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { generateNextFinancialYearAllowances } from '@/lib/services/absence-bank-holiday-sync';
import { getActorAbsenceSecondaryPermissions } from '@/lib/server/absence-secondary-permissions';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

export async function POST() {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profile = await getProfileWithRole(user.id);
    const canAccessAbsence = await canEffectiveRoleAccessModule('absence');
    if (!profile || !canAccessAbsence) {
      return NextResponse.json(
        { error: 'Forbidden: Absence access required' },
        { status: 403 }
      );
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
    if (!isAdmin && !secondary.effective.see_manage_overview_all) {
      return NextResponse.json(
        { error: 'Forbidden: Records & Admin ALL scope required' },
        { status: 403 }
      );
    }

    const result = await generateNextFinancialYearAllowances({
      supabase,
      actorProfileId: profile.id,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error generating next financial year allowances:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to generate allowances' },
      { status: 500 }
    );
  }
}
