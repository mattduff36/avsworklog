import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import type { GetErrorReportsResponse, ErrorReport } from '@/types/error-reports';

/**
 * GET /api/error-reports
 * Get current user's own error reports
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // Fetch user's own error reports
    const { data: reports, error } = await supabase
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
        updated_at
      `)
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    const response: GetErrorReportsResponse = {
      success: true,
      reports: reports as ErrorReport[],
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
    console.error('Error in GET /api/error-reports:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/error-reports',
      additionalData: { endpoint: '/api/error-reports' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
