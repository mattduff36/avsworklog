import { NextRequest, NextResponse } from 'next/server';
import type { Json } from '@/types/database';
import type { InventoryHardwareTransferPayload } from '@/app/(dashboard)/inventory/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess } from '@/lib/server/inventory-auth';
import {
  getHardwareDatabaseErrorMessage,
  getResponsibleHardwareLocationIds,
  isValidHardwareQuantity,
} from '@/lib/server/inventory-hardware';

export async function POST(request: NextRequest) {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as Partial<InventoryHardwareTransferPayload>;
    if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 500) {
      return NextResponse.json({ error: 'Provide between 1 and 500 Hardware transfer lines' }, { status: 400 });
    }

    const seen = new Set<string>();
    for (const line of body.lines) {
      if (
        typeof line?.item_id !== 'string'
        || !line.item_id
        || typeof line.from_location_id !== 'string'
        || !line.from_location_id
        || typeof line.to_location_id !== 'string'
        || !line.to_location_id
        || !isValidHardwareQuantity(line.quantity)
      ) {
        return NextResponse.json({ error: 'Every Hardware transfer line is invalid' }, { status: 400 });
      }
      if (line.from_location_id === line.to_location_id) {
        return NextResponse.json({ error: 'Hardware transfer locations must be different' }, { status: 400 });
      }

      const lineKey = `${line.item_id}:${line.from_location_id}:${line.to_location_id}`;
      if (seen.has(lineKey)) {
        return NextResponse.json({ error: 'Duplicate Hardware transfer lines are not allowed' }, { status: 400 });
      }
      seen.add(lineKey);
    }

    const admin = createAdminClient();
    if (!access.isManagerOrAdmin) {
      const responsibleLocationIds = new Set(
        await getResponsibleHardwareLocationIds(admin, access.userId),
      );
      const hasUnauthorizedLocation = body.lines.some((line) => (
        !responsibleLocationIds.has(line.from_location_id)
        || !responsibleLocationIds.has(line.to_location_id)
      ));
      if (hasUnauthorizedLocation) {
        return NextResponse.json(
          { error: 'Employees can transfer Hardware only between their responsible locations' },
          { status: 403 },
        );
      }
    }

    const { data, error } = await admin.rpc('inventory_transfer_hardware_stock', {
      p_lines: body.lines as unknown as Json,
      p_note: body.note?.trim() || null,
      p_actor: access.userId,
    });

    if (error) {
      return NextResponse.json({ error: getHardwareDatabaseErrorMessage(error) }, { status: 400 });
    }

    return NextResponse.json({ success: true, batch_id: data });
  } catch (error) {
    console.error('Error transferring Inventory Hardware:', error);
    return NextResponse.json({ error: 'Failed to transfer Hardware stock' }, { status: 500 });
  }
}
