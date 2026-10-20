import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { canManageQuoteSage } from '@/lib/server/quote-sage-access';
import { FINANCIAL_ADJUSTMENT_SEARCH_MIN_LENGTH } from '@/app/(dashboard)/quotes/types';
import {
  createFinancialAdjustment,
  fetchQuoteFinancialWorkspace,
  reverseFinancialAdjustment,
  searchQuoteFinancialRecords,
  type CreateFinancialAdjustmentInput,
  type ReverseFinancialAdjustmentInput,
} from '@/lib/server/quote-financial-adjustments';
import { recordMutationActivity } from '@/lib/server/quote-financial-activity';

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
