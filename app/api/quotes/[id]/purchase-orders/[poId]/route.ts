import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  fetchQuoteBundle,
  serializeQuoteBundle,
} from '@/lib/server/quote-workflow';
import {
  deleteQuotePurchaseOrderTransaction,
  updateQuotePurchaseOrderTransaction,
} from '@/lib/server/quote-purchase-orders';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { isEffectiveRoleManagerOrHigher } from '@/lib/utils/rbac';
import { canManageQuoteSage } from '@/lib/server/quote-sage-access';
import { PO_EDITABLE_STATUSES } from '@/app/(dashboard)/quotes/types';

type PoFieldErrors = Record<string, string>;

interface RouteParams {
  params: Promise<{ id: string; poId: string }>;
}

async function validateLineItemIds(
  admin: ReturnType<typeof createAdminClient>,
  quoteId: string,
  lineItemIds: string[]
): Promise<string | null> {
  if (lineItemIds.length === 0) return null;

  const { data, error } = await admin
    .from('quote_line_items')
    .select('id')
    .eq('quote_id', quoteId)
    .in('id', lineItemIds);

  if (error) throw error;

  const found = new Set((data || []).map(row => row.id));
  const missing = lineItemIds.filter(id => !found.has(id));
  if (missing.length > 0) {
    return 'One or more selected quote lines are invalid for this quote.';
  }
  return null;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, poId } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;
    if (!await isEffectiveRoleManagerOrHigher()) {
      return NextResponse.json(
        { error: 'Only managers and administrators can manage purchase orders.' },
        { status: 403 }
      );
    }

    const body = await request.json() as {
      po_number?: string;
      po_value?: number | null;
      notes?: string | null;
      line_item_ids?: string[];
    };

    const fieldErrors: PoFieldErrors = {};
    const hasPoNumber = Object.prototype.hasOwnProperty.call(body, 'po_number');
    const normalizedPoNumber = typeof body.po_number === 'string' ? body.po_number.trim() : '';
    const hasNotes = Object.prototype.hasOwnProperty.call(body, 'notes');
    const normalizedNotes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
    const hasPoValue = Object.prototype.hasOwnProperty.call(body, 'po_value');
    const rawPoValue = typeof body.po_value === 'number' ? body.po_value : Number(body.po_value);
    const normalizedPoValue = !hasPoValue || body.po_value === null || body.po_value === undefined
      ? null
      : rawPoValue;
    const hasLineItemIds = Array.isArray(body.line_item_ids);
    const lineItemIds = hasLineItemIds
      ? Array.from(new Set(body.line_item_ids!.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))))
      : [];

    if (hasPoNumber && !normalizedPoNumber) {
      fieldErrors.po_number = 'Enter a PO number.';
    } else if (normalizedPoNumber.length > 100) {
      fieldErrors.po_number = 'PO number must be 100 characters or fewer.';
    }

    if (hasPoValue && body.po_value !== null && body.po_value !== undefined && (!Number.isFinite(normalizedPoValue) || (normalizedPoValue ?? 0) < 0)) {
      fieldErrors.po_value = 'Enter a valid PO value.';
    }
    if (normalizedNotes && normalizedNotes.length > 2000) {
      fieldErrors.notes = 'Notes must be 2,000 characters or fewer.';
    }

    if (Object.keys(fieldErrors).length > 0) {
      return NextResponse.json(
        {
          error: 'Please correct the highlighted fields and try again.',
          field_errors: fieldErrors,
        },
        { status: 400 }
      );
    }

    const bundle = await fetchQuoteBundle(admin, id);
    if (!bundle.quote.is_latest_version) {
      return NextResponse.json({ error: 'Only the latest quote version can update purchase orders.' }, { status: 400 });
    }
    if (!bundle.quote.status || !PO_EDITABLE_STATUSES.has(bundle.quote.status)) {
      return NextResponse.json(
        { error: 'Purchase orders cannot be updated while the quote is in its current status.' },
        { status: 400 }
      );
    }

    const existing = bundle.purchaseOrders.find(order => order.id === poId);
    if (!existing) {
      return NextResponse.json({ error: 'Purchase order not found for this quote.' }, { status: 404 });
    }

    if (hasLineItemIds) {
      const lineValidationError = await validateLineItemIds(admin, bundle.quote.id, lineItemIds);
      if (lineValidationError) {
        return NextResponse.json({ error: lineValidationError }, { status: 400 });
      }
    }

    const now = new Date().toISOString();
    const finalPoNumber = hasPoNumber ? normalizedPoNumber : existing.po_number;
    const finalPoValue = hasPoValue ? normalizedPoValue : existing.po_value;
    const finalNotes = hasNotes ? normalizedNotes : existing.notes;
    const finalLineItemIds = hasLineItemIds
      ? lineItemIds
      : (existing.lines || [])
        .map(line => line.quote_line_item_id)
        .filter((lineId): lineId is string => Boolean(lineId));

    await updateQuotePurchaseOrderTransaction({
      quoteId: bundle.quote.id,
      quoteThreadId: bundle.quote.quote_thread_id,
      quoteReference: bundle.quote.quote_reference,
      actorUserId: user.id,
      purchaseOrderId: poId,
      poNumber: finalPoNumber,
      poValue: finalPoValue,
      notes: finalNotes,
      updatedAt: now,
      lineItemIds: finalLineItemIds,
    });

    const refreshed = await fetchQuoteBundle(admin, id);
    const canManageSage = await canManageQuoteSage();

    return NextResponse.json({
      purchase_order: refreshed.purchaseOrders.find(order => order.id === poId) || null,
      purchase_orders: refreshed.purchaseOrders,
      po_coverage: refreshed.poCoverage,
      quote: serializeQuoteBundle(refreshed, {
        canManageSage,
        canManagePurchaseOrders: true,
      }),
    });
  } catch (error) {
    console.error('Error updating quote purchase order:', error);
    return NextResponse.json({ error: 'Unable to update this purchase order right now.' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, poId } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;
    if (!await isEffectiveRoleManagerOrHigher()) {
      return NextResponse.json(
        { error: 'Only managers and administrators can manage purchase orders.' },
        { status: 403 }
      );
    }

    const bundle = await fetchQuoteBundle(admin, id);
    if (!bundle.quote.is_latest_version) {
      return NextResponse.json({ error: 'Only the latest quote version can delete purchase orders.' }, { status: 400 });
    }
    if (!bundle.quote.status || !PO_EDITABLE_STATUSES.has(bundle.quote.status)) {
      return NextResponse.json(
        { error: 'Purchase orders cannot be deleted while the quote is in its current status.' },
        { status: 400 }
      );
    }

    const existing = bundle.purchaseOrders.find(order => order.id === poId);
    if (!existing) {
      return NextResponse.json({ error: 'Purchase order not found for this quote.' }, { status: 404 });
    }

    const now = new Date().toISOString();
    await deleteQuotePurchaseOrderTransaction({
      quoteId: bundle.quote.id,
      quoteThreadId: bundle.quote.quote_thread_id,
      quoteReference: bundle.quote.quote_reference,
      actorUserId: user.id,
      purchaseOrderId: poId,
      deletedAt: now,
    });

    const refreshed = await fetchQuoteBundle(admin, id);
    const canManageSage = await canManageQuoteSage();

    return NextResponse.json({
      purchase_orders: refreshed.purchaseOrders,
      po_coverage: refreshed.poCoverage,
      quote: serializeQuoteBundle(refreshed, {
        canManageSage,
        canManagePurchaseOrders: true,
      }),
    });
  } catch (error) {
    console.error('Error deleting quote purchase order:', error);
    return NextResponse.json({ error: 'Unable to delete this purchase order right now.' }, { status: 500 });
  }
}
