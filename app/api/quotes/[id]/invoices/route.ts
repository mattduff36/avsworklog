import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { appendQuoteTimelineEvent, fetchQuoteBundle } from '@/lib/server/quote-workflow';

type InvoiceFieldErrors = Record<string, string>;

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
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const bundle = await fetchQuoteBundle(createAdminClient(), id);
    return NextResponse.json({ invoices: bundle.invoices, invoice_summary: bundle.invoiceSummary });
  } catch (error) {
    console.error('Error fetching quote invoices:', error);
    return NextResponse.json({ error: 'Unable to load invoices right now.' }, { status: 500 });
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

    const fieldErrors: InvoiceFieldErrors = {};
    const normalizedInvoiceNumber = typeof body.invoice_number === 'string' ? body.invoice_number.trim() : '';
    const normalizedComments = typeof body.comments === 'string' ? body.comments.trim() || null : null;
    const normalizedInvoiceDate = typeof body.invoice_date === 'string' && body.invoice_date.trim()
      ? body.invoice_date.trim()
      : new Date().toISOString().slice(0, 10);
    const normalizedAmount = typeof body.amount === 'number' ? body.amount : Number(body.amount);

    if (!normalizedInvoiceNumber) {
      fieldErrors.invoice_number = 'Enter an invoice number.';
    }

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      fieldErrors.amount = 'Enter an invoice amount greater than 0.';
    }

    if (!normalizedInvoiceDate) {
      fieldErrors.invoice_date = 'Enter an invoice date.';
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

    const bundleBeforeInsert = await fetchQuoteBundle(admin, id);
    if (!bundleBeforeInsert.quote.is_latest_version) {
      return NextResponse.json({ error: 'Only the latest quote version can be invoiced.' }, { status: 400 });
    }

    const remainingBalance = Number(bundleBeforeInsert.invoiceSummary.remainingBalance || 0);

    if (normalizedAmount - remainingBalance > 0.005) {
      return NextResponse.json(
        {
          error: 'Invoice amount cannot be more than the remaining balance. Create a new version first if the amount has increased.',
          field_errors: {
            amount: `This quote has £${remainingBalance.toLocaleString('en-GB', { minimumFractionDigits: 2 })} remaining.`,
          },
        },
        { status: 400 }
      );
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from('quote_invoices')
      .insert({
        quote_id: id,
        invoice_number: normalizedInvoiceNumber,
        invoice_date: normalizedInvoiceDate,
        amount: normalizedAmount,
        invoice_scope: body.invoice_scope || 'partial',
        comments: normalizedComments,
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

    const bundleAfterInsert = await fetchQuoteBundle(admin, id);
    const nextStatus = bundleAfterInsert.invoiceSummary.remainingBalance > 0 ? 'partially_invoiced' : 'invoiced';

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
    await appendQuoteTimelineEvent(admin, {
      quoteId: id,
      quoteThreadId: refreshedBundle.quote.quote_thread_id,
      quoteReference: refreshedBundle.quote.quote_reference,
      eventType: 'invoice_added',
      title: 'Invoice added',
      description: `${invoice.invoice_number} • £${Number(invoice.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
      fromStatus: bundleBeforeInsert.quote.status,
      toStatus: nextStatus,
      actorUserId: user.id,
      createdAt: invoice.created_at,
    });

    return NextResponse.json({
      invoices: refreshedBundle.invoices,
      invoice_summary: refreshedBundle.invoiceSummary,
    }, { status: 201 });
  } catch (error) {
    console.error('Error adding quote invoice:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to add this invoice right now.' },
      { status: 500 }
    );
  }
}
