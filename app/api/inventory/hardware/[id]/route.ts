import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface UpdateHardwareItemBody {
  name?: string;
  sort_order?: number;
  is_active?: boolean;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as UpdateHardwareItemBody;
    const admin = createAdminClient();
    const { data: currentItem, error: currentItemError } = await admin
      .from('inventory_hardware_items')
      .select('id, is_active')
      .eq('id', id)
      .single();

    if (currentItemError) {
      if (currentItemError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Hardware item not found' }, { status: 404 });
      }
      throw currentItemError;
    }

    if (body.is_active === false && currentItem.is_active) {
      const { count, error: balanceError } = await admin
        .from('inventory_hardware_balances')
        .select('id', { count: 'exact', head: true })
        .eq('hardware_item_id', id)
        .gt('quantity', 0);

      if (balanceError) throw balanceError;
      if ((count || 0) > 0) {
        return NextResponse.json(
          { error: 'Hardware stock must be zero at every location before this item can be archived' },
          { status: 400 },
        );
      }
    }

    const update: Record<string, unknown> = {
      updated_by: access.userId,
    };

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: 'Hardware item name is required' }, { status: 400 });
      }
      update.name = name;
    }
    if (body.sort_order !== undefined) {
      update.sort_order = Number.isInteger(body.sort_order) ? body.sort_order : 0;
    }
    if (body.is_active !== undefined) {
      update.is_active = body.is_active;
    }

    const { data, error } = await admin
      .from('inventory_hardware_items')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A Hardware item with this name already exists' }, { status: 400 });
      }
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Hardware item not found' }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ item: data });
  } catch (error) {
    console.error('Error updating Inventory Hardware item:', error);
    return NextResponse.json({ error: 'Failed to update Hardware item' }, { status: 500 });
  }
}
