import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { canManageQuoteSage } from '@/lib/server/quote-sage-access';
import { fetchQuoteBundle } from '@/lib/server/quote-workflow';
import { createFinancialAdjustment } from '@/lib/server/quote-financial-adjustments';
import { recordMutationActivity } from '@/lib/server/quote-financial-activity';
import { isIsoDate } from '@/lib/external-documents/validation';

export const creditEntrySchema = z.object({
  credited_invoice_id: z.string().uuid('Choose the original invoice.'),
  invoice_number: z.string().trim().min(1, 'Enter the credit note number.').max(120),
  invoice_date: z.string().refine(isIsoDate, 'Enter a valid credit date.'),
  amount: z.number().finite().negative().min(-999999999).refine(
    value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001,
    'Use no more than two decimal places.',
  ),
  comments: z.string().trim().min(1, 'Enter the reason for the credit.').max(4000),
  invoice_request_id: z.undefined(),
  invoice_scope: z.enum(['full', 'partial']).optional(),
  confirm_matches_request: z.undefined(),
  confirm_variance: z.boolean().optional(),
  merge_billing_scope: z.enum(['single', 'combined', 'source']).optional(),
  merge_source_thread_ids: z.array(z.string().uuid()).max(100).optional(),
}).strict();

// Called after the invoice route's session/module/PIN checks.
export async function recordNegativeInvoice(quoteId: string, body: unknown, actorUserId: string) {
  if (!await canManageQuoteSage()) {
    return NextResponse.json({ error: 'Only Accounts or admin users can record credit notes.' }, { status: 403 });
  }
  const parsed = creditEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please correct the highlighted credit note fields.',
      field_errors: Object.fromEntries(parsed.error.issues.map(issue => [issue.path[0], issue.message])),
    }, { status: 400 });
  }
  const input = parsed.data;
  const bundle = await fetchQuoteBundle(createAdminClient(), quoteId);
  const invoice = bundle.invoices.find(candidate => candidate.id === input.credited_invoice_id);
  if (!invoice) {
    return NextResponse.json({ error: 'Choose an invoice belonging to this quote.' }, { status: 400 });
  }
  let result;
  try {
    result = await createFinancialAdjustment({
      quote_id: invoice.quote_id,
      invoice_id: invoice.id,
      adjustment_type: 'credit_note',
      amount: Math.abs(input.amount),
      effective_date: input.invoice_date,
      reason: input.comments,
      external_reference: input.invoice_number,
      confirm_variance: input.confirm_variance,
    }, actorUserId, { creditEntry: true });
  } catch (error) {
    if ((error as { code?: string }).code === 'VARIANCE_CONFIRMATION_REQUIRED') {
      return NextResponse.json({ error: 'The revised balances have a reconciliation variance. Review the financial summary and confirm to record this credit.', code: 'VARIANCE_CONFIRMATION_REQUIRED' }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : '';
    const expected = /^(Choose an active invoice|The credit exceeds|This credit note reference|Enter |Select |The selected invoice|Draft quotes)/.test(message);
    return NextResponse.json({ error: expected ? message : 'Unable to record this credit note. Check the ledger before retrying.' }, { status: expected ? 400 : 500 });
  }
  // The ledger is committed: an activity failure must not invite duplicate entry.
  let warning: string | undefined;
  try { await recordMutationActivity(result, actorUserId); }
  catch { warning = 'Credit saved; its timeline activity could not be recorded.'; }
  return NextResponse.json({ ...result, entry_type: 'credit_note', warning }, { status: 201 });
}
