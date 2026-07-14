import { NextRequest, NextResponse } from 'next/server';
import type { Json } from '@/types/database';
import type { InventoryHardwareAdjustmentPayload } from '@/app/(dashboard)/inventory/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import {
  getHardwareDatabaseErrorMessage,
  isHardwareAdjustmentOperation,
  isHardwareAdjustmentReason,
  isValidHardwareQuantity,
} from '@/lib/server/inventory-hardware';

export async function POST(request: NextRequest) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as Partial<InventoryHardwareAdjustmentPayload>;
    if (!isHardwareAdjustmentOperation(body.operation_type)) {
      return NextResponse.json({ error: 'A valid Hardware adjustment operation is required' }, { status: 400 });
    }
    if (!isHardwareAdjustmentReason(body.reason)) {
      return NextResponse.json({ error: 'A valid Hardware adjustment reason is required' }, { status: 400 });
    }

    const note = body.note?.trim() || null;
    if (body.reason === 'Other' && !note) {
      return NextResponse.json({ error: 'A note is required when the reason is Other' }, { status: 400 });
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 500) {
      return NextResponse.json({ error: 'Provide between 1 and 500 Hardware adjustment lines' }, { status: 400 });
    }

    const allowZero = body.operation_type === 'recount';
    const seen = new Set<string>();
    for (const line of body.lines) {
      if (
        typeof line?.item_id !== 'string'
        || !line.item_id
        || typeof line.location_id !== 'string'
        || !line.location_id
        || !isValidHardwareQuantity(line.quantity, allowZero)
      ) {
        return NextResponse.json({ error: 'Every Hardware adjustment line is invalid' }, { status: 400 });
      }

      const lineKey = `${line.item_id}:${line.location_id}`;
      if (seen.has(lineKey)) {
        return NextResponse.json({ error: 'Duplicate Hardware item and location lines are not allowed' }, { status: 400 });
      }
      seen.add(lineKey);
    }

    const { data, error } = await createAdminClient().rpc('inventory_apply_hardware_adjustments', {
      p_operation_type: body.operation_type,
      p_reason: body.reason,
      p_note: note,
      p_lines: body.lines as unknown as Json,
      p_actor: access.userId,
    });

    if (error) {
      return NextResponse.json({ error: getHardwareDatabaseErrorMessage(error) }, { status: 400 });
    }

    return NextResponse.json({ success: true, batch_id: data });
  } catch (error) {
    console.error('Error applying Inventory Hardware adjustments:', error);
    return NextResponse.json({ error: 'Failed to update Hardware stock' }, { status: 500 });
  }
}
