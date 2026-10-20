import { createAdminClient } from '@/lib/supabase/admin';
import type { FinancialAdjustmentMutationResult } from '@/lib/server/quote-financial-adjustments';
import { appendQuoteTimelineEvent, createQuoteNotification } from '@/lib/server/quote-workflow';

function formatAdjustmentType(value: string) {
  return value
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export async function recordMutationActivity(
  result: FinancialAdjustmentMutationResult,
  actorUserId: string,
) {
  const admin = createAdminClient();
  const quote = result.workspace.quote;
  const adjustment = result.adjustment;
  const isReversal = adjustment.adjustment_type === 'reversal';
  const title = isReversal
    ? 'Financial adjustment reversed'
    : `${formatAdjustmentType(adjustment.adjustment_type)} recorded`;
  const amountText =
    adjustment.amount > 0
      ? ` Amount: £${adjustment.amount.toLocaleString('en-GB', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}.`
      : '';
  const description = `${adjustment.adjustment_number}: ${adjustment.reason}.${amountText}`;

  await appendQuoteTimelineEvent(admin, {
    quoteId: adjustment.quote_id,
    quoteThreadId: adjustment.quote_thread_id,
    quoteReference: quote.quote_reference,
    eventType: isReversal
      ? 'financial_adjustment_reversed'
      : 'financial_adjustment_recorded',
    title,
    description,
    fromStatus: result.statusFrom,
    toStatus: result.statusTo,
    actorUserId,
    createdAt: adjustment.created_at,
  });

  for (const request of result.cancelledRequests) {
    const version =
      result.workspace.versions.find((candidate) => candidate.id === request.quote_id) ||
      quote;
    await appendQuoteTimelineEvent(admin, {
      quoteId: request.quote_id,
      quoteThreadId: adjustment.quote_thread_id,
      quoteReference: version.quote_reference,
      eventType: 'invoice_request_auto_cancelled',
      title: 'Invoice request automatically cancelled',
      description: `${adjustment.adjustment_number} reduced the available value below this £${Number(
        request.requested_amount,
      ).toLocaleString('en-GB', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} request.`,
      fromStatus: version.status,
      toStatus: version.status,
      actorUserId,
    });
  }

  const recipientIds = Array.from(
    new Set(
      [
        quote.requester_id,
        ...result.cancelledRequests.map((request) => request.requested_by),
      ].filter(
        (value): value is string => Boolean(value) && value !== actorUserId,
      ),
    ),
  );
  if (recipientIds.length === 0) return;

  const cancellationText =
    result.cancelledRequests.length > 0
      ? ` ${result.cancelledRequests.length} pending invoice request${
          result.cancelledRequests.length === 1 ? ' was' : 's were'
        } automatically cancelled, newest first.`
      : '';

  try {
    await createQuoteNotification({
      senderId: actorUserId,
      recipientIds,
      subject: `${quote.quote_reference}: ${title}`,
      body: `${description}${cancellationText}`,
      createdVia: 'quote_financial_adjustment',
      sendEmail: true,
    });
  } catch (notificationError) {
    console.error(
      'Failed to notify quote manager about financial adjustment:',
      notificationError,
    );
  }
}

