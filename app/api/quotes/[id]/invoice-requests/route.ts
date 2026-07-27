import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  appendQuoteTimelineEvent,
  createQuoteNotification,
  fetchQuoteBundle,
  getQuoteAccountsRecipientIds,
} from '@/lib/server/quote-workflow';
import { buildInvoiceRequestTimelineDescription } from '@/lib/quotes/quote-timeline-comments';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { buildQuoteDisplayName } from '@/lib/quotes/quote-display-name';
import { renderConfiguredQuoteEmailTemplate } from '@/lib/server/quote-email-templates';
import { allocateMergeBillingAmount } from '@/lib/server/quote-merge-resolution';

type InvoiceRequestFieldErrors = Record<string, string>;

interface RouteParams {
  params: Promise<{ id: string }>;
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
      requested_amount?: number;
      requested_invoice_date?: string;
      requested_invoice_scope?: 'full' | 'partial';
      manager_comments?: string;
      merge_billing_scope?: 'single' | 'combined' | 'source';
      merge_source_thread_ids?: string[];
    };

    const fieldErrors: InvoiceRequestFieldErrors = {};
    const normalizedAmount = typeof body.requested_amount === 'number'
      ? body.requested_amount
      : Number(body.requested_amount);
    const normalizedDate = typeof body.requested_invoice_date === 'string' && body.requested_invoice_date.trim()
      ? body.requested_invoice_date.trim()
      : new Date().toISOString().slice(0, 10);
    const normalizedScope = body.requested_invoice_scope === 'full' ? 'full' : 'partial';
    const normalizedComments = typeof body.manager_comments === 'string'
      ? body.manager_comments.trim() || null
      : null;
    const normalizedMergeBillingScope = body.merge_billing_scope === 'source'
      ? 'source'
      : body.merge_billing_scope === 'combined'
        ? 'combined'
        : 'single';
    const normalizedMergeSourceThreadIds = Array.isArray(body.merge_source_thread_ids)
      ? Array.from(new Set(body.merge_source_thread_ids.filter((value): value is string => typeof value === 'string' && Boolean(value))))
      : [];

    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      fieldErrors.requested_amount = 'Enter an invoice request amount greater than 0.';
    }

    if (!normalizedDate) {
      fieldErrors.requested_invoice_date = 'Enter the requested invoice date.';
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
    if (
      bundle.mergeInfo
      && bundle.mergeInfo.survivor_quote_thread_id !== bundle.quote.quote_thread_id
    ) {
      return NextResponse.json(
        { error: `This quote was merged into ${bundle.mergeInfo.canonical_reference || 'the retained quote'}. Open the retained quote to request an invoice.` },
        { status: 400 },
      );
    }
    if (!bundle.quote.is_latest_version) {
      return NextResponse.json({ error: 'Only the latest quote version can be marked ready to invoice.' }, { status: 400 });
    }
    const validMergeThreadIds = new Set(bundle.mergeInfo?.members.map(member => member.quote_thread_id) || []);
    if (!bundle.mergeInfo && normalizedMergeBillingScope !== 'single') {
      return NextResponse.json({ error: 'Combined/source invoicing is only available for merged quotes.' }, { status: 400 });
    }
    if (
      normalizedMergeBillingScope === 'source'
      && (
        normalizedMergeSourceThreadIds.length === 0
        || normalizedMergeSourceThreadIds.some(threadId => !validMergeThreadIds.has(threadId))
      )
    ) {
      return NextResponse.json({ error: 'Choose at least one valid merged quote source to invoice.' }, { status: 400 });
    }

    const selectedSourceAvailable = normalizedMergeBillingScope === 'source'
      ? normalizedMergeSourceThreadIds.reduce((total, threadId) => (
          total + Number(
            bundle.mergeSourceFinancialSummaries[threadId]?.available_to_request || 0,
          )
        ), 0)
      : null;
    const groupAvailableToRequest = Number(
      bundle.financialSummary?.available_to_request
      ?? bundle.invoiceSummary.availableToRequest
      ?? 0,
    );
    const availableToRequest = selectedSourceAvailable === null
      ? groupAvailableToRequest
      : Math.min(selectedSourceAvailable, groupAvailableToRequest);
    if (availableToRequest <= 0.005) {
      return NextResponse.json(
        {
          error: 'There is no remaining balance available to request.',
          field_errors: {
            requested_amount: 'Existing invoices or pending requests already cover this quote balance.',
          },
        },
        { status: 400 }
      );
    }

    if (normalizedAmount - availableToRequest > 0.005) {
      return NextResponse.json(
        {
          error: 'Invoice request amount cannot be more than the available balance.',
          field_errors: {
            requested_amount: `This quote has £${availableToRequest.toLocaleString('en-GB', { minimumFractionDigits: 2 })} available to request.`,
          },
        },
        { status: 400 }
      );
    }

    if (normalizedScope === 'full' && Math.abs(normalizedAmount - availableToRequest) > 0.005) {
      return NextResponse.json(
        {
          error: 'A full invoice request must match the available balance.',
          field_errors: {
            requested_amount: `Full invoice request must be £${availableToRequest.toLocaleString('en-GB', { minimumFractionDigits: 2 })}.`,
          },
        },
        { status: 400 }
      );
    }

    if (normalizedScope === 'partial' && normalizedAmount >= availableToRequest - 0.005) {
      return NextResponse.json(
        {
          error: 'Use full invoice scope when requesting the full remaining balance.',
          field_errors: {
            requested_invoice_scope: 'Select full invoice for the remaining balance.',
          },
        },
        { status: 400 }
      );
    }

    const recipientIds = await getQuoteAccountsRecipientIds(admin, user.id);
    if (recipientIds.length === 0) {
      return NextResponse.json(
        { error: 'No quote invoice notification recipients have been configured.' },
        { status: 400 }
      );
    }

    const { data: invoiceRequest, error: insertError } = await supabase
      .from('quote_invoice_requests')
      .insert({
        quote_id: id,
        requested_amount: normalizedAmount,
        requested_invoice_date: normalizedDate,
        requested_invoice_scope: normalizedScope,
        manager_comments: normalizedComments,
        requested_by: user.id,
        merge_billing_scope: bundle.mergeInfo ? normalizedMergeBillingScope : 'single',
        merge_source_thread_ids: normalizedMergeBillingScope === 'source'
          ? normalizedMergeSourceThreadIds
          : [],
      })
      .select()
      .single();

    if (insertError || !invoiceRequest) {
      throw insertError || new Error('Unable to create invoice request');
    }

    if (bundle.mergeInfo) {
      const sourceThreadIds = normalizedMergeBillingScope === 'source'
        ? normalizedMergeSourceThreadIds
        : bundle.mergeInfo.members.map(member => member.quote_thread_id);
      const capacities = Object.fromEntries(sourceThreadIds.map(threadId => [
        threadId,
        Number(bundle.mergeSourceFinancialSummaries[threadId]?.available_to_request || 0),
      ]));
      const sourceAllocations = allocateMergeBillingAmount(
        normalizedAmount,
        sourceThreadIds,
        capacities,
      );
      const sourceLimits = Object.fromEntries(sourceThreadIds.map(threadId => [
        threadId,
        Number(bundle.mergeSourceFinancialSummaries[threadId]?.adjusted_quote_value || 0),
      ]));
      const { error: sourceAllocationError } = await admin.rpc(
        'reserve_quote_billing_sources',
        {
          p_parent_type: 'request',
          p_parent_id: invoiceRequest.id,
          p_allocations: sourceAllocations,
          p_source_capacities: sourceLimits,
          p_exclude_request_id: null,
        },
      );
      if (sourceAllocationError) {
        await admin.from('quote_invoice_requests').delete().eq('id', invoiceRequest.id);
        throw sourceAllocationError;
      }
    }

    try {
      const notificationTemplate = await renderConfiguredQuoteEmailTemplate(admin, 'invoice_request', {
        quote_reference: bundle.quote.quote_reference,
        quote_name: buildQuoteDisplayName(bundle.quote),
        customer_name: bundle.quote.customer?.company_name || 'Unknown customer',
        invoice_amount: `£${normalizedAmount.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
        invoice_date: normalizedDate,
        invoice_scope: normalizedScope === 'full' ? 'Full invoice' : 'Partial invoice',
        invoice_comments: normalizedComments || '',
        invoice_comments_block: normalizedComments ? `Comments: ${normalizedComments}` : '',
      });
      await createQuoteNotification({
        senderId: user.id,
        recipientIds,
        subject: notificationTemplate.subject,
        body: notificationTemplate.bodyText,
        sendEmail: true,
        emailCcType: 'quote_invoice_request_copy',
      });
    } catch (error) {
      await admin
        .from('quote_invoice_requests')
        .delete()
        .eq('id', invoiceRequest.id);

      throw error;
    }

    const notifiedAt = new Date().toISOString();
    const { error: notifiedError } = await admin
      .from('quote_invoice_requests')
      .update({ notified_at: notifiedAt })
      .eq('id', invoiceRequest.id);

    if (notifiedError) {
      console.error('Failed to mark invoice request as notified:', notifiedError);
    }

    const refreshedBundle = await fetchQuoteBundle(admin, id);
    await appendQuoteTimelineEvent(admin, {
      quoteId: id,
      quoteThreadId: bundle.quote.quote_thread_id,
      quoteReference: bundle.quote.quote_reference,
      eventType: 'invoice_requested',
      title: 'Ready to invoice',
      description: buildInvoiceRequestTimelineDescription({
        requestedScope: normalizedScope,
        requestedAmount: normalizedAmount,
        comments: normalizedComments,
      }),
      fromStatus: bundle.quote.status,
      toStatus: bundle.quote.status,
      actorUserId: user.id,
      createdAt: invoiceRequest.requested_at,
    });

    return NextResponse.json({
      invoice_request: refreshedBundle.invoiceRequests.find(item => item.id === invoiceRequest.id) || invoiceRequest,
      invoice_requests: refreshedBundle.invoiceRequests,
      invoice_summary: refreshedBundle.invoiceSummary,
      financial_summary: refreshedBundle.financialSummary,
      financial_adjustments: refreshedBundle.financialAdjustments,
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating quote invoice request:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to mark this quote ready to invoice right now.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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
      invoice_request_id?: string;
      action?: 'cancel';
    };
    const invoiceRequestId = typeof body.invoice_request_id === 'string' ? body.invoice_request_id.trim() : '';

    if (!invoiceRequestId || body.action !== 'cancel') {
      return NextResponse.json({ error: 'Select a pending invoice request to retract.' }, { status: 400 });
    }

    const bundle = await fetchQuoteBundle(admin, id);
    if (
      bundle.mergeInfo
      && bundle.mergeInfo.survivor_quote_thread_id !== bundle.quote.quote_thread_id
    ) {
      return NextResponse.json(
        { error: `This quote was merged into ${bundle.mergeInfo.canonical_reference || 'the retained quote'}. Open the retained quote to change invoice requests.` },
        { status: 400 },
      );
    }
    if (!bundle.quote.is_latest_version) {
      return NextResponse.json({ error: 'Only the latest quote version can have invoice requests retracted.' }, { status: 400 });
    }

    const invoiceRequest = bundle.invoiceRequests.find(request => request.id === invoiceRequestId);
    if (!invoiceRequest) {
      return NextResponse.json({ error: 'Invoice request not found for this quote.' }, { status: 404 });
    }

    if (invoiceRequest.status !== 'pending' || invoiceRequest.fulfilled_invoice_id) {
      return NextResponse.json({ error: 'Only unprocessed pending invoice requests can be retracted.' }, { status: 400 });
    }

    const { error: updateError } = await supabase
      .from('quote_invoice_requests')
      .update({ status: 'cancelled' })
      .eq('id', invoiceRequest.id)
      .eq('quote_id', id)
      .eq('status', 'pending');

    if (updateError) {
      throw updateError;
    }

    const refreshedBundle = await fetchQuoteBundle(admin, id);
    await appendQuoteTimelineEvent(admin, {
      quoteId: id,
      quoteThreadId: bundle.quote.quote_thread_id,
      quoteReference: bundle.quote.quote_reference,
      eventType: 'invoice_request_cancelled',
      title: 'Invoice request retracted',
      description: `Retracted ${invoiceRequest.requested_invoice_scope} invoice request • £${Number(invoiceRequest.requested_amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`,
      fromStatus: bundle.quote.status,
      toStatus: bundle.quote.status,
      actorUserId: user.id,
    });

    return NextResponse.json({
      invoice_requests: refreshedBundle.invoiceRequests,
      invoice_summary: refreshedBundle.invoiceSummary,
      financial_summary: refreshedBundle.financialSummary,
      financial_adjustments: refreshedBundle.financialAdjustments,
    });
  } catch (error) {
    console.error('Error retracting quote invoice request:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to retract this invoice request right now.' },
      { status: 500 }
    );
  }
}
