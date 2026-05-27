import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import {
  ALL_MODULES,
  EDITABLE_PERMISSION_ACCESS_LEVELS,
  type ModuleName,
  type PermissionsAuditInfo,
  type PermissionsAuditModuleInfo,
  type PermissionAccessLevel,
  type UpdateUserPermissionLevelsRequest,
} from '@/types/roles';
import {
  getUserPermissionMatrix,
  isMissingTeamPermissionSchemaError,
  updateUserModulePermissionLevels,
} from '@/lib/server/team-permissions';
import permissionsAudit from '@/docs_private/permissions-secondary-audit.json';

type RawAuditModule = {
  displayName?: string;
  moduleName?: string;
  matrixGate?: string;
  minimumRole?: string;
  byRole?: Record<string, string>;
};

function toAuditInfo(): PermissionsAuditInfo {
  const modules = ((permissionsAudit.modules || []) as RawAuditModule[])
    .filter((module): module is RawAuditModule & { moduleName: ModuleName } =>
      Boolean(module.moduleName && ALL_MODULES.includes(module.moduleName as ModuleName))
    )
    .map((module): PermissionsAuditModuleInfo => ({
      displayName: module.displayName || module.moduleName,
      moduleName: module.moduleName,
      matrixGate: module.matrixGate || '',
      minimumRole: module.minimumRole || '',
      byRole: module.byRole || {},
    }));

  return {
    title: permissionsAudit.title || 'Permissions Secondary Audit',
    auditDate: permissionsAudit.auditDate || '',
    matrixRule: permissionsAudit.matrixRule || '',
    modules,
    prdRelevantMismatches: permissionsAudit.prdRelevantMismatches || [],
  };
}

async function assertAdminPermission(): Promise<NextResponse | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const canAccessUserAdmin = await canEffectiveRoleAccessModule('admin-users');
  const effectiveRole = await getEffectiveRole();
  const actorIsAdmin = hasEffectiveRoleFullAccess(effectiveRole);
  if (!canAccessUserAdmin || !actorIsAdmin) {
    return NextResponse.json({ error: 'Forbidden - admin access required' }, { status: 403 });
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const forbidden = await assertAdminPermission();
    if (forbidden) return forbidden;

    const matrix = await getUserPermissionMatrix(createAdminClient());
    return NextResponse.json({
      success: true,
      roles: matrix.roles,
      modules: matrix.modules,
      users: matrix.users,
      audit: toAuditInfo(),
    });
  } catch (error) {
    if (isMissingTeamPermissionSchemaError(error)) {
      return NextResponse.json(
        { error: 'User permission level matrix is not configured yet.' },
        { status: 501 }
      );
    }

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/permissions/users',
      additionalData: {
        endpoint: '/api/admin/permissions/users',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const forbidden = await assertAdminPermission();
    if (forbidden) return forbidden;

    const effectiveRole = await getEffectiveRole();
    const body = (await request.json()) as UpdateUserPermissionLevelsRequest;
    if (!Array.isArray(body.updates)) {
      return NextResponse.json({ error: 'Invalid request: updates array required' }, { status: 400 });
    }

    const normalizedUpdates = body.updates.filter(
      (update): update is { user_id: string; module_name: ModuleName; access_level: PermissionAccessLevel } =>
        typeof update.user_id === 'string' &&
        update.user_id.length > 0 &&
        ALL_MODULES.includes(update.module_name) &&
        EDITABLE_PERMISSION_ACCESS_LEVELS.includes(update.access_level)
    );

    if (normalizedUpdates.length !== body.updates.length) {
      return NextResponse.json({ error: 'Invalid user permission level payload' }, { status: 400 });
    }

    await updateUserModulePermissionLevels(createAdminClient(), normalizedUpdates, effectiveRole.user_id);

    return NextResponse.json({
      success: true,
      message: 'User permission levels updated successfully',
    });
  } catch (error) {
    if (isMissingTeamPermissionSchemaError(error)) {
      return NextResponse.json(
        { error: 'User permission level matrix is not configured yet.' },
        { status: 501 }
      );
    }

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/permissions/users',
      additionalData: {
        endpoint: '/api/admin/permissions/users',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
