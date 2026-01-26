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

    // Fetch user's own error reports
    const { data: reports, error } = await supabase
      .from('error_reports')
      .select('*')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    const response: GetErrorReportsResponse = {
      success: true,
      reports: reports as ErrorReport[],
    };

    return NextResponse.json(response);

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
