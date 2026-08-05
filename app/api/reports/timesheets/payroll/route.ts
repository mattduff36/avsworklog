import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logServerError } from '@/lib/utils/server-error-logger';
import { getDidNotWorkReasonInfo } from '@/lib/utils/timesheetDidNotWork';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { buildSafeReportFilename, parseReportDateRange, validateRequiredReportDateRange } from '@/lib/server/report-date-range';
import { filterTimesheetRowsForReportScope } from '@/lib/server/reports-timesheet-scope';
import { loadEmployeeWorkShiftPatternMap } from '@/lib/server/work-shifts';
import {
  generateExcelFile,
  formatExcelDate,
  formatExcelHours
} from '@/lib/utils/excel';
import type { ApprovedAbsenceForTimesheet } from '@/lib/utils/timesheet-off-days';
import { getTimesheetWeekIsoBounds, resolveTimesheetOffDayStates } from '@/lib/utils/timesheet-off-days';
import { buildLeaveAwareTotals, buildLeaveDaysBreakdown } from '@/lib/utils/timesheet-leave-totals';
import { normalizeTimesheetEntriesForDisplay } from '@/lib/utils/plant-timesheet-v2-normalization';
import { collectUniqueJobNumbers } from '@/lib/utils/timesheet-job-codes';
import { isSubsistencePaymentRequired } from '@/lib/utils/timesheet-subsistence';
import type { TimesheetEntry } from '@/types/timesheet';
import { calculateLegacyPayroll } from '@/lib/payroll/legacy';
import type { LegacyPayrollDayInput } from '@/lib/payroll/types';

type AbsenceReasonRow = {
  name?: string | null;
  is_paid?: boolean | null;
};

interface AbsenceRow extends ApprovedAbsenceForTimesheet {
  profile_id: string;
  duration_days?: number | null;
  absence_reasons?: AbsenceReasonRow | null;
}

type TimesheetEntryRow = {
  day_of_week: number;
  time_started?: string | null;
  time_finished?: string | null;
  daily_total?: number | null;
  working_in_yard?: boolean | null;
  subsistence_payment_required?: boolean | null;
  did_not_work?: boolean | null;
  remarks?: string | null;
  job_number?: string | null;
  timesheet_entry_job_codes?: Array<{ job_number?: string | null; display_order?: number | null }> | null;
  night_shift?: boolean | null;
  bank_holiday?: boolean | null;
};

type EmployeeRow = {
  full_name?: string | null;
  employee_id?: string | null;
  team_id?: string | null;
};

interface PayrollSnapshotRow {
  revision: number;
  basic_minutes: number;
  overtime_minutes: number;
  double_time_minutes: number;
  payable_minutes: number;
  paid_leave_units: number | string;
  unpaid_leave_units: number | string;
  operator_travel_minutes: number;
  ipr_units: number | string;
  subsistence_days: number;
  subsistence_day_names: string[];
  rule_set?: { name?: string | null; rule_key?: string | null } | null;
}

