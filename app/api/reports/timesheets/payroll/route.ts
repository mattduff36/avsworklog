import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
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

    if (!profile || !profile.role?.is_manager_admin) {
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
          job_number,
          night_shift,
          bank_holiday
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
    
    // Fetch approved paid absences in the date range
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
      return NextResponse.json({ error: 'No approved timesheets found for the specified criteria' }, { status: 404 });
    }
    
    // Group absences by employee for easier lookup
    // Convert absence days to hours (9 hours per day as standard working day)
    const HOURS_PER_DAY = 9;
    const absencesByEmployee = new Map<string, { paidDays: number; unpaidDays: number }>();
    
    if (absences && absences.length > 0) {
      absences.forEach((absence: any) => {
        const employeeId = absence.profile_id;
        const isPaid = absence.absence_reasons?.is_paid || false;
        const days = absence.duration_days || 0;
        
        if (!absencesByEmployee.has(employeeId)) {
          absencesByEmployee.set(employeeId, { paidDays: 0, unpaidDays: 0 });
        }
        
        const employeeAbsences = absencesByEmployee.get(employeeId)!;
        if (isPaid) {
          employeeAbsences.paidDays += days;
        } else {
          employeeAbsences.unpaidDays += days;
        }
      });
    }

    // Transform data for Excel - Payroll format
    const excelData: any[] = [];

    timesheets.forEach((timesheet: any) => {
      const employee = timesheet.employee;
      const entries = timesheet.timesheet_entries || [];

      // Calculate hours by category based on new payroll rules:
      // - Mon-Fri: All hours at basic rate (no limit)
      // - Sat-Sun: 1.5x rate
      // - Night shifts: 2x rate
      // - Bank holidays: 2x rate
      
      let basicHours = 0;        // Mon-Fri regular hours
      let overtime15Hours = 0;    // Sat-Sun hours at 1.5x
      let overtime2Hours = 0;     // Night shifts + Bank holidays at 2x

      entries.forEach((entry: any) => {
        // Skip days not worked
        if (entry.did_not_work) {
          return;
        }

        const hours = entry.daily_total || 0;
        const dayOfWeek = entry.day_of_week; // Integer: 1=Mon, 2=Tue, ..., 6=Sat, 7=Sun
        const isNightShift = entry.night_shift || false;
        const isBankHoliday = entry.bank_holiday || false;

        // Priority: Night shift or Bank Holiday takes precedence (2x rate)
        if (isNightShift || isBankHoliday) {
          overtime2Hours += hours;
        }
        // Weekend work (Sat/Sun) at 1.5x rate - day 6 = Saturday, day 7 = Sunday
        else if (dayOfWeek === 6 || dayOfWeek === 7) {
          overtime15Hours += hours;
        }
        // Mon-Fri at basic rate (all hours, no cap) - days 1-5
        else {
          basicHours += hours;
        }
      });

      const totalHours = basicHours + overtime15Hours + overtime2Hours;
      
      // Get absence data for this employee
      const employeeAbsences = absencesByEmployee.get(timesheet.user_id) || { paidDays: 0, unpaidDays: 0 };
      const paidAbsenceHours = employeeAbsences.paidDays * HOURS_PER_DAY;
      const unpaidAbsenceHours = employeeAbsences.unpaidDays * HOURS_PER_DAY;

      excelData.push({
        'Employee Name': employee?.full_name || 'Unknown',
        'Employee ID': employee?.employee_id || '-',
        'Week Ending': formatExcelDate(timesheet.week_ending),
        'Basic Hours (Mon-Fri)': formatExcelHours(basicHours),
        'Overtime 1.5x (Weekend)': formatExcelHours(overtime15Hours),
        'Overtime 2x (Night/Bank Holiday)': formatExcelHours(overtime2Hours),
        'Paid Absence Hours': formatExcelHours(paidAbsenceHours),
        'Unpaid Absence Hours': formatExcelHours(unpaidAbsenceHours),
        'Total Hours': formatExcelHours(totalHours),
        'Approved Date': formatExcelDate(timesheet.reviewed_at),
      });
    });

    // Add summary totals
    const totalBasic = excelData.reduce((sum, row) => sum + (parseFloat(row['Basic Hours (Mon-Fri)']) || 0), 0);
    const totalOvertime15 = excelData.reduce((sum, row) => sum + (parseFloat(row['Overtime 1.5x (Weekend)']) || 0), 0);
    const totalOvertime2 = excelData.reduce((sum, row) => sum + (parseFloat(row['Overtime 2x (Night/Bank Holiday)']) || 0), 0);
    const totalPaidAbsence = excelData.reduce((sum, row) => sum + (parseFloat(row['Paid Absence Hours']) || 0), 0);
    const totalUnpaidAbsence = excelData.reduce((sum, row) => sum + (parseFloat(row['Unpaid Absence Hours']) || 0), 0);
    const totalHours = excelData.reduce((sum, row) => sum + (parseFloat(row['Total Hours']) || 0), 0);

    excelData.push({
      'Employee Name': '',
      'Employee ID': '',
      'Week Ending': '',
      'Basic Hours (Mon-Fri)': '',
      'Overtime 1.5x (Weekend)': '',
      'Overtime 2x (Night/Bank Holiday)': '',
      'Paid Absence Hours': '',
      'Unpaid Absence Hours': '',
      'Total Hours': '',
      'Approved Date': '',
    });

    excelData.push({
      'Employee Name': 'TOTALS',
      'Employee ID': `${timesheets.length} timesheets`,
      'Week Ending': '',
      'Basic Hours (Mon-Fri)': totalBasic.toFixed(2),
      'Overtime 1.5x (Weekend)': totalOvertime15.toFixed(2),
      'Overtime 2x (Night/Bank Holiday)': totalOvertime2.toFixed(2),
      'Paid Absence Hours': totalPaidAbsence.toFixed(2),
      'Unpaid Absence Hours': totalUnpaidAbsence.toFixed(2),
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
          { header: 'Basic Hours (Mon-Fri)', key: 'Basic Hours (Mon-Fri)', width: 18 },
          { header: 'Overtime 1.5x (Weekend)', key: 'Overtime 1.5x (Weekend)', width: 20 },
          { header: 'Overtime 2x (Night/Bank Holiday)', key: 'Overtime 2x (Night/Bank Holiday)', width: 26 },
          { header: 'Paid Absence Hours', key: 'Paid Absence Hours', width: 18 },
          { header: 'Unpaid Absence Hours', key: 'Unpaid Absence Hours', width: 20 },
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
