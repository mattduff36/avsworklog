import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { canManageQuoteSage } from '@/lib/server/quote-sage-access';
import { FINANCIAL_ADJUSTMENT_SEARCH_MIN_LENGTH } from '@/app/(dashboard)/quotes/types';
import {
  createFinancialAdjustment,
  fetchQuoteFinancialWorkspace,
  reverseFinancialAdjustment,
  searchQuoteFinancialRecords,
  type CreateFinancialAdjustmentInput,
  type FinancialAdjustmentMutationResult,
  type ReverseFinancialAdjustmentInput,
} from '@/lib/server/quote-financial-adjustments';
import {
  appendQuoteTimelineEvent,
  createQuoteNotification,
} from '@/lib/server/quote-workflow';

async function requireFinancialAdjustmentContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      response: NextResponse.json(
        { error: 'You must be signed in to use quote financial adjustments.' },
        { status: 401 },
      ),
      userId: null,
      canManage: false,
    };
  }

  const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
  if (sensitiveAccessResponse) {
    return {
      response: sensitiveAccessResponse,
      userId: user.id,
      canManage: false,
    };
  }

  return {
    response: null,
    userId: user.id,
    canManage: await canManageQuoteSage(),
  };
}

function formatAdjustmentType(value: string) {
  return value
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

async function recordMutationActivity(
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

export async function GET(request: NextRequest) {
  try {
    const context = await requireFinancialAdjustmentContext();
    if (context.response) return context.response;

    const quoteId = request.nextUrl.searchParams.get('quote_id');
    if (quoteId) {
      return NextResponse.json({
        workspace: await fetchQuoteFinancialWorkspace(
          quoteId,
          context.canManage,
        ),
      });
    }

    const query = (request.nextUrl.searchParams.get('q') || '').trim();
    if (query.length < FINANCIAL_ADJUSTMENT_SEARCH_MIN_LENGTH) {
      return NextResponse.json(
        {
          error: `Enter at least ${FINANCIAL_ADJUSTMENT_SEARCH_MIN_LENGTH} characters to search the financial adjustment ledger.`,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      results: await searchQuoteFinancialRecords(query),
      can_manage: context.canManage,
    });
  } catch (error) {
    console.error('Error loading quote financial adjustments:', error);
    return NextResponse.json(
      { error: 'Unable to load quote financial adjustments right now.' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireFinancialAdjustmentContext();
    if (context.response) return context.response;
    if (!context.canManage || !context.userId) {
      return NextResponse.json(
        { error: 'Only Accounts or admin users can record financial adjustments.' },
        { status: 403 },
      );
    }

    const body = (await request.json()) as
      | ({ action?: 'create' } & CreateFinancialAdjustmentInput)
      | ({ action: 'reverse' } & ReverseFinancialAdjustmentInput);
    const result =
      body.action === 'reverse'
        ? await reverseFinancialAdjustment(body, context.userId)
        : await createFinancialAdjustment(body, context.userId);

    await recordMutationActivity(result, context.userId);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Error recording quote financial adjustment:', error);
    const typedError = error as Error & {
      code?: string;
      financial_summary?: unknown;
    };
    return NextResponse.json(
      {
        error:
          typedError.message || 'Unable to record this financial adjustment.',
        code: typedError.code,
        financial_summary: typedError.financial_summary,
      },
      {
        status:
          typedError.code === 'VARIANCE_CONFIRMATION_REQUIRED' ? 409 : 400,
      },
    );
  }
}
