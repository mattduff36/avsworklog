import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { logServerError } from '@/lib/utils/server-error-logger';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to view legacy quotes.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 250);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const { data, error } = await supabase
      .from('legacy_quotes')
      .select(`
        id,
        source_row,
        quote_reference,
        customer_name,
        title,
        quote_date,
        quote_date_raw,
        quote_manager_name,
        quote_manager_initials,
        quote_value_text,
        quote_value_amount,
        comments,
        created_at,
        updated_at
      `)
      .order('quote_date', { ascending: false, nullsFirst: false })
      .order('source_row', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const legacyQuotes = data || [];

    return NextResponse.json({
      legacy_quotes: legacyQuotes,
      pagination: {
        offset,
        limit,
        has_more: legacyQuotes.length === limit,
      },
    });
  } catch (error) {
    console.error('Error fetching legacy quotes:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/quotes/legacy',
      additionalData: { endpoint: 'GET /api/quotes/legacy' },
    });

    return NextResponse.json({ error: 'Unable to load legacy quotes right now.' }, { status: 500 });
  }
}
