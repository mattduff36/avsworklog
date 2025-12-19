import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToStream } from '@react-pdf/renderer';
import { TimesheetPDF } from '@/lib/pdf/timesheet-pdf';
import { getProfileWithRole } from '@/lib/utils/permissions';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Get the current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch timesheet with entries
    const { data: timesheet, error: timesheetError } = await supabase
      .from('timesheets')
      .select(`
        *,
        entries:timesheet_entries(*)
      `)
      .eq('id', id)
      .single();

    if (timesheetError || !timesheet) {
      return NextResponse.json({ error: 'Timesheet not found' }, { status: 404 });
    }

    // Check authorization - user must be owner, manager, or admin
    const profile = await getProfileWithRole(user.id);

    const isOwner = timesheet.user_id === user.id;
    const isManager = profile?.role?.is_manager_admin || false;

    if (!isOwner && !isManager) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get employee name from profiles table (full_name is the correct field)
    const { data: employee, error: employeeError } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', timesheet.user_id)
      .single();

    if (employeeError) {
      console.error('Error fetching employee details:', employeeError);
    }

    const employeeName = employee?.full_name || null;

    console.log('PDF Generation Debug:', {
      timesheetId: id,
      userId: timesheet.user_id,
      employeeName,
      hasEmployee: !!employee,
      employeeError: employeeError?.message
    });

    // Generate PDF
    const stream = await renderToStream(
      TimesheetPDF({
        timesheet,
        employeeName: employeeName,
        employeeEmail: undefined,
      })
    );

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Return PDF
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="timesheet-${id}.pdf"`,
      },
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}

