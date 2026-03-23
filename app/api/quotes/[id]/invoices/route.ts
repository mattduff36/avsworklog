import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchQuoteBundle } from '@/lib/server/quote-workflow';

interface RouteParams {
  params: Promise<{ id: string }>;
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const bundle = await fetchQuoteBundle(createAdminClient(), id);
    return NextResponse.json({ invoices: bundle.invoices, invoice_summary: bundle.invoiceSummary });
  } catch (error) {
    console.error('Error fetching quote invoices:', error);
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as {
      invoice_number?: string;
      invoice_date?: string;
      amount?: number;
      invoice_scope?: 'full' | 'partial';
      comments?: string;
      allocations?: Array<{
        quote_line_item_id?: string | null;
        quantity_invoiced?: number | null;
        amount_invoiced: number;
        comments?: string | null;
      }>;
    };

    if (!body.invoice_number || !body.amount) {
      return NextResponse.json({ error: 'Invoice number and amount are required' }, { status: 400 });
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from('quote_invoices')
      .insert({
        quote_id: id,
        invoice_number: body.invoice_number,
        invoice_date: body.invoice_date || new Date().toISOString().slice(0, 10),
        amount: body.amount,
        invoice_scope: body.invoice_scope || 'partial',
        comments: body.comments || null,
        created_by: user.id,
      })
      .select()
      .single();

    if (invoiceError || !invoice) throw invoiceError;

    if (body.allocations?.length) {
      const { error: allocationError } = await supabase
        .from('quote_invoice_allocations')
        .insert(
          body.allocations.map(allocation => ({
            quote_invoice_id: invoice.id,
            quote_line_item_id: allocation.quote_line_item_id || null,
            quantity_invoiced: allocation.quantity_invoiced ?? null,
            amount_invoiced: allocation.amount_invoiced,
            comments: allocation.comments || null,
          }))
        );

      if (allocationError) throw allocationError;
    }

    const bundle = await fetchQuoteBundle(admin, id);
    const nextStatus = bundle.invoiceSummary.remainingBalance > 0 ? 'partially_invoiced' : 'invoiced';

    const { error: quoteUpdateError } = await supabase
      .from('quotes')
      .update({
        status: nextStatus,
        invoice_number: invoice.invoice_number,
        invoice_notes: invoice.comments,
        last_invoice_at: invoice.invoice_date,
        invoiced_at: nextStatus === 'invoiced' ? new Date().toISOString() : null,
        updated_by: user.id,
      })
      .eq('id', id);

    if (quoteUpdateError) {
      // Best-effort compensation: remove the invoice we just created so the quote
      // does not end up with invoice rows but unchanged status metadata.
      await admin
        .from('quote_invoices')
        .delete()
        .eq('id', invoice.id);

      throw quoteUpdateError;
    }

    const refreshedBundle = await fetchQuoteBundle(admin, id);
    return NextResponse.json({
      invoices: refreshedBundle.invoices,
      invoice_summary: refreshedBundle.invoiceSummary,
    }, { status: 201 });
  } catch (error) {
    console.error('Error adding quote invoice:', error);
    return NextResponse.json({ error: 'Failed to add invoice' }, { status: 500 });
  }
}
