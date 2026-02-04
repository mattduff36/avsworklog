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

// Helper function to build timesheet query with filters
function buildTimesheetQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dateFrom: string | null,
  dateTo: string | null,
  employeeId: string | null
) {
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

  if (dateFrom) query = query.gte('week_ending', dateFrom);
  if (dateTo) query = query.lte('week_ending', dateTo);
  if (employeeId) query = query.eq('user_id', employeeId);

  return query;
}

// Helper function to build absence query with filters
function buildAbsenceQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dateFrom: string | null,
  dateTo: string | null,
  employeeId: string | null
) {
  let query = supabase
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
  
  if (dateFrom) query = query.gte('date', dateFrom);
  if (dateTo) query = query.lte('date', dateTo);
  if (employeeId) query = query.eq('profile_id', employeeId);
  
  return query;
}

// Helper function to group absences by employee
function groupAbsencesByEmployee(absences: AbsenceRow[]) {
  const absencesByEmployee = new Map<string, { paidDays: number; unpaidDays: number; reasons: string[] }>();
  
  absences.forEach((absence) => {
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
    
    if (!employeeAbsences.reasons.includes(reasonName)) {
      employeeAbsences.reasons.push(reasonName);
    }
  });
  
  return absencesByEmployee;
}

// Helper function to transform timesheets to Excel rows
function transformTimesheetsToExcel(
  timesheets: TimesheetRow[],
  absencesByEmployee: Map<string, { paidDays: number; unpaidDays: number; reasons: string[] }>
) {
  const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const excelData: Array<Record<string, string>> = [];

  timesheets.forEach((timesheet) => {
    const employee = timesheet.employee;
    const entries = timesheet.timesheet_entries || [];
    const sortedEntries = [...entries].sort((a, b) => a.day_of_week - b.day_of_week);
    const totalHours = entries.reduce((sum, entry) => sum + (entry.did_not_work ? 0 : (entry.daily_total ?? 0)), 0);

    const row: Record<string, string> = {
      'Employee Name': employee?.full_name || 'Unknown',
      'Employee ID': employee?.employee_id || '-',
      'Week Ending': formatExcelDate(timesheet.week_ending),
      'Status': formatExcelStatus(timesheet.status),
      'Total Hours': formatExcelHours(totalHours),
    };

    const jobNumbers: string[] = [];
    sortedEntries.forEach((entry) => {
      const dayName = DAY_NAMES[entry.day_of_week] || '';
      const day = dayName.substring(0, 3);
      
      if (entry.did_not_work) {
        row[`${day} Hours`] = 'DNW';
      } else if (entry.working_in_yard) {
        row[`${day} Hours`] = `${formatExcelHours(entry.daily_total)} (Yard)`;
      } else {
        row[`${day} Hours`] = formatExcelHours(entry.daily_total ?? null);
      }
      
      if (entry.job_number && !entry.did_not_work) {
        jobNumbers.push(entry.job_number);
      }
    });
    
    row['Job Numbers'] = [...new Set(jobNumbers)].join(', ') || '-';
    
    const employeeAbsences = absencesByEmployee.get(timesheet.user_id) || { paidDays: 0, unpaidDays: 0, reasons: [] };
    row['Paid Absence (Days)'] = employeeAbsences.paidDays > 0 ? employeeAbsences.paidDays.toFixed(1) : '-';
    row['Unpaid Absence (Days)'] = employeeAbsences.unpaidDays > 0 ? employeeAbsences.unpaidDays.toFixed(1) : '-';
    row['Absence Reasons'] = employeeAbsences.reasons.join(', ') || '-';
    row['Submitted'] = timesheet.submitted_at ? formatExcelDate(timesheet.submitted_at) : '-';
    row['Reviewed'] = timesheet.reviewed_at ? formatExcelDate(timesheet.reviewed_at) : '-';

    excelData.push(row);
  });

  return excelData;
}

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

    // Fetch data
    const { data: timesheets, error } = await buildTimesheetQuery(supabase, dateFrom, dateTo, employeeId);
    const { data: absences, error: absenceError } = await buildAbsenceQuery(supabase, dateFrom, dateTo, employeeId);

    if (error) {
      console.error('Error fetching timesheets:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    if (absenceError) {
      console.error('Error fetching absences:', absenceError);
    }

    if (!timesheets || timesheets.length === 0) {
      return NextResponse.json({ error: 'No timesheets found for the specified criteria' }, { status: 404 });
    }
    
    // Process data
    const absencesByEmployee = absences ? groupAbsencesByEmployee(absences as AbsenceRow[]) : new Map();
    const excelData = transformTimesheetsToExcel(timesheets as TimesheetRow[], absencesByEmployee);

    // Add totals
    const approvedTimesheets = excelData.filter(row => row['Status'] === 'Approved');
    if (approvedTimesheets.length > 0) {
      const totalHours = approvedTimesheets.reduce((sum, row) => sum + (parseFloat(row['Total Hours']) || 0), 0);

      excelData.push({
        'Employee Name': '', 'Employee ID': '', 'Week Ending': '', 'Status': '', 'Total Hours': '',
        'Mon Hours': '', 'Tue Hours': '', 'Wed Hours': '', 'Thu Hours': '', 'Fri Hours': '', 'Sat Hours': '', 'Sun Hours': '',
        'Job Numbers': '', 'Paid Absence (Days)': '', 'Unpaid Absence (Days)': '', 'Absence Reasons': '', 'Submitted': '', 'Reviewed': '',
      });

      excelData.push({
        'Employee Name': 'TOTALS (Approved Only)', 'Employee ID': '', 'Week Ending': '',
        'Status': `${approvedTimesheets.length} timesheets`, 'Total Hours': totalHours.toFixed(2),
        'Mon Hours': '', 'Tue Hours': '', 'Wed Hours': '', 'Thu Hours': '', 'Fri Hours': '', 'Sat Hours': '', 'Sun Hours': '',
        'Job Numbers': '', 'Paid Absence (Days)': '', 'Unpaid Absence (Days)': '', 'Absence Reasons': '', 'Submitted': '', 'Reviewed': '',
      });
    }

    // Generate Excel file
    const buffer = await generateExcelFile([{
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
    }]);

    // Generate filename
    const dateRange = dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : new Date().toISOString().split('T')[0];
    const filename = `Timesheet_Summary_${dateRange}.xlsx`;

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
      additionalData: { endpoint: '/api/reports/timesheets/summary' },
    });
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
