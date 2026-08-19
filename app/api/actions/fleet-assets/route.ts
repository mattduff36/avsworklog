import { NextResponse } from 'next/server';
import { listActionsFleetAssets } from '@/lib/server/inventory-kiosk-allocate';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

export async function GET() {
  try {
    const canManageActions = await canEffectiveRoleAccessModule('actions');
    if (!canManageActions) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ assets: await listActionsFleetAssets() });
  } catch (error) {
    console.error('Error listing Actions fleet assets:', error);
    return NextResponse.json({ error: 'Failed to load fleet assets' }, { status: 500 });
  }
}
