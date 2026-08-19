import { NextRequest, NextResponse } from 'next/server';
import { listActionsInventoryLocations } from '@/lib/server/inventory-kiosk-allocate';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

export async function GET(request: NextRequest) {
  try {
    const canManageActions = await canEffectiveRoleAccessModule('actions');
    if (!canManageActions) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get('limit') || '50', 10);
    const offset = Number.parseInt(searchParams.get('offset') || '0', 10);
    const result = await listActionsInventoryLocations({
      id: searchParams.get('id')?.trim() || '',
      search: searchParams.get('search')?.trim() || '',
      includeLegacyQuotes: searchParams.get('includeLegacyQuotes') === 'true',
      limit,
      offset,
    });

    return NextResponse.json({
      locations: result.locations,
      pagination: {
        total: result.total,
        has_more: offset + result.locations.length < result.total,
      },
    });
  } catch (error) {
    console.error('Error listing Actions inventory locations:', error);
    return NextResponse.json({ error: 'Failed to load locations' }, { status: 500 });
  }
}
