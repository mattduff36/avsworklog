import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import {
  QUOTE_JOB_NUMBER_REGEX,
  normalizeJobNumberInput,
} from '@/lib/utils/timesheet-job-codes';

const SENT_ONWARDS_QUOTE_STATUSES = [
  'sent',
  'won',
  'ready_to_invoice',
  'po_received',
  'in_progress',
  'completed_part',
  'completed_full',
  'partially_invoiced',
  'invoiced',
] as const;

interface QuoteJobCodeRow {
  base_quote_reference: string | null;
  quote_reference: string | null;
}

interface TimesheetJobCodeOption {
  value: string;
  label: string;
}

function mapQuoteRowsToJobCodeOptions(
  rows: QuoteJobCodeRow[],
  query: string
): TimesheetJobCodeOption[] {
  const normalizedQuery = normalizeJobNumberInput(query).toLowerCase();
  const seen = new Set<string>();
  const options: TimesheetJobCodeOption[] = [];

  for (const row of rows) {
    const reference = normalizeJobNumberInput(row.base_quote_reference || row.quote_reference || '');
    if (!QUOTE_JOB_NUMBER_REGEX.test(reference)) continue;
    if (normalizedQuery && !reference.toLowerCase().includes(normalizedQuery)) continue;
    if (seen.has(reference)) continue;

    seen.add(reference);
    options.push({ value: reference, label: reference });
  }

  return options;
}

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

    const canAccessTimesheets = await canEffectiveRoleAccessModule('timesheets');
    if (!canAccessTimesheets) {
      return NextResponse.json({ error: 'Timesheets access required' }, { status: 403 });
    }

    const admin = createAdminClient();
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '500', 10) || 500, 1), 500);
    const query = searchParams.get('q') || '';

    const { data, error } = await admin
      .from('quotes')
      .select(`
        base_quote_reference,
        quote_reference,
        customer:customers!inner(status)
      `)
      .eq('is_latest_version', true)
      .eq('commercial_status', 'open')
      .in('status', SENT_ONWARDS_QUOTE_STATUSES)
      .eq('customer.status', 'active')
      .order('base_quote_reference', { ascending: true })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({
      job_codes: mapQuoteRowsToJobCodeOptions((data || []) as QuoteJobCodeRow[], query),
    });
  } catch (error) {
    console.error('Error fetching timesheet job codes:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/timesheets/job-codes',
      additionalData: { endpoint: 'GET /api/timesheets/job-codes' },
    });

    return NextResponse.json({ error: 'Unable to load job codes right now.' }, { status: 500 });
  }
}
