import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActorAbsenceSecondaryPermissions, canActorUseScopedAbsencePermission } from '@/lib/server/absence-secondary-permissions';
import { getReportScopeContext, getScopedProfileIdsForModule } from '@/lib/server/report-scope';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { logServerError } from '@/lib/utils/server-error-logger';
import { generateExcelFile, formatExcelDate, formatExcelStatus } from '@/lib/utils/excel';

interface AbsenceReasonRow {
  name?: string | null;
  is_paid?: boolean | null;
}

interface ProfileRow {
  full_name?: string | null;
  employee_id?: string | null;
  team_id?: string | null;
}

interface ApproverRow {
  full_name?: string | null;
}

interface AbsenceReportSourceRow {
  id: string;
  profile_id: string;
  date: string;
  end_date?: string | null;
  duration_days?: number | null;
  is_half_day?: boolean | null;
  half_day_session?: 'AM' | 'PM' | null;
  status: string;
  notes?: string | null;
  approved_at?: string | null;
  reason?: AbsenceReasonRow | null;
  employee?: ProfileRow | null;
  approver?: ApproverRow | null;
  record_source: 'active' | 'archived';
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getSafeEndDate(row: Pick<AbsenceReportSourceRow, 'date' | 'end_date'>): string {
  return row.end_date || row.date;
}

function doesOverlapRange(row: Pick<AbsenceReportSourceRow, 'date' | 'end_date'>, dateFrom: string, dateTo: string): boolean {
  const bookingEndDate = getSafeEndDate(row);
  return row.date <= dateTo && bookingEndDate >= dateFrom;
}

function resolveDurationDays(row: AbsenceReportSourceRow): number {
  if (typeof row.duration_days === 'number' && Number.isFinite(row.duration_days)) {
    return row.duration_days;
  }

  if (row.is_half_day) {
    return 0.5;
  }

  const start = new Date(`${row.date}T00:00:00`);
  const end = new Date(`${getSafeEndDate(row)}T00:00:00`);
  const millisPerDay = 24 * 60 * 60 * 1000;
  const computedDays = Math.floor((end.getTime() - start.getTime()) / millisPerDay) + 1;
  return Math.max(1, computedDays);
}

function buildAbsenceExcelRow(row: AbsenceReportSourceRow): Record<string, string> {
  const durationDays = resolveDurationDays(row);
  const paidFlag = row.reason?.is_paid === true ? 'Paid' : 'Unpaid';

  return {
    'Employee Name': row.employee?.full_name || 'Unknown',
    'Employee ID': row.employee?.employee_id || '-',
    'Team ID': row.employee?.team_id || '-',
    'Booking Start': formatExcelDate(row.date),
    'Booking End': formatExcelDate(getSafeEndDate(row)),
    'Duration (Days)': durationDays.toFixed(1),
    'Half Day': row.is_half_day ? 'Yes' : 'No',
    'Session': row.half_day_session || '-',
    'Reason': row.reason?.name || 'Unknown',
    'Paid / Unpaid': paidFlag,
    'Status': formatExcelStatus(row.status),
    'Approved At': row.approved_at ? formatExcelDate(row.approved_at) : '-',
    'Approved By': row.approver?.full_name || '-',
    'Notes': row.notes || '-',
    'Source': row.record_source === 'archived' ? 'Archived' : 'Active',
  };
}

async function fetchApprovedActiveAbsences(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dateTo: string
): Promise<AbsenceReportSourceRow[]> {
  const { data, error } = await supabase
    .from('absences')
    .select(`
      id,
      profile_id,
      date,
      end_date,
      duration_days,
      is_half_day,
      half_day_session,
      status,
      notes,
      approved_at,
      reason:absence_reasons(name, is_paid),
      employee:profiles!absences_profile_id_fkey(full_name, employee_id, team_id),
      approver:profiles!absences_approved_by_fkey(full_name)
    `)
    .in('status', ['approved', 'processed'])
    .lte('date', dateTo)
    .order('date', { ascending: false });

  if (error) {
    throw error;
  }

  const rows = (data || []) as Array<Omit<AbsenceReportSourceRow, 'record_source'>>;
  return rows.map((row) => ({
    ...row,
    record_source: 'active',
  }));
}

async function fetchApprovedArchivedAbsences(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dateTo: string
): Promise<AbsenceReportSourceRow[]> {
  const { data, error } = await supabase
    .from('absences_archive')
    .select(`
      id,
      profile_id,
      date,
      end_date,
      duration_days,
      is_half_day,
      half_day_session,
      status,
      notes,
      approved_at,
      reason:absence_reasons(name, is_paid),
      employee:profiles!absences_archive_profile_id_fkey(full_name, employee_id, team_id),
      approver:profiles!absences_archive_approved_by_fkey(full_name)
    `)
    .in('status', ['approved', 'processed'])
    .lte('date', dateTo)
    .order('date', { ascending: false });

  if (error) {
    throw error;
  }

  const rows = (data || []) as Array<Omit<AbsenceReportSourceRow, 'record_source'>>;
  return rows.map((row) => ({
    ...row,
    record_source: 'archived',
  }));
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canAccessReports = await canEffectiveRoleAccessModule('reports');
    if (!canAccessReports) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const canAccessAbsenceModule = await canEffectiveRoleAccessModule('absence');
    if (!canAccessAbsenceModule) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const dateFrom = request.nextUrl.searchParams.get('dateFrom');
    const dateTo = request.nextUrl.searchParams.get('dateTo');
    if (!dateFrom || !dateTo || !isValidIsoDate(dateFrom) || !isValidIsoDate(dateTo)) {
      return NextResponse.json({ error: 'Valid dateFrom and dateTo are required (YYYY-MM-DD)' }, { status: 400 });
    }

    if (dateFrom > dateTo) {
      return NextResponse.json({ error: 'dateFrom cannot be after dateTo' }, { status: 400 });
    }

    const scopeContext = await getReportScopeContext();
    const [activeRows, archivedRows] = await Promise.all([
      fetchApprovedActiveAbsences(supabase, dateTo),
      fetchApprovedArchivedAbsences(supabase, dateTo),
    ]);

    let scopedRows = [...activeRows, ...archivedRows].filter((row) => doesOverlapRange(row, dateFrom, dateTo));

    if (!scopeContext.isAdminTier) {
      const actorUserId = scopeContext.effectiveRole.user_id;
      if (!actorUserId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const moduleScopedProfileIds = await getScopedProfileIdsForModule('absence', scopeContext);
      if (moduleScopedProfileIds && moduleScopedProfileIds.size === 0) {
        return NextResponse.json({ error: 'No absence bookings found for the selected criteria' }, { status: 404 });
      }

      const actorAbsencePermissions = await getActorAbsenceSecondaryPermissions(actorUserId, {
        role: {
          name: scopeContext.effectiveRole.role_name,
          display_name: scopeContext.effectiveRole.display_name,
          role_class: scopeContext.effectiveRole.role_class,
          is_manager_admin: scopeContext.effectiveRole.is_manager_admin,
          is_super_admin: scopeContext.effectiveRole.is_super_admin,
        },
        team_id: scopeContext.effectiveRole.team_id,
        team_name: scopeContext.effectiveRole.team_name,
      });

      const canViewBookings = Boolean(
        actorAbsencePermissions.effective.see_bookings_all ||
          actorAbsencePermissions.effective.see_bookings_team ||
          actorAbsencePermissions.effective.see_bookings_own
      );

      if (!canViewBookings) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      scopedRows = scopedRows.filter((row) => {
        if (moduleScopedProfileIds && !moduleScopedProfileIds.has(row.profile_id)) {
          return false;
        }

        return canActorUseScopedAbsencePermission({
          actorPermissions: actorAbsencePermissions,
          target: {
            profile_id: row.profile_id,
            team_id: row.employee?.team_id || null,
          },
          allKey: 'see_bookings_all',
          teamKey: 'see_bookings_team',
          ownKey: 'see_bookings_own',
        });
      });
    }

    if (scopedRows.length === 0) {
      return NextResponse.json({ error: 'No absence bookings found for the selected criteria' }, { status: 404 });
    }

    scopedRows.sort((a, b) => b.date.localeCompare(a.date));
    const excelData = scopedRows.map(buildAbsenceExcelRow);
    const paidLeaveDays = scopedRows
      .filter((row) => row.reason?.is_paid === true)
      .reduce((sum, row) => sum + resolveDurationDays(row), 0);
    const unpaidLeaveDays = scopedRows
      .filter((row) => row.reason?.is_paid !== true)
      .reduce((sum, row) => sum + resolveDurationDays(row), 0);

    excelData.push({
      'Employee Name': '',
      'Employee ID': '',
      'Team ID': '',
      'Booking Start': '',
      'Booking End': '',
      'Duration (Days)': '',
      'Half Day': '',
      'Session': '',
      'Reason': '',
      'Paid / Unpaid': '',
      'Status': '',
      'Approved At': '',
      'Approved By': '',
      'Notes': '',
      'Source': '',
    });

    excelData.push({
      'Employee Name': 'SUMMARY',
      'Employee ID': `${new Set(scopedRows.map((row) => row.profile_id)).size} employees`,
      'Team ID': '',
      'Booking Start': '',
      'Booking End': '',
      'Duration (Days)': (paidLeaveDays + unpaidLeaveDays).toFixed(1),
      'Half Day': '',
      'Session': '',
      'Reason': '',
      'Paid / Unpaid': '',
      'Status': `${scopedRows.length} bookings`,
      'Approved At': '',
      'Approved By': '',
      'Notes': `Paid ${paidLeaveDays.toFixed(1)} days | Unpaid ${unpaidLeaveDays.toFixed(1)} days`,
      'Source': '',
    });

    const buffer = await generateExcelFile([
      {
        sheetName: 'Absence & Leave',
        columns: [
          { header: 'Employee Name', key: 'Employee Name', width: 24 },
          { header: 'Employee ID', key: 'Employee ID', width: 14 },
          { header: 'Team ID', key: 'Team ID', width: 16 },
          { header: 'Booking Start', key: 'Booking Start', width: 14 },
          { header: 'Booking End', key: 'Booking End', width: 14 },
          { header: 'Duration (Days)', key: 'Duration (Days)', width: 14 },
          { header: 'Half Day', key: 'Half Day', width: 10 },
          { header: 'Session', key: 'Session', width: 10 },
          { header: 'Reason', key: 'Reason', width: 20 },
          { header: 'Paid / Unpaid', key: 'Paid / Unpaid', width: 14 },
          { header: 'Status', key: 'Status', width: 12 },
          { header: 'Approved At', key: 'Approved At', width: 14 },
          { header: 'Approved By', key: 'Approved By', width: 20 },
          { header: 'Notes', key: 'Notes', width: 42 },
          { header: 'Source', key: 'Source', width: 12 },
        ],
        data: excelData,
      },
    ]);

    const filename = `Absence_Leave_Bookings_${dateFrom}_to_${dateTo}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating absence leave report:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/reports/absence-leave/bookings',
      additionalData: {
        endpoint: '/api/reports/absence-leave/bookings',
      },
    });

    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
