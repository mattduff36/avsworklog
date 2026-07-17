import { NextRequest, NextResponse } from 'next/server';
import { renderToStream } from '@react-pdf/renderer';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { QuoteAdjustmentPDF } from '@/lib/pdf/quote-adjustment-pdf';
import { loadSquiresLogoDataUrl } from '@/lib/pdf/squires-logo';
import type { QuoteFinancialAdjustment } from '@/app/(dashboard)/quotes/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function safeFilename(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-');
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
      return NextResponse.json(
        { error: 'You must be signed in to view adjustment records.' },
        { status: 401 },
      );
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('quote_financial_adjustments')
      .select(
        '*, actor:profiles!quote_financial_adjustments_created_by_fkey(id, full_name)',
      )
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Adjustment record not found.' },
        { status: 404 },
      );
    }

    const adjustment = {
      ...data,
      amount: Number(data.amount || 0),
    } as unknown as QuoteFinancialAdjustment;
    const document = QuoteAdjustmentPDF({
      adjustment,
      logoSrc: await loadSquiresLogoDataUrl(),
    });
    const stream = await renderToStream(document);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return new NextResponse(new Uint8Array(Buffer.concat(chunks)), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeFilename(
          adjustment.adjustment_number,
        )}-adjustment-record.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Error generating adjustment record PDF:', error);
    return NextResponse.json(
      { error: 'Unable to generate the adjustment record right now.' },
      { status: 500 },
    );
  }
}
