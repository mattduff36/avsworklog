import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { ERROR_REPORT_STATUS_LABELS } from '@/types/error-reports';
import type { 
  GetErrorReportDetailResponse, 
  UpdateErrorReportRequest,
  UpdateErrorReportResponse,
  ErrorReportWithUser,
  ErrorReportUpdateWithUser
} from '@/types/error-reports';

/**
 * GET /api/management/error-reports/[id]
 * Get error report details with update history (admin only)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Fetch error report
    const { data: report, error: reportError } = await supabase
      .from('error_reports')
      .select(`
        *,
        user:created_by(
          id,
          full_name
        )
      `)
      .eq('id', id)
      .single();

    if (reportError || !report) {
      return NextResponse.json({ error: 'Error report not found' }, { status: 404 });
    }

    // Fetch update history
    const { data: updates, error: updatesError } = await supabase
      .from('error_report_updates')
      .select(`
        *,
        user:created_by(
          id,
          full_name
        )
      `)
      .eq('error_report_id', id)
      .order('created_at', { ascending: false });

    if (updatesError) {
      console.error('Error fetching updates:', updatesError);
    }

    const response: GetErrorReportDetailResponse = {
      success: true,
      report: report as ErrorReportWithUser,
      updates: (updates || []) as ErrorReportUpdateWithUser[],
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in GET /api/management/error-reports/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/management/error-reports/[id]',
      additionalData: { endpoint: '/api/management/error-reports/[id]' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}

/**
 * PATCH /api/management/error-reports/[id]
 * Update error report status/notes and create update history (admin only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Parse request body
    const body: UpdateErrorReportRequest = await request.json();
    const { status, admin_notes, note } = body;

    // Fetch current report
    const { data: currentReport, error: fetchError } = await supabase
      .from('error_reports')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !currentReport) {
      return NextResponse.json({ error: 'Error report not found' }, { status: 404 });
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    
    if (status !== undefined) {
      updateData.status = status;
      
      // If marking as resolved, record who resolved it and when
      if (status === 'resolved') {
        updateData.resolved_at = new Date().toISOString();
        updateData.resolved_by = user.id;
      }
    }
    
    if (admin_notes !== undefined) {
      updateData.admin_notes = admin_notes;
    }

    // Update error report
    const { data: updatedReport, error: updateError } = await supabase
      .from('error_reports')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating report:', updateError);
      throw updateError;
    }

    // Create update history entry if status changed or note provided
    const statusChanged = status && status !== currentReport.status;
    if (statusChanged || note) {
      const { error: historyError } = await supabase
        .from('error_report_updates')
        .insert({
          error_report_id: id,
          created_by: user.id,
          old_status: currentReport.status,
          new_status: status || currentReport.status,
          note: note || undefined,
        });

      if (historyError) {
        console.error('Error creating update history:', historyError);
      }
    }

    // Send in-app notification to the reporter when status changes
    if (statusChanged && currentReport.created_by) {
      try {
        const adminSupabase = createAdminClient();
        const oldLabel = ERROR_REPORT_STATUS_LABELS[currentReport.status as keyof typeof ERROR_REPORT_STATUS_LABELS] || currentReport.status;
        const newLabel = ERROR_REPORT_STATUS_LABELS[status as keyof typeof ERROR_REPORT_STATUS_LABELS] || status;
        const reportTitle = currentReport.title?.substring(0, 60) || 'Your error report';

        const subject = `Error Report Updated to ${newLabel}`;
        const bodyParts = [
          `Your error report "${reportTitle}" has been updated.`,
          '',
          `Status: ${oldLabel} → ${newLabel}`,
          '',
        ];
        if (note) bodyParts.push(`Admin note: ${note}`, '');
        bodyParts.push('---', 'Tip: You can view your reports on the Help page.');

        const { data: message, error: msgError } = await adminSupabase
          .from('messages')
          .insert({
            type: 'NOTIFICATION',
            priority: 'HIGH',
            subject,
            body: bodyParts.join('\n'),
            sender_id: user.id,
          })
          .select()
          .single();

        if (msgError) throw msgError;

        const { error: recipientError } = await adminSupabase
          .from('message_recipients')
          .insert({
            message_id: message.id,
            user_id: currentReport.created_by,
            status: 'PENDING',
          });

        if (recipientError) throw recipientError;
      } catch (notifyError) {
        console.error('Failed to send status-change notification to reporter:', notifyError);
      }
    }

    const response: UpdateErrorReportResponse = {
      success: true,
      report: updatedReport,
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in PATCH /api/management/error-reports/[id]:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/management/error-reports/[id]',
      additionalData: { endpoint: '/api/management/error-reports/[id]' },
    });

    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
}
