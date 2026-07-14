import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface UpdateHardwareItemBody {
  name?: string;
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
    const { error: currentItemError } = await admin
      .from('inventory_hardware_items')
      .select('id')
      .eq('id', id)
      .single();

    if (currentItemError) {
      if (currentItemError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Hardware item not found' }, { status: 404 });
      }
      throw currentItemError;
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

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const admin = createAdminClient();
    const { data: currentItem, error: currentItemError } = await admin
      .from('inventory_hardware_items')
      .select('id')
      .eq('id', id)
      .single();

    if (currentItemError) {
      if (currentItemError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Hardware item not found' }, { status: 404 });
      }
      throw currentItemError;
    }

    if (!currentItem) {
      return NextResponse.json({ error: 'Hardware item not found' }, { status: 404 });
    }

    const [
      { count: balanceCount, error: balanceError },
      { count: transactionCount, error: transactionError },
    ] = await Promise.all([
      admin
        .from('inventory_hardware_balances')
        .select('id', { count: 'exact', head: true })
        .eq('hardware_item_id', id),
      admin
        .from('inventory_hardware_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('hardware_item_id', id),
    ]);

    if (balanceError) throw balanceError;
    if (transactionError) throw transactionError;
    if ((balanceCount || 0) > 0 || (transactionCount || 0) > 0) {
      return NextResponse.json(
        { error: 'Hardware items with stock balances or audit history cannot be deleted' },
        { status: 409 },
      );
    }

    const { error: deleteError } = await admin
      .from('inventory_hardware_items')
      .delete()
      .eq('id', id);

    if (deleteError) {
      if (deleteError.code === '23503') {
        return NextResponse.json(
          { error: 'Hardware items with stock balances or audit history cannot be deleted' },
          { status: 409 },
        );
      }
      throw deleteError;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting Inventory Hardware item:', error);
    return NextResponse.json({ error: 'Failed to delete Hardware item' }, { status: 500 });
  }
}
