import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess } from '@/lib/server/inventory-auth';
import { getInventoryCheckStatus, isInventoryMoveCheckBlocked } from '@/app/(dashboard)/inventory/utils';
import type { InventoryCheckStatus, InventoryLocation } from '@/app/(dashboard)/inventory/types';

type InventoryMoveScope = 'single' | 'bulk' | 'group' | 'claim';

interface MoveInventoryItemsBody {
  item_ids?: string[];
  location_id?: string;
  note?: string;
  scope?: InventoryMoveScope;
  group_id?: string | null;
}

interface GroupMemberRow {
  item_id: string;
}

interface MovedItemRow {
  movement_batch_id: string;
}

interface MoveLocationRow {
  id: string;
  name: string;
  is_active: boolean;
}

interface MoveItemRow {
  id: string;
  item_number: string;
  name: string;
  last_checked_at: string | null;
  check_interval_days: number | null;
  location: Pick<InventoryLocation, 'id' | 'name'> | Array<Pick<InventoryLocation, 'id' | 'name'>> | null;
}

interface CheckBlockedMoveItem {
  id: string;
  item_number: string;
  name: string;
  check_status: InventoryCheckStatus;
}

function uniqueIds(ids: string[] | undefined): string[] {
  return Array.from(new Set((ids || []).map((id) => id.trim()).filter(Boolean)));
}

function normalizeMoveItemLocation(
  location: MoveItemRow['location']
): Pick<InventoryLocation, 'id' | 'name'> | null {
  if (Array.isArray(location)) return location[0] || null;
  return location || null;
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as MoveInventoryItemsBody;
    const destinationLocationId = body.location_id?.trim();
    const scope = body.scope || 'single';
    const groupId = body.group_id?.trim() || null;

    if (!destinationLocationId) {
      return NextResponse.json({ error: 'Destination location is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    let itemIds = uniqueIds(body.item_ids);

    if (scope === 'group') {
      if (!groupId) {
        return NextResponse.json({ error: 'Group is required for a group move' }, { status: 400 });
      }

      const { data: members, error: membersError } = await admin
        .from('inventory_item_group_members')
        .select('item_id')
        .eq('group_id', groupId);

      if (membersError) throw membersError;
      itemIds = ((members || []) as GroupMemberRow[]).map((member) => member.item_id);
    }

    if (itemIds.length === 0) {
      return NextResponse.json({ error: 'At least one inventory item is required' }, { status: 400 });
    }

    const [destinationResult, itemsResult] = await Promise.all([
      admin
        .from('inventory_locations')
        .select('id, name, is_active')
        .eq('id', destinationLocationId)
        .single(),
      admin
        .from('inventory_items')
        .select('id, item_number, name, last_checked_at, check_interval_days, location:inventory_locations(id, name)')
        .in('id', itemIds)
        .eq('status', 'active'),
    ]);

    if (destinationResult.error || !destinationResult.data?.is_active) {
      return NextResponse.json({ error: 'Destination location not found' }, { status: 404 });
    }
    if (itemsResult.error) throw itemsResult.error;

    const destinationLocation = destinationResult.data as MoveLocationRow;
    const moveItems = (itemsResult.data || []) as MoveItemRow[];
    const blockedItems = moveItems.reduce<CheckBlockedMoveItem[]>((acc, item) => {
      const moveItem = {
        ...item,
        location: normalizeMoveItemLocation(item.location),
      };
      if (!isInventoryMoveCheckBlocked(moveItem, destinationLocation)) return acc;
      acc.push({
        id: item.id,
        item_number: item.item_number,
        name: item.name,
        check_status: getInventoryCheckStatus(moveItem),
      });
      return acc;
    }, []);

    if (blockedItems.length > 0) {
      return NextResponse.json(
        {
          error: blockedItems.length === 1
            ? 'Record an inventory check before moving this item.'
            : 'Record inventory checks before moving these items.',
          code: 'INVENTORY_CHECK_REQUIRED',
          blocked_items: blockedItems,
        },
        { status: 400 }
      );
    }

    const { data: movedItems, error: moveError } = await admin.rpc('inventory_move_items_with_batch', {
      p_item_ids: itemIds,
      p_destination_location_id: destinationLocationId,
      p_note: body.note?.trim() || null,
      p_moved_by: access.userId,
      p_move_scope: scope,
      p_group_id: scope === 'group' ? groupId : null,
    });

    if (moveError) {
      if (moveError.code === 'P0001' && moveError.message?.includes('No items were moved')) {
        return NextResponse.json({ error: 'No items were moved' }, { status: 400 });
      }
      throw moveError;
    }

    const movedCount = Array.isArray(movedItems) ? movedItems.length : 0;
    const movementBatchId = Array.isArray(movedItems)
      ? ((movedItems[0] as MovedItemRow | undefined)?.movement_batch_id || null)
      : null;

    if (movedCount === 0) {
      return NextResponse.json({ error: 'No items were moved' }, { status: 400 });
    }

    return NextResponse.json({
      moved_count: movedCount,
      movement_batch_id: movementBatchId,
    });
  } catch (error) {
    console.error('Error moving inventory items:', error);
    return NextResponse.json({ error: 'Failed to move inventory items' }, { status: 500 });
  }
}
