import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import {
  getCurrentAssignmentForAsset,
  type FleetAssetType,
} from '@/lib/server/fleet-nickname-assignment';

function parseAssetType(value: string | null): FleetAssetType | null {
  if (value === 'van' || value === 'hgv' || value === 'plant') return value;
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageFleet = await canEffectiveRoleAccessModule('admin-vans');
    if (!canManageFleet) {
      return NextResponse.json({ error: 'Forbidden: Fleet admin access required' }, { status: 403 });
    }

    const assetType = parseAssetType(request.nextUrl.searchParams.get('asset_type'));
    const assetId = request.nextUrl.searchParams.get('asset_id');
    if (!assetType || !assetId) {
      return NextResponse.json(
        { error: 'asset_type and asset_id are required' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const assignment = await getCurrentAssignmentForAsset(admin, assetType, assetId);

    return NextResponse.json({
      assignment: assignment
        ? {
            id: assignment.assignmentId,
            user_id: assignment.userId,
            full_name: assignment.fullName,
          }
        : null,
    });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/fleet-assignments',
      additionalData: { endpoint: '/api/admin/fleet-assignments' },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
