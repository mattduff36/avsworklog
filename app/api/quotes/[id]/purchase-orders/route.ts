import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  appendQuoteTimelineEvent,
  fetchQuoteBundle,
} from '@/lib/server/quote-workflow';
import {
  buildQuotePoCoverageSummary,
  listQuotePurchaseOrders,
  replacePurchaseOrderLineLinks,
  syncQuotePoRollup,
} from '@/lib/server/quote-purchase-orders';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';

type PoFieldErrors = Record<string, string>;

interface RouteParams {
  params: Promise<{ id: string }>;
}

function formatMoney(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`;
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

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const admin = createAdminClient();
    const bundle = await fetchQuoteBundle(admin, id);
    const purchaseOrders = await listQuotePurchaseOrders(admin, bundle.quote.quote_thread_id);
    const poCoverage = buildQuotePoCoverageSummary({
      quoteTotal: Number(bundle.quote.total || 0),
      lineItemIds: bundle.lineItems.map(item => item.id),
      purchaseOrders,
    });

    return NextResponse.json({
      purchase_orders: purchaseOrders,
      po_coverage: poCoverage,
    });
  } catch (error) {
    console.error('Error fetching quote purchase orders:', error);
    return NextResponse.json({ error: 'Unable to load purchase orders right now.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
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

    const body = await request.json() as {
      po_number?: string;
      po_value?: number | null;
      notes?: string | null;
      line_item_ids?: string[];
    };

    const fieldErrors: PoFieldErrors = {};
    const normalizedPoNumber = typeof body.po_number === 'string' ? body.po_number.trim() : '';
    const normalizedNotes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
    const hasPoValue = body.po_value !== null && body.po_value !== undefined && `${body.po_value}`.trim() !== '';
    const rawPoValue = typeof body.po_value === 'number' ? body.po_value : Number(body.po_value);
    const normalizedPoValue = hasPoValue ? rawPoValue : null;
    const lineItemIds = Array.isArray(body.line_item_ids)
      ? Array.from(new Set(body.line_item_ids.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))))
      : [];

    if (!normalizedPoNumber) {
      fieldErrors.po_number = 'Enter a PO number.';
    }

    if (normalizedPoValue !== null && (!Number.isFinite(normalizedPoValue) || normalizedPoValue < 0)) {
      fieldErrors.po_value = 'Enter a valid PO value.';
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
      return NextResponse.json({ error: 'Only the latest quote version can record purchase orders.' }, { status: 400 });
    }

    const lineValidationError = await validateLineItemIds(admin, bundle.quote.id, lineItemIds);
    if (lineValidationError) {
      return NextResponse.json({ error: lineValidationError }, { status: 400 });
    }

    const now = new Date().toISOString();
    const { data: inserted, error: insertError } = await admin
      .from('quote_purchase_orders')
      .insert({
        quote_thread_id: bundle.quote.quote_thread_id,
        quote_id: bundle.quote.id,
        po_number: normalizedPoNumber,
        po_value: normalizedPoValue,
        received_at: now,
        notes: normalizedNotes,
        created_by: user.id,
      })
      .select('*')
      .single();

    if (insertError || !inserted) {
      throw insertError || new Error('Unable to create purchase order.');
    }

    await replacePurchaseOrderLineLinks(admin, inserted.id, lineItemIds);
    await syncQuotePoRollup(admin, bundle.quote.quote_thread_id, user.id);

    await appendQuoteTimelineEvent(admin, {
      quoteId: bundle.quote.id,
      quoteThreadId: bundle.quote.quote_thread_id,
      quoteReference: bundle.quote.quote_reference,
      eventType: 'po_details_saved',
      title: 'PO added',
      description: [
        `PO: ${normalizedPoNumber}`,
        formatMoney(normalizedPoValue) ? `Value: ${formatMoney(normalizedPoValue)}` : null,
        lineItemIds.length > 0 ? `Covers ${lineItemIds.length} quote line(s)` : null,
      ].filter(Boolean).join(' • '),
      actorUserId: user.id,
      createdAt: now,
    });

    const purchaseOrders = await listQuotePurchaseOrders(admin, bundle.quote.quote_thread_id);
    const refreshed = await fetchQuoteBundle(admin, id);
    const poCoverage = buildQuotePoCoverageSummary({
      quoteTotal: Number(refreshed.quote.total || 0),
      lineItemIds: refreshed.lineItems.map(item => item.id),
      purchaseOrders,
    });

    return NextResponse.json({
      purchase_order: purchaseOrders.find(order => order.id === inserted.id) || null,
      purchase_orders: purchaseOrders,
      po_coverage: poCoverage,
      quote: {
        ...refreshed.quote,
        purchase_orders: purchaseOrders,
        po_coverage: poCoverage,
        purchase_order_count: purchaseOrders.length,
      },
    });
  } catch (error) {
    console.error('Error creating quote purchase order:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save this purchase order right now.' },
      { status: 500 }
    );
  }
}