type TimesheetRow = {
  id: string;
  user_id: string;
  week_ending: string;
  timesheet_type?: string | null;
  template_version?: number | null;
  reviewed_at?: string | null;
  employee?: EmployeeRow | null;
  timesheet_entries?: TimesheetEntryRow[] | null;
  current_payroll_snapshot?: PayrollSnapshotRow | null;
};

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccessReports = await canEffectiveRoleAccessModule('reports');
    if (!canAccessReports) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const canAccessTimesheets = await canEffectiveRoleAccessModule('timesheets');
    if (!canAccessTimesheets) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const { range, error: dateRangeError } = parseReportDateRange(searchParams);
    const requiredRangeError = validateRequiredReportDateRange(range, 366);
    if (dateRangeError || requiredRangeError || !range) {
      return NextResponse.json({ error: dateRangeError || requiredRangeError || 'Invalid date range.' }, { status: 400 });
    }
    const { dateFrom, dateTo } = range;

    // Candidate rows use the session client without payroll snapshots. Snapshot
    // hydration uses the service role only for IDs that pass report scope.
    let candidateQuery = supabase
      .from('timesheets')
      .select(`
        id,
        week_ending,
        timesheet_type,
        template_version,
        submitted_at,
        reviewed_at,
        user_id,
        employee:profiles!timesheets_user_id_fkey (
          id,
          full_name,
          employee_id,
          team_id
        ),
        timesheet_entries (
          day_of_week,
          time_started,
          time_finished,
          daily_total,
          working_in_yard,
          subsistence_payment_required,
          did_not_work,
          remarks,
          job_number,
          timesheet_entry_job_codes (
            job_number,
            display_order
          ),
          night_shift,
          bank_holiday
        )
      `)
      .eq('status', 'approved')
      .order('week_ending', { ascending: false });

    // Apply filters
    if (dateFrom) {
      candidateQuery = candidateQuery.gte('week_ending', dateFrom);
    }
    if (dateTo) {
      candidateQuery = candidateQuery.lte('week_ending', dateTo);
    }

    const [{ data: candidateTimesheets, error }, { data: rolloutRows, error: rolloutError }] = await Promise.all([
      candidateQuery,
      supabase
        .from('payroll_rollout_activations')
        .select('effective_week_ending')
        .order('effective_week_ending', { ascending: true }),
    ]);

    // Fetch approved paid absences in the date range
    let absenceQuery = supabase
      .from('absences')
      .select(`
        id,
        profile_id,
        date,
        end_date,
        is_half_day,
        half_day_session,
        allow_timesheet_work_on_leave,
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
    if (rolloutError) {
      return NextResponse.json({ error: 'Unable to verify payroll rollout configuration.' }, { status: 500 });
    }

    const scopedCandidates = await filterTimesheetRowsForReportScope(
      (candidateTimesheets || []) as unknown as TimesheetRow[]
    );
    if (scopedCandidates.length === 0) {
      return NextResponse.json({ error: 'No approved timesheets found for the specified criteria' }, { status: 404 });
    }

    const scopedIds = scopedCandidates.map((timesheet) => timesheet.id);
    const admin = createAdminClient();
    const { data: hydratedTimesheets, error: hydrateError } = await admin
      .from('timesheets')
      .select(`
        id,
        week_ending,
        timesheet_type,
        template_version,
        submitted_at,
        reviewed_at,
        user_id,
        current_payroll_snapshot:timesheet_payroll_snapshots!timesheets_current_payroll_snapshot_id_fkey (
          revision,
          basic_minutes,
          overtime_minutes,
          double_time_minutes,
          payable_minutes,
          paid_leave_units,
          unpaid_leave_units,
          operator_travel_minutes,
          ipr_units,
          subsistence_days,
          subsistence_day_names,
          rule_set:payroll_rule_sets!timesheet_payroll_snapshots_rule_set_id_fkey (
            name,
            rule_key
          )
        ),
        employee:profiles!timesheets_user_id_fkey (
          id,
          full_name,
          employee_id,
          team_id
        ),
        timesheet_entries (
          day_of_week,
          time_started,
          time_finished,
          daily_total,
          working_in_yard,
          subsistence_payment_required,
          did_not_work,
          remarks,
          job_number,
          timesheet_entry_job_codes (
            job_number,
            display_order
          ),
          night_shift,
          bank_holiday
        )
      `)
      .in('id', scopedIds)
      .eq('status', 'approved')
      .order('week_ending', { ascending: false });
    if (hydrateError) {
      console.error('Error hydrating scoped payroll snapshots:', hydrateError);
      return NextResponse.json({ error: hydrateError.message }, { status: 500 });
    }

    const scopedTimesheets = (hydratedTimesheets || []) as unknown as TimesheetRow[];
    if (scopedTimesheets.length === 0) {
      return NextResponse.json({ error: 'No approved timesheets found for the specified criteria' }, { status: 404 });
    }
    const rolloutWeeks = (rolloutRows || []).map((row) => row.effective_week_ending);
    const missingPostCutoverSnapshot = scopedTimesheets.find((timesheet) =>
      !timesheet.current_payroll_snapshot
      && rolloutWeeks.some((week) => week <= timesheet.week_ending)
    );
    if (missingPostCutoverSnapshot) {
      return NextResponse.json(
        {
          error: `Payroll snapshot missing for approved timesheet ${missingPostCutoverSnapshot.id}. Export is blocked to protect payroll history.`,
        },
        { status: 409 }
      );
    }

    const scopedEmployeeIds = new Set(scopedTimesheets.map((timesheet) => timesheet.user_id));
    const scopedAbsences = ((absences || []) as AbsenceRow[]).filter((absence) => scopedEmployeeIds.has(absence.profile_id));
    const employeeShiftPatternMap = await loadEmployeeWorkShiftPatternMap(
      supabase,
      Array.from(scopedEmployeeIds),
      { ensureRecords: false }
    );

    // Group absences by employee for easier lookup
    const absencesByEmployee = new Map<string, { paidDays: number; unpaidDays: number }>();
    const absenceRowsByEmployee = new Map<string, AbsenceRow[]>();

    if (scopedAbsences.length > 0) {
      scopedAbsences.forEach((absence) => {
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

        const employeeRows = absenceRowsByEmployee.get(employeeId) || [];
        employeeRows.push(absence);
        absenceRowsByEmployee.set(employeeId, employeeRows);
      });
    }

    // Transform data for Excel - Payroll format
    const excelData: Array<Record<string, string>> = [];
    const dnwDetailsData: Array<Record<string, string>> = [];
    const usesSnapshotPayroll = scopedTimesheets.some((timesheet) => Boolean(timesheet.current_payroll_snapshot));
    const basicHoursKey = usesSnapshotPayroll ? 'Basic Hours' : 'Basic Hours (Mon-Fri)';
    const overtimeHoursKey = usesSnapshotPayroll ? 'Overtime Hours' : 'Overtime 1.5x (Weekend)';
    const doubleTimeHoursKey = usesSnapshotPayroll ? 'Double Time Hours' : 'Overtime 2x (Night/Bank Holiday)';
    const dayNameMap: Record<number, string> = {
      1: 'Monday',
      2: 'Tuesday',
      3: 'Wednesday',
      4: 'Thursday',
      5: 'Friday',
      6: 'Saturday',
      7: 'Sunday',
    };

    scopedTimesheets.forEach((timesheet) => {
      const employee = timesheet.employee;
      const rawEntries = timesheet.timesheet_entries || [];
      const { startIso, endIso } = getTimesheetWeekIsoBounds(timesheet.week_ending);
      const employeeAbsenceRows = (absenceRowsByEmployee.get(timesheet.user_id) || []).filter((absence) => {
        const absenceEnd = absence.end_date || absence.date;
        return absence.date <= endIso && absenceEnd >= startIso;
      });
      const offDayStates = resolveTimesheetOffDayStates(
        timesheet.week_ending,
        employeeAbsenceRows,
        employeeShiftPatternMap.get(timesheet.user_id) || null
      );
      const entries = normalizeTimesheetEntriesForDisplay(
        {
          timesheet_type: timesheet.timesheet_type ?? null,
          template_version: timesheet.template_version ?? null,
        },
        rawEntries as unknown as TimesheetEntry[],
        offDayStates
      );
      const leaveAwareTotals = buildLeaveAwareTotals(
        entries.map((entry) => ({
          day_of_week: entry.day_of_week,
          daily_total: entry.daily_total ?? null,
        })),
        offDayStates
      );
      const leaveDaysBreakdown = buildLeaveDaysBreakdown(offDayStates);
      const snapshot = timesheet.current_payroll_snapshot || null;

      // Calculate hours by category based on new payroll rules:
      // - Mon-Fri: All hours at basic rate (no limit)
      // - Sat-Sun: 1.5x rate
      // - Night shifts: 2x rate
      // - Bank holidays: 2x rate

      let basicHours = 0; // Mon-Fri regular hours
      let overtime15Hours = 0; // Sat-Sun hours at 1.5x
      let overtime2Hours = 0; // Night shifts + Bank holidays at 2x
      let subsistenceDays = 0;
      const subsistenceDayNames: string[] = [];
      const legacyPayrollDays: LegacyPayrollDayInput[] = [];

      entries.forEach((entry) => {
        const dnwReason = getDidNotWorkReasonInfo(entry.did_not_work, entry.remarks);

        // Skip days not worked
        if (dnwReason.isDidNotWork) {
          dnwDetailsData.push({
            'Employee Name': employee?.full_name || 'Unknown',
            'Employee ID': employee?.employee_id || '-',
            'Week Ending': formatExcelDate(timesheet.week_ending),
            'Day': dayNameMap[entry.day_of_week] || String(entry.day_of_week),
            'DNW Category': dnwReason.category || '-',
            'DNW Remarks': dnwReason.remarks || '-',
            'DNW Reason': dnwReason.reasonDisplay || '-',
            'DNW Display': dnwReason.combinedDisplay || '-',
            'Approved Date': timesheet.reviewed_at ? formatExcelDate(timesheet.reviewed_at) : '-',
          });
          return;
        }

        const hours = leaveAwareTotals.rowByDay.get(entry.day_of_week)?.workedHours ?? (entry.daily_total ?? 0);
        const dayOfWeek = entry.day_of_week; // Integer: 1=Mon, 2=Tue, ..., 6=Sat, 7=Sun
        const isNightShift = entry.night_shift || false;
        const isBankHoliday = entry.bank_holiday || false;
        if (isSubsistencePaymentRequired(entry)) {
          subsistenceDays += 1;
          subsistenceDayNames.push(dayNameMap[dayOfWeek] || String(dayOfWeek));
        }

        legacyPayrollDays.push({
          dayOfWeek,
          workedHours: hours,
          nightShift: isNightShift,
          bankHoliday: isBankHoliday,
        });
      });

      const legacyBreakdown = calculateLegacyPayroll(legacyPayrollDays);
      basicHours = legacyBreakdown.basicHours;
      overtime15Hours = legacyBreakdown.overtimeHours;
      overtime2Hours = legacyBreakdown.doubleTimeHours;
      const totalHours = legacyBreakdown.totalHours;

      // Get absence data for this employee
      const employeeAbsences = absencesByEmployee.get(timesheet.user_id) || { paidDays: 0, unpaidDays: 0 };
      const paidAbsenceHours = !snapshot && employeeAbsences.paidDays > 0
        ? Number((employeeAbsences.paidDays * 9).toFixed(2))
        : null;
      const unpaidAbsenceHours = !snapshot && employeeAbsences.unpaidDays > 0
        ? Number((employeeAbsences.unpaidDays * 9).toFixed(2))
        : null;
      const exportedBasicHours = snapshot ? snapshot.basic_minutes / 60 : basicHours;
      const exportedOvertimeHours = snapshot ? snapshot.overtime_minutes / 60 : overtime15Hours;
      const exportedDoubleTimeHours = snapshot ? snapshot.double_time_minutes / 60 : overtime2Hours;
      const exportedWorkedHours = snapshot ? snapshot.payable_minutes / 60 : leaveAwareTotals.weekly.workedHours;
      const exportedPaidLeaveDays = snapshot ? Number(snapshot.paid_leave_units) : leaveDaysBreakdown.paidLeaveDays;
      const exportedUnpaidLeaveDays = snapshot ? Number(snapshot.unpaid_leave_units) : leaveDaysBreakdown.unpaidLeaveDays;
      const exportedLeaveDays = exportedPaidLeaveDays + exportedUnpaidLeaveDays;
      const exportedSubsistenceDays = snapshot ? snapshot.subsistence_days : subsistenceDays;
      const exportedSubsistenceNames = snapshot ? snapshot.subsistence_day_names : subsistenceDayNames;
      const exportedTotalHours = snapshot ? snapshot.payable_minutes / 60 : totalHours;

      excelData.push({
        'Employee Name': employee?.full_name || 'Unknown',
        'Employee ID': employee?.employee_id || '-',
        'Week Ending': formatExcelDate(timesheet.week_ending),
        'Job Numbers': collectUniqueJobNumbers(entries, {
          excludeDidNotWork: true,
          excludeWorkingInYard: true,
        }).join(', ') || '-',
        'Payroll Rule': snapshot?.rule_set?.name || 'Legacy',
        'Snapshot Revision': snapshot ? String(snapshot.revision) : '-',
        [basicHoursKey]: formatExcelHours(exportedBasicHours),
        [overtimeHoursKey]: formatExcelHours(exportedOvertimeHours),
        [doubleTimeHoursKey]: formatExcelHours(exportedDoubleTimeHours),
        'Worked Hours': formatExcelHours(exportedWorkedHours),
        'Leave Days': exportedLeaveDays > 0 ? exportedLeaveDays.toFixed(1) : '-',
        'Paid Absence (Days)': exportedPaidLeaveDays > 0 ? exportedPaidLeaveDays.toFixed(1) : '-',
        'Unpaid Absence (Days)': exportedUnpaidLeaveDays > 0 ? exportedUnpaidLeaveDays.toFixed(1) : '-',
        'Weekly Total (Hours + Days)': snapshot
          ? `${exportedWorkedHours.toFixed(2)} hours + ${exportedLeaveDays.toFixed(1)} days`
          : leaveAwareTotals.weekly.display,
        'Operator Travel Hours': snapshot ? formatExcelHours(snapshot.operator_travel_minutes / 60) : '-',
        'IPR Units': snapshot ? Number(snapshot.ipr_units).toFixed(1) : '-',
        'Subsistence Days': exportedSubsistenceDays > 0 ? String(exportedSubsistenceDays) : '-',
        'Subsistence Dates': exportedSubsistenceNames.join(', ') || '-',
        'Paid Absence Hours': formatExcelHours(paidAbsenceHours),
        'Unpaid Absence Hours': formatExcelHours(unpaidAbsenceHours),
        'Total Hours': formatExcelHours(exportedTotalHours),
        'Approved Date': timesheet.reviewed_at ? formatExcelDate(timesheet.reviewed_at) : '-',
      });
    });

    // Add summary totals
    const totalBasic = excelData.reduce((sum, row) => sum + (parseFloat(row[basicHoursKey]) || 0), 0);
    const totalOvertime15 = excelData.reduce((sum, row) => sum + (parseFloat(row[overtimeHoursKey]) || 0), 0);
    const totalOvertime2 = excelData.reduce((sum, row) => sum + (parseFloat(row[doubleTimeHoursKey]) || 0), 0);
    const totalWorkedHours = excelData.reduce((sum, row) => sum + (parseFloat(row['Worked Hours']) || 0), 0);
    const totalLeaveDays = excelData.reduce((sum, row) => sum + (parseFloat(row['Leave Days']) || 0), 0);
    const totalPaidDays = excelData.reduce((sum, row) => sum + (parseFloat(row['Paid Absence (Days)']) || 0), 0);
    const totalUnpaidDays = excelData.reduce((sum, row) => sum + (parseFloat(row['Unpaid Absence (Days)']) || 0), 0);
    const totalPaidAbsence = excelData.reduce((sum, row) => sum + (parseFloat(row['Paid Absence Hours']) || 0), 0);
    const totalUnpaidAbsence = excelData.reduce((sum, row) => sum + (parseFloat(row['Unpaid Absence Hours']) || 0), 0);
    const totalOperatorTravel = excelData.reduce((sum, row) => sum + (parseFloat(row['Operator Travel Hours']) || 0), 0);
    const totalIprUnits = excelData.reduce((sum, row) => sum + (parseFloat(row['IPR Units']) || 0), 0);
    const totalSubsistenceDays = excelData.reduce((sum, row) => sum + (parseFloat(row['Subsistence Days']) || 0), 0);
    const totalHours = excelData.reduce((sum, row) => sum + (parseFloat(row['Total Hours']) || 0), 0);

    excelData.push({
      'Employee Name': '',
      'Employee ID': '',
      'Week Ending': '',
      'Job Numbers': '',
      'Payroll Rule': '',
      'Snapshot Revision': '',
      [basicHoursKey]: '',
      [overtimeHoursKey]: '',
      [doubleTimeHoursKey]: '',
      'Worked Hours': '',
      'Leave Days': '',
      'Paid Absence (Days)': '',
      'Unpaid Absence (Days)': '',
      'Weekly Total (Hours + Days)': '',
      'Operator Travel Hours': '',
      'IPR Units': '',
      'Subsistence Days': '',
      'Subsistence Dates': '',
      'Paid Absence Hours': '',
      'Unpaid Absence Hours': '',
      'Total Hours': '',
      'Approved Date': '',
    });

    excelData.push({
      'Employee Name': 'TOTALS',
      'Employee ID': `${scopedTimesheets.length} timesheets`,
      'Week Ending': '',
      'Payroll Rule': '',
      'Snapshot Revision': '',
      [basicHoursKey]: totalBasic.toFixed(2),
      [overtimeHoursKey]: totalOvertime15.toFixed(2),
      [doubleTimeHoursKey]: totalOvertime2.toFixed(2),
      'Worked Hours': totalWorkedHours.toFixed(2),
      'Leave Days': totalLeaveDays.toFixed(1),
      'Paid Absence (Days)': totalPaidDays.toFixed(1),
      'Unpaid Absence (Days)': totalUnpaidDays.toFixed(1),
      'Weekly Total (Hours + Days)': `${totalWorkedHours.toFixed(2)} hours + ${totalLeaveDays.toFixed(1)} days`,
      'Operator Travel Hours': totalOperatorTravel.toFixed(2),
      'IPR Units': totalIprUnits.toFixed(1),
      'Subsistence Days': totalSubsistenceDays > 0 ? totalSubsistenceDays.toFixed(0) : '-',
      'Subsistence Dates': '',
      'Paid Absence Hours': totalPaidAbsence.toFixed(2),
      'Unpaid Absence Hours': totalUnpaidAbsence.toFixed(2),
      'Total Hours': totalHours.toFixed(2),
      'Approved Date': '',
    });

    if (dnwDetailsData.length === 0) {
      dnwDetailsData.push({
        'Employee Name': '-',
        'Employee ID': '-',
        'Week Ending': '-',
        'Day': '-',
        'DNW Category': '-',
        'DNW Remarks': '-',
        'DNW Reason': '-',
        'DNW Display': '-',
        'Approved Date': '-',
      });
    }

    // Generate Excel file. A fully pre-cutover export retains the legacy column shape.
    const buffer = await generateExcelFile([
      {
        sheetName: 'Payroll Report',
        columns: [
          { header: 'Employee Name', key: 'Employee Name', width: 20 },
          { header: 'Employee ID', key: 'Employee ID', width: 12 },
          { header: 'Week Ending', key: 'Week Ending', width: 12 },
          ...(usesSnapshotPayroll ? [
            { header: 'Payroll Rule', key: 'Payroll Rule', width: 16 },
            { header: 'Snapshot Revision', key: 'Snapshot Revision', width: 16 },
          ] : []),
          { header: basicHoursKey, key: basicHoursKey, width: 18 },
          { header: overtimeHoursKey, key: overtimeHoursKey, width: 20 },
          { header: doubleTimeHoursKey, key: doubleTimeHoursKey, width: 26 },
          { header: 'Worked Hours', key: 'Worked Hours', width: 14 },
          { header: 'Leave Days', key: 'Leave Days', width: 12 },
          { header: 'Paid Absence (Days)', key: 'Paid Absence (Days)', width: 18 },
          { header: 'Unpaid Absence (Days)', key: 'Unpaid Absence (Days)', width: 20 },
          { header: 'Weekly Total (Hours + Days)', key: 'Weekly Total (Hours + Days)', width: 26 },
          ...(usesSnapshotPayroll ? [
            { header: 'Operator Travel Hours', key: 'Operator Travel Hours', width: 20 },
            { header: 'IPR Units', key: 'IPR Units', width: 12 },
          ] : []),
          { header: 'Subsistence Days', key: 'Subsistence Days', width: 18 },
          { header: 'Subsistence Dates', key: 'Subsistence Dates', width: 30 },
          { header: 'Paid Absence Hours', key: 'Paid Absence Hours', width: 18 },
          { header: 'Unpaid Absence Hours', key: 'Unpaid Absence Hours', width: 20 },
          { header: 'Total Hours', key: 'Total Hours', width: 12 },
          { header: 'Approved Date', key: 'Approved Date', width: 14 },
        ],
        data: excelData,
      },
      {
        sheetName: 'Did Not Work Details',
        columns: [
          { header: 'Employee Name', key: 'Employee Name', width: 20 },
          { header: 'Employee ID', key: 'Employee ID', width: 12 },
          { header: 'Week Ending', key: 'Week Ending', width: 12 },
          { header: 'Day', key: 'Day', width: 12 },
          { header: 'DNW Category', key: 'DNW Category', width: 14 },
          { header: 'DNW Remarks', key: 'DNW Remarks', width: 30 },
          { header: 'DNW Reason', key: 'DNW Reason', width: 30 },
          { header: 'DNW Display', key: 'DNW Display', width: 42 },
          { header: 'Approved Date', key: 'Approved Date', width: 14 },
        ],
        data: dnwDetailsData,
      },
    ]);

    // Generate filename
    const filename = buildSafeReportFilename('Payroll_Report', range.filenameDateRange, 'xlsx');

    // Return Excel file
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating payroll report:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reports/timesheets/payroll',
      additionalData: {
        endpoint: '/api/reports/timesheets/payroll',
      },
    });
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
