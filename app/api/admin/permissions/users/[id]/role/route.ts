import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSettingsAccess } from '@/lib/server/admin-settings-access';
import {
  AdminSettingsRoleAssignmentError,
  updateUserRoleForAdminSettings,
} from '@/lib/server/admin-settings-role-assignment';
import { hasEffectiveRoleFullAccess } from '@/lib/utils/role-access';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const access = await requireAdminSettingsAccess();
    if (access.response) return access.response;

    const body = (await request.json()) as { role_id?: unknown };
    const roleId = typeof body.role_id === 'string' ? body.role_id.trim() : '';
    if (!roleId) {
      return NextResponse.json({ error: 'role_id is required' }, { status: 400 });
    }

    const userId = (await params).id;
    const effectiveRole = await getEffectiveRole();
    await updateUserRoleForAdminSettings({
      userId,
      roleId,
      actorHasFullAccess: hasEffectiveRoleFullAccess(effectiveRole),
    });

    return NextResponse.json({ success: true, message: 'Job role updated' });
  } catch (error) {
    if (error instanceof AdminSettingsRoleAssignmentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/permissions/users/[id]/role',
      additionalData: {
        endpoint: '/api/admin/permissions/users/[id]/role',
      },
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
