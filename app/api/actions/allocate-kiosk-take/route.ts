import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAuthenticatedProfile } from '@/lib/server/app-auth/session';
import {
  allocateUnallocatedKioskTake,
  InventoryKioskAllocateError,
} from '@/lib/server/inventory-kiosk-allocate';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { FleetAssetLinkType } from '@/app/(dashboard)/inventory/types';

interface AllocateBody {
  action_id?: string;
  destination_location_id?: string | null;
  new_location?: {
    name?: string;
    description?: string | null;
    linked_asset_type?: FleetAssetLinkType | 'none';
    linked_asset_id?: string | null;
  } | null;
}

export async function POST(request: NextRequest) {
  try {
    const current = await getCurrentAuthenticatedProfile();
    if (!current) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageActions = await canEffectiveRoleAccessModule('actions');
    if (!canManageActions) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = (await request.json()) as AllocateBody;
    const result = await allocateUnallocatedKioskTake({
      actionId: body.action_id || '',
      actorId: current.profile.id,
      destinationLocationId: body.destination_location_id,
      newLocation: body.new_location,
    });

    return NextResponse.json({ success: true, allocation: result });
  } catch (error) {
    if (error instanceof InventoryKioskAllocateError) {
      return NextResponse.json(
        {
          error: error.message,
          allocated_location_id: error.allocatedLocationId || null,
        },
        { status: error.status },
      );
    }

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/actions/allocate-kiosk-take',
      additionalData: { endpoint: 'POST /api/actions/allocate-kiosk-take' },
    });
    return NextResponse.json({ error: 'Failed to allocate the Yard take' }, { status: 500 });
  }
}
