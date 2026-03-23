import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { ALL_MODULES } from '@/types/roles';
import { getPermissionMapForUser, isMissingTeamPermissionSchemaError } from '@/lib/server/team-permissions';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const effectiveRole = await getEffectiveRole();
    if (effectiveRole.is_actual_super_admin || effectiveRole.is_super_admin) {
      const fullAccessPermissions = ALL_MODULES.reduce<Record<string, boolean>>((acc, moduleName) => {
        acc[moduleName] = true;
        return acc;
      }, {}) as Record<(typeof ALL_MODULES)[number], boolean>;

      return NextResponse.json({
        success: true,
        permissions: fullAccessPermissions,
        enabled_modules: ALL_MODULES,
        effective_team_id: effectiveRole.team_id,
        effective_team_name: effectiveRole.team_name,
      });
    }

    const permissions = await getPermissionMapForUser(
      user.id,
      effectiveRole.role_id,
      createAdminClient(),
      effectiveRole.team_id
    );

    return NextResponse.json({
      success: true,
      permissions,
      enabled_modules: ALL_MODULES.filter((moduleName) => permissions[moduleName]),
      effective_team_id: effectiveRole.team_id,
      effective_team_name: effectiveRole.team_name,
    });
  } catch (error) {
    if (isMissingTeamPermissionSchemaError(error)) {
      return NextResponse.json({
        success: true,
        permissions: ALL_MODULES.reduce<Record<string, boolean>>((acc, moduleName) => {
          acc[moduleName] = false;
          return acc;
        }, {}),
        enabled_modules: [],
      });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
