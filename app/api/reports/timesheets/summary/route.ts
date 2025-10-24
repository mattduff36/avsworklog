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
    const employeeId = searchParams.get('employeeId');

    // Build query
    let query = supabase
      .from('timesheets')
      .select(`
        id,
        week_ending,
        status,
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
          job_number,
          remarks
        )
      `)
      .order('week_ending', { ascending: false });

    // Apply filters
    if (dateFrom) {
      query = query.gte('week_ending', dateFrom);
    }
    if (dateTo) {
      query = query.lte('week_ending', dateTo);
    }
    if (employeeId) {
      query = query.eq('user_id', employeeId);
    }

    const { data: timesheets, error } = await query;

    if (error) {
      console.error('Error fetching timesheets:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!timesheets || timesheets.length === 0) {
      return NextResponse.json({ error: 'No timesheets found for the specified criteria' }, { status: 404 });
    }

    // Transform data for Excel
    const excelData: any[] = [];

    timesheets.forEach((timesheet: any) => {
      const employee = timesheet.employee;
      const entries = timesheet.timesheet_entries || [];

      // Sort entries by day of week (1=Monday, 7=Sunday)
      const sortedEntries = entries.sort((a: any, b: any) => a.day_of_week - b.day_of_week);

      // Calculate total hours from entries
      const totalHours = entries.reduce((sum: number, entry: any) => {
        return sum + (entry.did_not_work ? 0 : (entry.daily_total || 0));
      }, 0);

      // Create row for each timesheet
      const row: any = {
        'Employee Name': employee?.full_name || 'Unknown',
        'Employee ID': employee?.employee_id || '-',
        'Week Ending': formatExcelDate(timesheet.week_ending),
        'Status': formatExcelStatus(timesheet.status),
        'Total Hours': formatExcelHours(totalHours),
      };

      // Add daily hours and job numbers
      const dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const jobNumbers: string[] = [];
      
      sortedEntries.forEach((entry: any) => {
        const dayName = dayNames[entry.day_of_week] || '';
        const day = dayName.substring(0, 3); // Mon, Tue, etc.
        if (entry.did_not_work) {
          row[`${day} Hours`] = 'DNW';
        } else if (entry.working_in_yard) {
          row[`${day} Hours`] = `${formatExcelHours(entry.daily_total)} (Yard)`;
        } else {
          row[`${day} Hours`] = formatExcelHours(entry.daily_total);
        }
        
        // Collect job numbers
        if (entry.job_number && !entry.did_not_work) {
          jobNumbers.push(entry.job_number);
        }
      });
      
      // Add job numbers column (unique, comma-separated)
      row['Job Numbers'] = [...new Set(jobNumbers)].join(', ') || '-';

      row['Submitted'] = timesheet.submitted_at ? formatExcelDate(timesheet.submitted_at) : '-';
      row['Reviewed'] = timesheet.reviewed_at ? formatExcelDate(timesheet.reviewed_at) : '-';

      excelData.push(row);
    });

    // Calculate totals for approved timesheets
    const approvedTimesheets = excelData.filter(row => row['Status'] === 'Approved');
    if (approvedTimesheets.length > 0) {
      const totalHours = approvedTimesheets.reduce((sum, row) => {
        const hours = parseFloat(row['Total Hours']) || 0;
        return sum + hours;
      }, 0);

      excelData.push({
        'Employee Name': '',
        'Employee ID': '',
        'Week Ending': '',
        'Status': '',
        'Total Hours': '',
        'Mon Hours': '',
        'Tue Hours': '',
        'Wed Hours': '',
        'Thu Hours': '',
        'Fri Hours': '',
        'Sat Hours': '',
        'Sun Hours': '',
        'Job Numbers': '',
        'Submitted': '',
        'Reviewed': '',
      });

      excelData.push({
        'Employee Name': 'TOTALS (Approved Only)',
        'Employee ID': '',
        'Week Ending': '',
        'Status': `${approvedTimesheets.length} timesheets`,
        'Total Hours': totalHours.toFixed(2),
        'Mon Hours': '',
        'Tue Hours': '',
        'Wed Hours': '',
        'Thu Hours': '',
        'Fri Hours': '',
        'Sat Hours': '',
        'Sun Hours': '',
        'Job Numbers': '',
        'Submitted': '',
        'Reviewed': '',
      });
    }

    // Generate Excel file
    const buffer = generateExcelFile([
      {
        sheetName: 'Timesheet Summary',
        columns: [
          { header: 'Employee Name', key: 'Employee Name', width: 20 },
          { header: 'Employee ID', key: 'Employee ID', width: 12 },
          { header: 'Week Ending', key: 'Week Ending', width: 12 },
          { header: 'Status', key: 'Status', width: 10 },
          { header: 'Total Hours', key: 'Total Hours', width: 12 },
          { header: 'Mon Hours', key: 'Mon Hours', width: 12 },
          { header: 'Tue Hours', key: 'Tue Hours', width: 12 },
          { header: 'Wed Hours', key: 'Wed Hours', width: 12 },
          { header: 'Thu Hours', key: 'Thu Hours', width: 12 },
          { header: 'Fri Hours', key: 'Fri Hours', width: 12 },
          { header: 'Sat Hours', key: 'Sat Hours', width: 12 },
          { header: 'Sun Hours', key: 'Sun Hours', width: 12 },
          { header: 'Job Numbers', key: 'Job Numbers', width: 20 },
          { header: 'Submitted', key: 'Submitted', width: 12 },
          { header: 'Reviewed', key: 'Reviewed', width: 12 },
        ],
        data: excelData,
      },
    ]);

    // Generate filename
    const dateRange = dateFrom && dateTo 
      ? `${dateFrom}_to_${dateTo}`
      : new Date().toISOString().split('T')[0];
    const filename = `Timesheet_Summary_${dateRange}.xlsx`;

    // Return Excel file
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating timesheet summary:', error);
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
