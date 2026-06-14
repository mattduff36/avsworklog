import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import {
  JOB_NUMBER_REGEX,
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

interface QuoteJobCodeCustomer {
  status: string | null;
  company_name: string | null;
}

interface QuoteJobCodeRow {
  base_quote_reference: string | null;
  quote_reference: string | null;
  subject_line: string | null;
  project_description: string | null;
  site_address: string | null;
  customer: QuoteJobCodeCustomer | QuoteJobCodeCustomer[] | null;
}

interface LegacyQuoteJobCodeRow {
  quote_reference: string | null;
  customer_name: string | null;
  title: string | null;
}

interface ProjectNumberJobCodeRow {
  project_reference: string | null;
  title: string | null;
  description: string | null;
}

interface TimesheetJobCodeOption {
  value: string;
  label: string;
  customerName: string | null;
  quoteTitle: string | null;
  source: 'live_quote' | 'legacy_quote' | 'project_number';
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

function optionMatchesQuery(option: TimesheetJobCodeOption, query: string): boolean {
  if (!query) return true;

  const normalizedJobCodeQuery = normalizeJobNumberInput(query).toLowerCase();
  const haystack = [
    option.value,
    option.customerName,
    option.quoteTitle,
  ].filter(Boolean).join(' ').toLowerCase();

  return haystack.includes(query) || Boolean(normalizedJobCodeQuery && option.value.toLowerCase().includes(normalizedJobCodeQuery));
}

function getQuoteCustomer(row: QuoteJobCodeRow): QuoteJobCodeCustomer | null {
  if (Array.isArray(row.customer)) return row.customer[0] || null;
  return row.customer;
}

function addOption(
  options: TimesheetJobCodeOption[],
  seen: Set<string>,
  option: TimesheetJobCodeOption,
  query: string
) {
  if (!optionMatchesQuery(option, query)) return;
  if (seen.has(option.value)) return;

  seen.add(option.value);
  options.push(option);
}

function mapJobCodeRowsToOptions(
  rows: QuoteJobCodeRow[],
  legacyRows: LegacyQuoteJobCodeRow[],
  projectRows: ProjectNumberJobCodeRow[],
  query: string
): TimesheetJobCodeOption[] {
  const normalizedQuery = normalizeSearchQuery(query);
  const seen = new Set<string>();
  const options: TimesheetJobCodeOption[] = [];

  for (const row of rows) {
    const reference = normalizeJobNumberInput(row.base_quote_reference || row.quote_reference || '');
    if (!QUOTE_JOB_NUMBER_REGEX.test(reference)) continue;
    const customer = getQuoteCustomer(row);

    addOption(
      options,
      seen,
      {
        value: reference,
        label: reference,
        customerName: customer?.company_name || null,
        quoteTitle: row.subject_line || row.project_description || row.site_address || null,
        source: 'live_quote',
      },
      normalizedQuery
    );
  }

  for (const row of legacyRows) {
    const reference = normalizeJobNumberInput(row.quote_reference || '');
    if (!JOB_NUMBER_REGEX.test(reference)) continue;

    addOption(
      options,
      seen,
      {
        value: reference,
        label: reference,
        customerName: row.customer_name || null,
        quoteTitle: row.title || null,
        source: 'legacy_quote',
      },
      normalizedQuery
    );
  }

  for (const row of projectRows) {
    const reference = normalizeJobNumberInput(row.project_reference || '');
    if (!QUOTE_JOB_NUMBER_REGEX.test(reference)) continue;

    addOption(
      options,
      seen,
      {
        value: reference,
        label: reference,
        customerName: 'Project number',
        quoteTitle: row.title || row.description || null,
        source: 'project_number',
      },
      normalizedQuery
    );
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
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '2000', 10) || 2000, 1), 2500);
    const query = searchParams.get('q') || '';

    const [quoteResult, legacyQuoteResult, projectNumberResult] = await Promise.all([
      admin
        .from('quotes')
        .select(`
          base_quote_reference,
          quote_reference,
          subject_line,
          project_description,
          site_address,
          customer:customers!inner(status, company_name)
        `)
        .eq('is_latest_version', true)
        .eq('commercial_status', 'open')
        .in('status', SENT_ONWARDS_QUOTE_STATUSES)
        .eq('customer.status', 'active')
        .order('base_quote_reference', { ascending: true })
        .limit(limit),
      admin
        .from('legacy_quotes')
        .select('quote_reference, customer_name, title')
        .not('quote_reference', 'is', null)
        .order('quote_reference', { ascending: true })
        .limit(limit),
      admin
        .from('quote_project_numbers')
        .select('project_reference, title, description')
        .eq('status', 'open')
        .order('project_reference', { ascending: true })
        .limit(limit),
    ]);

    if (quoteResult.error) throw quoteResult.error;
    if (legacyQuoteResult.error) throw legacyQuoteResult.error;
    if (projectNumberResult.error) throw projectNumberResult.error;

    return NextResponse.json({
      job_codes: mapJobCodeRowsToOptions(
        (quoteResult.data || []) as QuoteJobCodeRow[],
        (legacyQuoteResult.data || []) as LegacyQuoteJobCodeRow[],
        (projectNumberResult.data || []) as ProjectNumberJobCodeRow[],
        query
      ),
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
