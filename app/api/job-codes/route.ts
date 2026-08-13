import { NextRequest, NextResponse } from 'next/server';
import { listJobCatalogueOptions, loadJobCatalogueRecords } from '@/lib/server/job-catalogue';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccess = (
      await canEffectiveRoleAccessModule('daily-allocation')
      || await canEffectiveRoleAccessModule('plant-inspections')
      || await canEffectiveRoleAccessModule('timesheets')
    );
    if (!canAccess) {
      return NextResponse.json({ error: 'Job catalogue access required' }, { status: 403 });
    }

    const query = request.nextUrl.searchParams.get('q') || '';
    const records = await loadJobCatalogueRecords();
    return NextResponse.json({ job_codes: listJobCatalogueOptions(records, query) });
  } catch (error) {
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/job-codes',
      additionalData: { endpoint: 'GET /api/job-codes' },
    });
    return NextResponse.json({ error: 'Unable to load job codes right now.' }, { status: 500 });
  }
}
