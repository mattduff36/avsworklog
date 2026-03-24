import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  calculateQuoteTotals,
  fetchQuoteBundle,
  generateQuoteReferenceForManager,
  getInitialsFromName,
  getInvoiceSummary,
  getQuoteManagerOption,
} from '@/lib/server/quote-workflow';

const QUOTE_STATUS_ORDER = [
  'draft',
  'pending_internal_approval',
  'changes_requested',
  'approved',
  'sent',
  'won',
  'lost',
  'ready_to_invoice',
  'po_received',
  'in_progress',
  'completed_part',
  'completed_full',
  'partially_invoiced',
  'invoiced',
  'closed',
] as const;

const WON_QUOTE_STATUSES = new Set([
  'won',
  'ready_to_invoice',
  'po_received',
  'in_progress',
  'completed_part',
  'completed_full',
  'partially_invoiced',
  'invoiced',
]);

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customer_id');
    const includeVersions = searchParams.get('include_versions') === 'true';
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 250);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    let query = supabase
      .from('quotes')
      .select(`
        *,
        customer:customers(
          id,
          company_name,
          short_name,
          contact_name,
          contact_email,
          address_line_1,
          address_line_2,
          city,
          county,
          postcode
        )
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (customerId) {
      query = query.eq('customer_id', customerId);
    }

    if (!includeVersions) {
      query = query.eq('is_latest_version', true);
    }

    let summaryQuery = supabase
      .from('quotes')
      .select('status, total');

    if (customerId) {
      summaryQuery = summaryQuery.eq('customer_id', customerId);
    }

    if (!includeVersions) {
      summaryQuery = summaryQuery.eq('is_latest_version', true);
    }

    const [{ data, error }, { data: summaryRows, error: summaryError }] = await Promise.all([
      query,
      summaryQuery,
    ]);
    if (error) throw error;
    if (summaryError) throw summaryError;

    const quotes = data || [];
    const quoteIds = quotes.map(quote => quote.id);

    const summaries = new Map<string, ReturnType<typeof getInvoiceSummary>>();
    if (quoteIds.length > 0) {
      const { data: invoices, error: invoiceError } = await supabase
        .from('quote_invoices')
        .select('quote_id, amount, invoice_date')
        .in('quote_id', quoteIds);

      if (invoiceError) {
        throw invoiceError;
      }

      const invoicesByQuoteId = new Map<string, Array<{ quote_id: string; amount: number; invoice_date: string | null }>>();
      (invoices || []).forEach((invoice) => {
        if (!invoicesByQuoteId.has(invoice.quote_id)) {
          invoicesByQuoteId.set(invoice.quote_id, []);
        }
        invoicesByQuoteId.get(invoice.quote_id)!.push(invoice);
      });

      for (const quote of quotes) {
        summaries.set(
          quote.id,
          getInvoiceSummary({
            total: Number(quote.total || 0),
            invoices: invoicesByQuoteId.get(quote.id) || [],
          })
        );
      }
    }

    const statusCounts = QUOTE_STATUS_ORDER.reduce<Record<string, number>>(
      (acc, status) => ({ ...acc, [status]: 0 }),
      { all: 0 }
    );
    let wonQuotes = 0;
    let wonValue = 0;

    (summaryRows || []).forEach((quote) => {
      statusCounts.all += 1;
      statusCounts[quote.status] = (statusCounts[quote.status] || 0) + 1;

      if (WON_QUOTE_STATUSES.has(quote.status)) {
        wonQuotes += 1;
        wonValue += Number(quote.total || 0);
      }
    });

    return NextResponse.json({
      quotes: quotes.map(quote => ({
        ...quote,
        invoice_summary: summaries.get(quote.id) || getInvoiceSummary({ total: Number(quote.total || 0), invoices: [] }),
      })),
      summary: {
        total_quotes: statusCounts.all,
        status_counts: statusCounts,
        won_quotes: wonQuotes,
        won_value: wonValue,
      },
      pagination: {
        offset,
        limit,
        has_more: quotes.length === limit,
      },
    });
  } catch (error) {
    console.error('Error fetching quotes:', error);
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      manager_profile_id,
      approver_profile_id,
      line_items,
      ...quoteData
    } = body as {
      manager_profile_id?: string;
      approver_profile_id?: string;
      requester_initials?: string;
      manager_name?: string;
      manager_email?: string;
      signoff_name?: string;
      signoff_title?: string;
      line_items?: Array<{ description?: string; quantity: number; unit?: string; unit_rate: number; sort_order?: number }>;
      [key: string]: unknown;
    };

    const managerProfileId = manager_profile_id || user.id;
    const managerOption = await getQuoteManagerOption(managerProfileId);

    const { data: managerProfile, error: managerProfileError } = await admin
      .from('profiles')
      .select('id, full_name')
      .eq('id', managerProfileId)
      .single();

    if (managerProfileError || !managerProfile) {
      throw managerProfileError || new Error('Unable to load manager profile');
    }

    const initials = managerOption?.initials
      || quoteData.requester_initials
      || getInitialsFromName(managerProfile.full_name || '');

    const { quoteReference } = await generateQuoteReferenceForManager({
      managerProfileId,
      fallbackInitials: initials,
    });

    const items = line_items || [];
    const totals = calculateQuoteTotals(items, Number(quoteData.vat_rate ?? 20));
    const quoteId = crypto.randomUUID();

    const insertPayload = {
      ...quoteData,
      id: quoteId,
      quote_reference: quoteReference,
      base_quote_reference: quoteReference,
      quote_thread_id: quoteId,
      parent_quote_id: null,
      revision_number: 0,
      revision_type: 'original',
      version_label: 'Original',
      requester_id: managerProfileId,
      requester_initials: initials,
      manager_name: quoteData.manager_name || managerOption?.profile?.full_name || managerProfile.full_name,
      manager_email: quoteData.manager_email || managerOption?.manager_email || null,
      approver_profile_id: approver_profile_id || managerOption?.approver_profile_id || null,
      signoff_name: quoteData.signoff_name || managerOption?.signoff_name || managerProfile.full_name,
      signoff_title: quoteData.signoff_title || managerOption?.signoff_title || null,
      subtotal: totals.subtotal,
      vat_rate: totals.vatRate,
      vat_amount: totals.vatAmount,
      total: totals.total,
      status: quoteData.status || 'draft',
      commercial_status: 'open',
      created_by: user.id,
      updated_by: user.id,
    };

    const { error: insertError } = await supabase.from('quotes').insert(insertPayload);
    if (insertError) throw insertError;

    if (items.length > 0) {
      const rows = items.map((item, index) => ({
        quote_id: quoteId,
        description: item.description || '',
        quantity: Number(item.quantity || 0),
        unit: item.unit || '',
        unit_rate: Number(item.unit_rate || 0),
        line_total: Math.round(Number(item.quantity || 0) * Number(item.unit_rate || 0) * 100) / 100,
        sort_order: item.sort_order ?? index,
      }));

      const { error: lineItemError } = await supabase.from('quote_line_items').insert(rows);
      if (lineItemError) throw lineItemError;
    }

    const bundle = await fetchQuoteBundle(admin, quoteId);
    return NextResponse.json({ quote: { ...bundle.quote, line_items: bundle.lineItems, invoice_summary: bundle.invoiceSummary } }, { status: 201 });
  } catch (error) {
    console.error('Error creating quote:', error);
    return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 });
  }
}
