import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildVersionLabel,
  buildVersionReference,
  calculateQuoteTotals,
  createQuoteNotification,
  fetchQuoteBundle,
  sendQuoteApprovalRequestEmail,
  sendQuoteRamsRequestEmail,
  sendQuoteToCustomerEmail,
} from '@/lib/server/quote-workflow';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const bundle = await fetchQuoteBundle(admin, id);

    return NextResponse.json({
      quote: {
        ...bundle.quote,
        line_items: bundle.lineItems,
        attachments: bundle.attachments,
        invoices: bundle.invoices,
        versions: bundle.versions,
        invoice_summary: bundle.invoiceSummary,
      },
    });
  } catch (error) {
    console.error('Error fetching quote:', error);
    return NextResponse.json({ error: 'Failed to fetch quote' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, line_items, ...quoteUpdates } = body as {
      action?: string;
      line_items?: Array<{ description?: string; quantity: number; unit?: string; unit_rate: number; sort_order?: number }>;
      revision_type?: 'revision' | 'extra' | 'variation' | 'future_work' | 'duplicate';
      version_notes?: string;
      return_comments?: string;
      po_number?: string | null;
      po_value?: number | null;
      completion_comments?: string | null;
      completion_status?: 'approved_in_full' | 'approved_in_part';
      start_date?: string | null;
      start_alert_days?: number | null;
      [key: string]: unknown;
    };

    const current = await fetchQuoteBundle(admin, id);

    if (action === 'submit_for_approval') {
      const updates = {
        status: 'pending_internal_approval',
        updated_by: user.id,
        return_comments: null,
      };

      const { error } = await supabase.from('quotes').update(updates).eq('id', id);
      if (error) throw error;

      if (current.quote.approver_profile_id) {
        const { data: approver } = await admin
          .from('profiles')
          .select('id, full_name')
          .eq('id', current.quote.approver_profile_id)
          .single();

        const approverAuth = approver?.id
          ? await admin.auth.admin.getUserById(approver.id)
          : null;
        const approverEmail = approverAuth?.data?.user?.email || null;

        if (approver?.id) {
          await createQuoteNotification({
            senderId: user.id,
            recipientIds: [approver.id],
            subject: `Quote approval required: ${current.quote.quote_reference}`,
            body: `${current.quote.manager_name || 'A manager'} submitted ${current.quote.quote_reference} for approval.`,
          });
        }

        if (approverEmail) {
          await sendQuoteApprovalRequestEmail({
            approverEmail,
            managerName: current.quote.manager_name || 'A manager',
            quoteReference: current.quote.quote_reference,
            customerName: current.quote.customer?.company_name || 'Unknown customer',
            subjectLine: current.quote.subject_line || 'No subject provided',
          });
        }
      }
    } else if (action === 'return_for_changes') {
      const { error } = await supabase
        .from('quotes')
        .update({
          status: 'changes_requested',
          returned_at: new Date().toISOString(),
          return_comments: quoteUpdates.return_comments || null,
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;

      if (current.quote.requester_id) {
        await createQuoteNotification({
          senderId: user.id,
          recipientIds: [current.quote.requester_id],
          subject: `Quote returned: ${current.quote.quote_reference}`,
          body: String(quoteUpdates.return_comments || 'This quote has been returned for changes.'),
        });
      }
    } else if (action === 'approve_and_send') {
      const emailResult = await sendQuoteToCustomerEmail(current, [
        current.quote.manager_email || '',
        'rob@avsquires.co.uk',
        'charlotte@avsquires.co.uk',
      ]);

      if (!emailResult.success) {
        return NextResponse.json({ error: emailResult.error || 'Failed to send quote email' }, { status: 500 });
      }

      const now = new Date().toISOString();
      const { error } = await supabase
        .from('quotes')
        .update({
          status: 'sent',
          approved_by: user.id,
          approved_at: now,
          sent_at: now,
          customer_sent_at: now,
          customer_sent_by: user.id,
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;
    } else if (action === 'mark_po_received') {
      const now = new Date().toISOString();
      const poNumber = quoteUpdates.po_number || current.quote.po_number;

      const { error } = await supabase
        .from('quotes')
        .update({
          status: 'po_received',
          po_number: poNumber,
          po_value: quoteUpdates.po_value ?? current.quote.po_value,
          po_received_at: now,
          rams_requested_at: now,
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;

      await sendQuoteRamsRequestEmail({
        quoteReference: current.quote.quote_reference,
        customerName: current.quote.customer?.company_name || 'Unknown customer',
        subjectLine: current.quote.subject_line || 'No subject provided',
        poNumber: String(poNumber || 'Not supplied'),
        managerName: current.quote.manager_name || 'Unknown manager',
      });
    } else if (action === 'set_job_schedule') {
      const nextStatus = current.quote.status === 'po_received' ? 'in_progress' : current.quote.status;
      const { error } = await supabase
        .from('quotes')
        .update({
          start_date: quoteUpdates.start_date || null,
          start_alert_days: quoteUpdates.start_alert_days ?? null,
          status: nextStatus,
          started: Boolean(quoteUpdates.start_date),
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;
    } else if (action === 'mark_complete') {
      const completionStatus = quoteUpdates.completion_status || 'approved_in_full';
      const status = completionStatus === 'approved_in_part' ? 'completed_part' : 'completed_full';

      const { error } = await supabase
        .from('quotes')
        .update({
          status,
          completion_status: completionStatus,
          completion_comments: quoteUpdates.completion_comments || null,
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;
    } else if (action === 'toggle_closed') {
      const nextCommercialStatus = current.quote.commercial_status === 'closed' ? 'open' : 'closed';
      const { error } = await supabase
        .from('quotes')
        .update({
          commercial_status: nextCommercialStatus,
          closed_at: nextCommercialStatus === 'closed' ? new Date().toISOString() : null,
          status: nextCommercialStatus === 'closed' ? 'closed' : current.quote.status,
          updated_by: user.id,
        })
        .eq('id', id);

      if (error) throw error;
    } else if (action === 'create_revision' || action === 'duplicate') {
      const revisionType = action === 'duplicate' ? 'duplicate' : (quoteUpdates.revision_type || 'revision');
      const nextRevisionNumber = current.quote.revision_number + 1;
      const newQuoteId = crypto.randomUUID();
      const isDuplicate = action === 'duplicate';
      const baseReference = isDuplicate ? buildVersionReference(current.quote.base_quote_reference, 'duplicate', nextRevisionNumber) : current.quote.base_quote_reference;
      const quoteReference = isDuplicate
        ? baseReference
        : buildVersionReference(current.quote.base_quote_reference, revisionType, nextRevisionNumber);

      const insertPayload = {
        ...current.quote,
        id: newQuoteId,
        quote_reference: quoteReference,
        base_quote_reference: isDuplicate ? quoteReference : current.quote.base_quote_reference,
        quote_thread_id: isDuplicate ? newQuoteId : current.quote.quote_thread_id,
        parent_quote_id: current.quote.id,
        revision_number: isDuplicate ? 0 : nextRevisionNumber,
        revision_type: revisionType,
        version_label: isDuplicate ? 'Original' : buildVersionLabel(revisionType, nextRevisionNumber),
        version_notes: quoteUpdates.version_notes || null,
        is_latest_version: true,
        duplicate_source_quote_id: current.quote.id,
        status: 'draft',
        return_comments: null,
        returned_at: null,
        approved_at: null,
        approved_by: null,
        sent_at: null,
        customer_sent_at: null,
        customer_sent_by: null,
        po_number: null,
        po_value: null,
        po_received_at: null,
        rams_requested_at: null,
        started: false,
        start_alert_sent_at: null,
        completion_status: 'not_completed',
        completion_comments: null,
        commercial_status: 'open',
        closed_at: null,
        invoice_number: null,
        invoice_notes: null,
        last_invoice_at: null,
        accepted: false,
        accepted_at: null,
        invoiced_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: user.id,
        updated_by: user.id,
      };

      delete (insertPayload as { customer?: unknown }).customer;

      const { error: insertError } = await supabase.from('quotes').insert(insertPayload);
      if (insertError) throw insertError;

      if (!isDuplicate) {
        const { error: previousVersionError } = await supabase
          .from('quotes')
          .update({ is_latest_version: false, updated_by: user.id })
          .eq('quote_thread_id', current.quote.quote_thread_id)
          .neq('id', newQuoteId);

        if (previousVersionError) throw previousVersionError;
      }

      if (current.lineItems.length > 0) {
        const { error: lineError } = await supabase.from('quote_line_items').insert(
          current.lineItems.map((item, index) => ({
            quote_id: newQuoteId,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unit_rate: item.unit_rate,
            line_total: item.line_total,
            sort_order: item.sort_order ?? index,
          }))
        );

        if (lineError) throw lineError;
      }

      const bundle = await fetchQuoteBundle(admin, newQuoteId);
      return NextResponse.json({
        quote: {
          ...bundle.quote,
          line_items: bundle.lineItems,
          attachments: bundle.attachments,
          invoices: bundle.invoices,
          versions: bundle.versions,
          invoice_summary: bundle.invoiceSummary,
        },
      });
    } else {
      const updates = { ...quoteUpdates, updated_by: user.id } as Record<string, unknown>;

      if (line_items) {
        const totals = calculateQuoteTotals(line_items, Number(updates.vat_rate ?? current.quote.vat_rate ?? 20));
        updates.subtotal = totals.subtotal;
        updates.vat_rate = totals.vatRate;
        updates.vat_amount = totals.vatAmount;
        updates.total = totals.total;
      }

      const { error } = await supabase.from('quotes').update(updates).eq('id', id);
      if (error) throw error;

      if (line_items) {
        const { error: deleteLineItemsError } = await supabase
          .from('quote_line_items')
          .delete()
          .eq('quote_id', id);
        if (deleteLineItemsError) throw deleteLineItemsError;

        if (line_items.length > 0) {
          const rows = line_items.map((item, index) => ({
            quote_id: id,
            description: item.description || '',
            quantity: Number(item.quantity || 0),
            unit: item.unit || '',
            unit_rate: Number(item.unit_rate || 0),
            line_total: Math.round(Number(item.quantity || 0) * Number(item.unit_rate || 0) * 100) / 100,
            sort_order: item.sort_order ?? index,
          }));

          const { error: lineInsertError } = await supabase.from('quote_line_items').insert(rows);
          if (lineInsertError) throw lineInsertError;
        }
      }
    }

    const bundle = await fetchQuoteBundle(admin, id);
    return NextResponse.json({
      quote: {
        ...bundle.quote,
        line_items: bundle.lineItems,
        attachments: bundle.attachments,
        invoices: bundle.invoices,
        versions: bundle.versions,
        invoice_summary: bundle.invoiceSummary,
      },
    });
  } catch (error) {
    console.error('Error updating quote:', error);
    return NextResponse.json({ error: 'Failed to update quote' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await supabase.from('quotes').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting quote:', error);
    return NextResponse.json({ error: 'Failed to delete quote' }, { status: 500 });
  }
}
