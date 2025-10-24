import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { 
  generateExcelFile, 
  formatExcelDate, 
  formatExcelHours, 
  formatExcelStatus
} from '@/lib/utils/excel';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is manager or admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || !['admin', 'manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    // Build query for approved timesheets only
    let query = supabase
      .from('timesheets')
      .select(`
        id,
        week_ending,
        submitted_at,
        reviewed_at,
        user_id,
        employee:profiles!timesheets_user_id_fkey (
          id,
          full_name,
          employee_id
        ),
        timesheet_entries (
          day_of_week,
          time_started,
          time_finished,
          daily_total,
          working_in_yard,
          did_not_work,
          job_number
        )
      `)
      .eq('status', 'approved')
      .order('week_ending', { ascending: false });

    // Apply filters
    if (dateFrom) {
      query = query.gte('week_ending', dateFrom);
    }
    if (dateTo) {
      query = query.lte('week_ending', dateTo);
    }

    const { data: timesheets, error } = await query;

    if (error) {
      console.error('Error fetching timesheets:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!timesheets || timesheets.length === 0) {
      return NextResponse.json({ error: 'No approved timesheets found for the specified criteria' }, { status: 404 });
    }

    // Transform data for Excel - Payroll format
    const excelData: any[] = [];

    timesheets.forEach((timesheet: any) => {
      const employee = timesheet.employee;
      const entries = timesheet.timesheet_entries || [];

      // Calculate total hours and regular/overtime breakdown
      const totalHours = entries.reduce((sum: number, entry: any) => {
        return sum + (entry.did_not_work ? 0 : (entry.daily_total || 0));
      }, 0);

      // Assuming standard 40 hour week, anything over is overtime
      const regularHours = Math.min(totalHours, 40);
      const overtimeHours = Math.max(0, totalHours - 40);

      excelData.push({
        'Employee Name': employee?.full_name || 'Unknown',
        'Employee ID': employee?.employee_id || '-',
        'Week Ending': formatExcelDate(timesheet.week_ending),
        'Regular Hours': formatExcelHours(regularHours),
        'Overtime Hours': formatExcelHours(overtimeHours),
        'Total Hours': formatExcelHours(totalHours),
        'Approved Date': formatExcelDate(timesheet.reviewed_at),
      });
    });

    // Add summary totals
    const totalRegular = excelData.reduce((sum, row) => sum + (parseFloat(row['Regular Hours']) || 0), 0);
    const totalOvertime = excelData.reduce((sum, row) => sum + (parseFloat(row['Overtime Hours']) || 0), 0);
    const totalHours = excelData.reduce((sum, row) => sum + (parseFloat(row['Total Hours']) || 0), 0);

    excelData.push({
      'Employee Name': '',
      'Employee ID': '',
      'Week Ending': '',
      'Regular Hours': '',
      'Overtime Hours': '',
      'Total Hours': '',
      'Approved Date': '',
    });

    excelData.push({
      'Employee Name': 'TOTALS',
      'Employee ID': `${timesheets.length} timesheets`,
      'Week Ending': '',
      'Regular Hours': totalRegular.toFixed(2),
      'Overtime Hours': totalOvertime.toFixed(2),
      'Total Hours': totalHours.toFixed(2),
      'Approved Date': '',
    });

    // Generate Excel file
    const buffer = generateExcelFile([
      {
        sheetName: 'Payroll Report',
        columns: [
          { header: 'Employee Name', key: 'Employee Name', width: 20 },
          { header: 'Employee ID', key: 'Employee ID', width: 12 },
          { header: 'Week Ending', key: 'Week Ending', width: 12 },
          { header: 'Regular Hours', key: 'Regular Hours', width: 14 },
          { header: 'Overtime Hours', key: 'Overtime Hours', width: 14 },
          { header: 'Total Hours', key: 'Total Hours', width: 12 },
          { header: 'Approved Date', key: 'Approved Date', width: 14 },
        ],
        data: excelData,
      },
    ]);

    // Generate filename
    const dateRange = dateFrom && dateTo 
      ? `${dateFrom}_to_${dateTo}`
      : new Date().toISOString().split('T')[0];
    const filename = `Payroll_Report_${dateRange}.xlsx`;

    // Return Excel file
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating payroll report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
