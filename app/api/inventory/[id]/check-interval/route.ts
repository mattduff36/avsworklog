import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { withEnrichedInventoryLocation } from '@/lib/server/inventory-locations';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface UpdateCheckIntervalBody {
  check_interval_days?: number | null;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as UpdateCheckIntervalBody;
    const intervalDays = body.check_interval_days;

    if (intervalDays !== null && intervalDays !== undefined) {
      if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 3650) {
        return NextResponse.json({ error: 'Check interval must be between 1 and 3650 days' }, { status: 400 });
      }
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('inventory_items')
      .update({
        check_interval_days: intervalDays || null,
        updated_by: access.userId,
      })
      .eq('id', id)
      .select(`
        *,
        location:inventory_locations(*)
      `)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 });
      }
      throw error;
    }

    const item = await withEnrichedInventoryLocation(admin, data);
    return NextResponse.json({ item });
  } catch (error) {
    console.error('Error updating inventory check interval:', error);
    return NextResponse.json({ error: 'Failed to update check interval' }, { status: 500 });
  }
}
