import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess } from '@/lib/server/inventory-auth';
import { withEnrichedInventoryLocation } from '@/lib/server/inventory-locations';
import {
  InventoryMoveError,
  moveInventoryItems,
  toInventoryMoveErrorResponse,
} from '@/lib/server/inventory-move';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface MoveInventoryItemBody {
  location_id?: string;
  note?: string;
  check_warning_confirmation?: unknown;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as MoveInventoryItemBody;
    const destinationLocationId = body.location_id?.trim();
    const admin = createAdminClient();

    await moveInventoryItems(admin, {
      itemIds: [id],
      destinationLocationId: destinationLocationId || '',
      note: body.note,
      scope: 'single',
      movedBy: access.userId,
      checkWarningConfirmation: body.check_warning_confirmation,
    });

    const { data: updatedItem, error: itemError } = await admin
      .from('inventory_items')
      .select(`
        *,
        location:inventory_locations(*)
      `)
      .eq('id', id)
      .single();

    if (itemError) throw itemError;

    const item = await withEnrichedInventoryLocation(admin, updatedItem);
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof InventoryMoveError) {
      const response = toInventoryMoveErrorResponse(error);
      return NextResponse.json(response.body, { status: response.status });
    }
    console.error('Error moving inventory item:', error);
    return NextResponse.json({ error: 'Failed to move inventory item' }, { status: 500 });
  }
}
