import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess, requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { getResponsibleHardwareLocationIds } from '@/lib/server/inventory-hardware';

interface CreateHardwareItemBody {
  name?: string;
}

export async function GET() {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const admin = createAdminClient();
    const itemQuery = admin
      .from('inventory_hardware_items')
      .select('*')
      .order('name', { ascending: true })
      .order('id', { ascending: true });

    if (!access.isManagerOrAdmin) {
      itemQuery.eq('is_active', true);
    }

    const responsibleLocationIds = access.isManagerOrAdmin
      ? null
      : await getResponsibleHardwareLocationIds(admin, access.userId);

    const balanceQuery = admin
      .from('inventory_hardware_balances')
      .select(`
        id,
        hardware_item_id,
        location_id,
        quantity,
        location:inventory_locations(*)
      `)
      .gt('quantity', 0);

    const [{ data: items, error: itemsError }, { data: balances, error: balancesError }] = await Promise.all([
      itemQuery,
      balanceQuery,
    ]);

    if (itemsError) throw itemsError;
    if (balancesError) throw balancesError;

    const totals = new Map<string, number>();
    for (const balance of balances || []) {
      totals.set(
        balance.hardware_item_id,
        (totals.get(balance.hardware_item_id) || 0) + balance.quantity,
      );
    }

    return NextResponse.json({
      items: (items || []).map((item) => ({
        ...item,
        total_quantity: totals.get(item.id) || 0,
      })),
      balances: balances || [],
      responsible_location_ids: responsibleLocationIds || [],
    });
  } catch (error) {
    console.error('Error fetching Inventory Hardware:', error);
    return NextResponse.json({ error: 'Failed to fetch Hardware stock' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as CreateHardwareItemBody;
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: 'Hardware item name is required' }, { status: 400 });
    }

    const { data, error } = await createAdminClient()
      .from('inventory_hardware_items')
      .insert({
        name,
        created_by: access.userId,
        updated_by: access.userId,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A Hardware item with this name already exists' }, { status: 400 });
      }
      throw error;
    }

    return NextResponse.json({ item: { ...data, total_quantity: 0 } }, { status: 201 });
  } catch (error) {
    console.error('Error creating Inventory Hardware item:', error);
    return NextResponse.json({ error: 'Failed to create Hardware item' }, { status: 500 });
  }
}
