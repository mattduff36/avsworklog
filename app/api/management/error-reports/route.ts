import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { GetAllErrorReportsResponse, ErrorReportWithUser, ErrorReportStatus } from '@/types/error-reports';

/**
 * GET /api/management/error-reports
 * Get all error reports (admin only)
 * Optional query params: status=new|investigating|resolved
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const profile = await getProfileWithRole(user.id);
    if (!profile?.role || (profile.role.name !== 'admin' && !profile.role.is_super_admin)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Get filter from query params
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status') as ErrorReportStatus | null;

    // Build query
    let query = supabase
      .from('error_reports')
      .select(`
        *,
        user:created_by(
          id,
          full_name
        )
      `)
      .order('created_at', { ascending: false });

    if (statusFilter && ['new', 'investigating', 'resolved'].includes(statusFilter)) {
      query = query.eq('status', statusFilter);
    }

    const { data: reports, error } = await query;

    if (error) {
      throw error;
    }

    // Calculate counts for all statuses
    const { data: allReports } = await supabase
      .from('error_reports')
      .select('status');

    const counts: Record<ErrorReportStatus | 'all', number> = {
      all: allReports?.length || 0,
      new: allReports?.filter(r => r.status === 'new').length || 0,
      investigating: allReports?.filter(r => r.status === 'investigating').length || 0,
      resolved: allReports?.filter(r => r.status === 'resolved').length || 0,
    };

    const response: GetAllErrorReportsResponse = {
      success: true,
      reports: reports as ErrorReportWithUser[],
      counts,
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in GET /api/management/error-reports:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/management/error-reports',
      additionalData: { endpoint: '/api/management/error-reports' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
