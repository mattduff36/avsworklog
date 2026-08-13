import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { listJobCatalogueOptions, loadJobCatalogueRecords } from '@/lib/server/job-catalogue';

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
    const query = request.nextUrl.searchParams.get('q') || '';
    const records = await loadJobCatalogueRecords(admin);
    const options = listJobCatalogueOptions(records, query);
    const seen = new Set<string>();
    const job_codes = options.filter((option) => {
      if (seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    }).map((option) => ({
      value: option.value,
      label: option.label,
      customerName: option.customerName,
      quoteTitle: option.quoteTitle,
      source: option.source,
    }));

    return NextResponse.json({ job_codes });
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
