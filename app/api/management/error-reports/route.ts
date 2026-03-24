import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { GetAllErrorReportsResponse, ErrorReportWithUser, ErrorReportStatus } from '@/types/error-reports';

type ErrorReportWithUserRow = Omit<ErrorReportWithUser, 'user'> & {
  user: Array<{ id: string; full_name: string | null }> | { id: string; full_name: string | null } | null;
};

function normalizeErrorReportUser(report: ErrorReportWithUserRow): ErrorReportWithUser {
  const rawUser = Array.isArray(report.user) ? report.user[0] || null : report.user;
  return {
    ...report,
    user: rawUser
      ? {
          id: rawUser.id,
          full_name: rawUser.full_name || 'Unknown',
        }
      : null,
  };
}

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

    const canAccessErrorReports = await canEffectiveRoleAccessModule('error-reports');
    if (!canAccessErrorReports) {
      return NextResponse.json({ error: 'Forbidden: error-reports access required' }, { status: 403 });
    }

    // Get filter from query params
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status') as ErrorReportStatus | null;
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // Build query
    let query = supabase
      .from('error_reports')
      .select(`
        id,
        created_by,
        title,
        description,
        error_code,
        page_url,
        user_agent,
        additional_context,
        status,
        admin_notes,
        resolved_at,
        resolved_by,
        notification_message_id,
        created_at,
        updated_at,
        user:created_by(
          id,
          full_name
        )
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (statusFilter && ['new', 'investigating', 'resolved'].includes(statusFilter)) {
      query = query.eq('status', statusFilter);
    }

    const [{ data: reports, error }, { data: allReports, error: countsError }] = await Promise.all([
      query,
      supabase.from('error_reports').select('status'),
    ]);

    if (error) {
      throw error;
    }

    if (countsError) {
      throw countsError;
    }

    const counts: Record<ErrorReportStatus | 'all', number> = {
      all: allReports?.length || 0,
      new: allReports?.filter((report) => report.status === 'new').length || 0,
      investigating: allReports?.filter((report) => report.status === 'investigating').length || 0,
      resolved: allReports?.filter((report) => report.status === 'resolved').length || 0,
    };

    const response: GetAllErrorReportsResponse = {
      success: true,
      reports: ((reports || []) as ErrorReportWithUserRow[]).map(normalizeErrorReportUser),
      counts,
    };

    return NextResponse.json({
      ...response,
      pagination: {
        offset,
        limit,
        has_more: (reports || []).length === limit,
      },
    });

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
