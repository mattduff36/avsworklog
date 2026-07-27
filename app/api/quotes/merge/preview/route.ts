import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { isEffectiveRoleAdminOrSuper } from '@/lib/utils/rbac';
import { fetchQuoteBundle } from '@/lib/server/quote-workflow';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to preview a quote merge.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;
    if (!await isEffectiveRoleAdminOrSuper()) {
      return NextResponse.json({ error: 'Only administrators can merge live quotes.' }, { status: 403 });
    }

    const body = await request.json() as { quote_ids?: unknown };
    const quoteIds = Array.isArray(body.quote_ids)
      ? Array.from(new Set(body.quote_ids.filter((value): value is string => typeof value === 'string' && Boolean(value))))
      : [];
    if (quoteIds.length < 2) {
      return NextResponse.json({ error: 'Select at least two quotes to merge.' }, { status: 400 });
    }

    const bundles = await Promise.all(
      quoteIds.map(quoteId => fetchQuoteBundle(createAdminClient(), quoteId)),
    );
    const customerIds = new Set(bundles.map(bundle => bundle.quote.customer_id));
    const managerIds = new Set(bundles.map(bundle => bundle.quote.requester_id));
    if (customerIds.size !== 1 || managerIds.size !== 1 || managerIds.has(null)) {
      return NextResponse.json(
        { error: 'Quotes must have the same customer and manager.' },
        { status: 400 },
      );
    }

    return NextResponse.json({
      quotes: bundles.map(bundle => ({
        id: bundle.quote.id,
        reference: bundle.quote.base_quote_reference,
        total: Number(bundle.quote.total || 0),
        line_items: bundle.lineItems.map(item => ({
          description: item.description,
          quantity: Number(item.quantity),
          unit: item.unit,
          unit_rate: Number(item.unit_rate),
          line_total: Number(item.line_total),
        })),
        purchase_orders: bundle.purchaseOrders.map(order => ({
          po_number: order.po_number,
          po_value: order.po_value,
        })),
        rams_count: bundle.ramsDocuments.length,
        attachment_count: bundle.attachments.length,
        invoice_count: bundle.invoices.length,
        version_count: bundle.versions.length,
        sage_posted: Boolean(bundle.quote.sage_posted_at),
      })),
    });
  } catch (error) {
    console.error('Error previewing live quote merge:', error);
    return NextResponse.json({ error: 'Unable to preview this quote merge.' }, { status: 500 });
  }
}
