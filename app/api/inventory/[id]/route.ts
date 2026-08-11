import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeInventoryItemNumber, requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { withEnrichedInventoryLocation } from '@/lib/server/inventory-locations';
import {
  InventoryMoveError,
  assertInventoryMoveCheckConfirmation,
  moveInventoryItems,
  prepareInventoryMove,
  toInventoryMoveErrorResponse,
} from '@/lib/server/inventory-move';
import { isInventoryRetireReason, type InventoryCategory, type InventoryRetireReason, type InventoryStatus } from '@/app/(dashboard)/inventory/types';
import type { Database } from '@/types/database';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface InventoryItemUpdateBody {
  item_number?: string;
  name?: string;
  category?: InventoryCategory;
  location_id?: string;
  last_checked_at?: string | null;
  check_interval_days?: number | null;
  status?: InventoryStatus;
  retire_reason?: InventoryRetireReason | null;
  check_warning_confirmation?: unknown;
}

type InventoryLocationRow = Database['public']['Tables']['inventory_locations']['Row'];

interface InventoryItemRow {
  location?: InventoryLocationRow | InventoryLocationRow[] | null;
  minor_plant_detail?: unknown;
}

function cleanOptionalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value;
}

function normalizeMinorPlantDetailRelation(item: InventoryItemRow): InventoryItemRow {
  const relation = item.minor_plant_detail;
  return {
    ...item,
    minor_plant_detail: Array.isArray(relation) ? relation[0] ?? null : relation ?? null,
  };
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as InventoryItemUpdateBody;
    const admin = createAdminClient();
    let requestedLocationId: string | null = null;
    const update: Record<string, unknown> = {
      updated_by: access.userId,
    };

    if (body.item_number !== undefined) {
      const itemNumber = body.item_number.trim();
      if (!itemNumber) {
        return NextResponse.json({ error: 'Item number is required' }, { status: 400 });
      }
      update.item_number = itemNumber;
      update.item_number_normalized = normalizeInventoryItemNumber(itemNumber);
    }
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: 'Name is required' }, { status: 400 });
      }
      update.name = name;
    }
    if (body.category !== undefined) {
      const category = body.category.trim();
      if (!category) {
        return NextResponse.json({ error: 'Category is required' }, { status: 400 });
      }
      update.category = category;
    }
    if (body.location_id !== undefined) {
      const locationId = body.location_id?.trim() || '';
      if (!locationId) {
        return NextResponse.json({ error: 'Location is required' }, { status: 400 });
      }

      requestedLocationId = locationId;
    }
    if (body.check_interval_days !== undefined) {
      update.check_interval_days = body.check_interval_days || null;
    }
    if (body.status !== undefined) {
      if (body.status === 'active') {
        update.status = 'active';
        update.retired_at = null;
        update.retire_reason = null;
        update.retired_by = null;
      } else if (body.status === 'retired') {
        if (!isInventoryRetireReason(body.retire_reason)) {
          return NextResponse.json({ error: 'Valid retirement reason is required' }, { status: 400 });
        }
        update.status = 'retired';
        update.retired_at = new Date().toISOString();
        update.retire_reason = body.retire_reason;
        update.retired_by = access.userId;
      }
    }

    if (body.last_checked_at !== undefined) {
      const { count, error: historyCountError } = await admin
        .from('inventory_check_history')
        .select('id', { count: 'exact', head: true })
        .eq('item_id', id);

      if (historyCountError) throw historyCountError;

      if ((count || 0) > 0) {
        return NextResponse.json(
          {
            error: 'Last checked is managed by inventory check history and cannot be edited directly.',
            code: 'INVENTORY_LAST_CHECKED_HISTORY_LOCKED',
          },
          { status: 409 },
        );
      }

      update.last_checked_at = cleanOptionalDate(body.last_checked_at);
    }

    let shouldMove = false;
    if (requestedLocationId) {
      const { data: currentLocation, error: currentLocationError } = await admin
        .from('inventory_items')
        .select('location_id')
        .eq('id', id)
        .single();
      if (currentLocationError) throw currentLocationError;
      shouldMove = currentLocation.location_id !== requestedLocationId;
    }

    const moveInput = requestedLocationId && shouldMove
      ? {
          itemIds: [id],
          destinationLocationId: requestedLocationId,
          note: 'Moved from inventory item edit',
          scope: 'single' as const,
          movedBy: access.userId,
          checkWarningConfirmation: body.check_warning_confirmation,
          itemCheckOverrides: {
            [id]: {
              ...(body.category !== undefined ? { category: body.category.trim() } : {}),
              ...(body.check_interval_days !== undefined
                ? { check_interval_days: body.check_interval_days || null }
                : {}),
              ...(body.last_checked_at !== undefined
                ? { last_checked_at: cleanOptionalDate(body.last_checked_at) }
                : {}),
            },
          },
        }
      : null;

    if (moveInput) {
      const preparedMove = await prepareInventoryMove(admin, moveInput);
      assertInventoryMoveCheckConfirmation(preparedMove, body.check_warning_confirmation);
    }

    const { data: updatedData, error } = await admin
      .from('inventory_items')
      .update(update)
      .eq('id', id)
      .select(`
        *,
        location:inventory_locations(*),
        minor_plant_detail:inventory_minor_plant_details(*)
      `)
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'An inventory item with this ID number already exists' }, { status: 400 });
      }
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 });
      }
      throw error;
    }

    let responseItem = updatedData;
    if (moveInput && updatedData.location_id !== requestedLocationId) {
      await moveInventoryItems(admin, moveInput!);

      const { data: movedData, error: movedLoadError } = await admin
        .from('inventory_items')
        .select(`
          *,
          location:inventory_locations(*),
          minor_plant_detail:inventory_minor_plant_details(*)
        `)
        .eq('id', id)
        .single();

      if (movedLoadError) throw movedLoadError;
      responseItem = movedData;
    }

    const item = await withEnrichedInventoryLocation(
      admin,
      normalizeMinorPlantDetailRelation(responseItem as InventoryItemRow),
    );
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof InventoryMoveError) {
      const response = toInventoryMoveErrorResponse(error);
      return NextResponse.json(response.body, { status: response.status });
    }
    console.error('Error updating inventory item:', error);
    return NextResponse.json({ error: 'Failed to update inventory item' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({})) as { retire_reason?: unknown };
    if (!isInventoryRetireReason(body.retire_reason)) {
      return NextResponse.json({ error: 'Valid retirement reason is required' }, { status: 400 });
    }

    const { error } = await createAdminClient()
      .from('inventory_items')
      .update({
        status: 'retired',
        retired_at: new Date().toISOString(),
        retire_reason: body.retire_reason,
        retired_by: access.userId,
        updated_by: access.userId,
      })
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error retiring inventory item:', error);
    return NextResponse.json({ error: 'Failed to retire inventory item' }, { status: 500 });
  }
}
