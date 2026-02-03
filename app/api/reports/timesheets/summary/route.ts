import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import { 
  generateExcelFile, 
  formatExcelDate, 
  formatExcelHours, 
  formatExcelStatus
} from '@/lib/utils/excel';

type AbsenceReasonRow = {
  is_paid?: boolean | null;
  name?: string | null;
};

type AbsenceRow = {
  profile_id: string;
  duration_days?: number | null;
  absence_reasons?: AbsenceReasonRow | null;
};

type TimesheetEntryRow = {
  day_of_week: number;
  did_not_work?: boolean | null;
  working_in_yard?: boolean | null;
  daily_total?: number | null;
  job_number?: string | null;
};

type EmployeeRow = {
  full_name?: string | null;
  employee_id?: string | null;
};

type TimesheetRow = {
  user_id: string;
  week_ending: string;
  status: string;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  employee?: EmployeeRow | null;
  timesheet_entries?: TimesheetEntryRow[] | null;
};

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is manager or admin
    const profile = await getProfileWithRole(user.id);

    if (!profile || !profile.role?.is_manager_admin) {
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
    
    // Fetch approved absences in the date range
    let absenceQuery = supabase
      .from('absences')
      .select(`
        id,
        profile_id,
        date,
        end_date,
        duration_days,
        status,
        absence_reasons (
          name,
          is_paid
        ),
        profiles (
          id,
          full_name,
          employee_id
        )
      `)
      .eq('status', 'approved');
    
    // Apply date filters for absences
    if (dateFrom) {
      absenceQuery = absenceQuery.gte('date', dateFrom);
    }
    if (dateTo) {
      absenceQuery = absenceQuery.lte('date', dateTo);
    }
    if (employeeId) {
      absenceQuery = absenceQuery.eq('profile_id', employeeId);
    }
    
    const { data: absences, error: absenceError } = await absenceQuery;

    if (error) {
      console.error('Error fetching timesheets:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    if (absenceError) {
      console.error('Error fetching absences:', absenceError);
      // Continue without absences rather than fail completely
    }

    if (!timesheets || timesheets.length === 0) {
      return NextResponse.json({ error: 'No timesheets found for the specified criteria' }, { status: 404 });
    }
    
    // Group absences by employee for easier lookup
    const absencesByEmployee = new Map<string, { paidDays: number; unpaidDays: number; reasons: string[] }>();
    
    if (absences && absences.length > 0) {
      (absences as AbsenceRow[]).forEach((absence) => {
        const employeeId = absence.profile_id;
        const isPaid = absence.absence_reasons?.is_paid || false;
        const days = absence.duration_days || 0;
        const reasonName = absence.absence_reasons?.name || 'Unknown';
        
        if (!absencesByEmployee.has(employeeId)) {
          absencesByEmployee.set(employeeId, { paidDays: 0, unpaidDays: 0, reasons: [] });
        }
        
        const employeeAbsences = absencesByEmployee.get(employeeId)!;
        if (isPaid) {
          employeeAbsences.paidDays += days;
        } else {
          employeeAbsences.unpaidDays += days;
        }
        
        // Track unique reasons
        if (!employeeAbsences.reasons.includes(reasonName)) {
          employeeAbsences.reasons.push(reasonName);
        }
      });
    }

    // Transform data for Excel
    const excelData: Array<Record<string, string>> = [];

    (timesheets as TimesheetRow[]).forEach((timesheet) => {
      const employee = timesheet.employee;
      const entries = timesheet.timesheet_entries || [];

      // Sort entries by day of week (1=Monday, 7=Sunday)
      const sortedEntries = [...entries].sort((a, b) => a.day_of_week - b.day_of_week);

      // Calculate total hours from entries
      const totalHours = entries.reduce((sum, entry) => {
        return sum + (entry.did_not_work ? 0 : (entry.daily_total ?? 0));
      }, 0);

      // Create row for each timesheet
      const row: Record<string, string> = {
        'Employee Name': employee?.full_name || 'Unknown',
        'Employee ID': employee?.employee_id || '-',
        'Week Ending': formatExcelDate(timesheet.week_ending),
        'Status': formatExcelStatus(timesheet.status),
        'Total Hours': formatExcelHours(totalHours),
      };

      // Add daily hours and job numbers
      const dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const jobNumbers: string[] = [];
      
      sortedEntries.forEach((entry) => {
        const dayName = dayNames[entry.day_of_week] || '';
        const day = dayName.substring(0, 3); // Mon, Tue, etc.
        if (entry.did_not_work) {
          row[`${day} Hours`] = 'DNW';
        } else if (entry.working_in_yard) {
          row[`${day} Hours`] = `${formatExcelHours(entry.daily_total)} (Yard)`;
        } else {
          row[`${day} Hours`] = formatExcelHours(entry.daily_total ?? null);
        }
        
        // Collect job numbers
        if (entry.job_number && !entry.did_not_work) {
          jobNumbers.push(entry.job_number);
        }
      });
      
      // Add job numbers column (unique, comma-separated)
      row['Job Numbers'] = [...new Set(jobNumbers)].join(', ') || '-';
      
      // Get absence data for this employee
      const employeeAbsences = absencesByEmployee.get(timesheet.user_id) || { paidDays: 0, unpaidDays: 0, reasons: [] };
      
      row['Paid Absence (Days)'] = employeeAbsences.paidDays > 0 ? employeeAbsences.paidDays.toFixed(1) : '-';
      row['Unpaid Absence (Days)'] = employeeAbsences.unpaidDays > 0 ? employeeAbsences.unpaidDays.toFixed(1) : '-';
      row['Absence Reasons'] = employeeAbsences.reasons.join(', ') || '-';

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
        'Paid Absence (Days)': '',
        'Unpaid Absence (Days)': '',
        'Absence Reasons': '',
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
        'Paid Absence (Days)': '',
        'Unpaid Absence (Days)': '',
        'Absence Reasons': '',
        'Submitted': '',
        'Reviewed': '',
      });
    }

    // Generate Excel file
    const buffer = await generateExcelFile([
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
          { header: 'Paid Absence (Days)', key: 'Paid Absence (Days)', width: 16 },
          { header: 'Unpaid Absence (Days)', key: 'Unpaid Absence (Days)', width: 18 },
          { header: 'Absence Reasons', key: 'Absence Reasons', width: 25 },
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

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reports/timesheets/summary',
      additionalData: {
        endpoint: '/api/reports/timesheets/summary',
      },
    });
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
