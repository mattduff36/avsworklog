import { createClient } from '@/lib/supabase/server';
import { getActorAbsenceSecondaryPermissions, canActorUseScopedAbsencePermission } from '@/lib/server/absence-secondary-permissions';
import { getReportScopeContext, getScopedProfileIdsForModule } from '@/lib/server/report-scope';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

interface AbsenceReasonRow {
  name?: string | null;
  color?: string | null;
  is_paid?: boolean | null;
}

interface ProfileRow {
  full_name?: string | null;
  employee_id?: string | null;
  team_id?: string | null;
}

interface AbsencePrintSourceRow {
  id: string;
  profile_id: string;
  date: string;
  end_date?: string | null;
  status: string;
  notes?: string | null;
  is_half_day?: boolean | null;
  half_day_session?: 'AM' | 'PM' | null;
  is_bank_holiday?: boolean | null;
  reason?: AbsenceReasonRow | null;
  employee?: ProfileRow | null;
  record_source: 'active' | 'archived';
}

export interface PrintableAbsenceDayEntry {
  absenceId: string;
  profileId: string;
  employeeName: string;
  employeeId: string | null;
  reasonName: string;
  reasonColor: string | null;
  isPaid: boolean;
  status: string;
  notes: string | null;
  isHalfDay: boolean;
  halfDaySession: 'AM' | 'PM' | null;
  bookingStart: string;
  bookingEnd: string;
  recordSource: 'active' | 'archived';
}

export interface PrintableAbsenceDay {
  isoDate: string;
  dayLabel: string;
  dayShortLabel: string;
  displayDate: string;
  isWithinRequestedRange: boolean;
  isNationalHoliday: boolean;
  entries: PrintableAbsenceDayEntry[];
}

export interface PrintableAbsenceWeek {
  weekStartIso: string;
  weekEndIso: string;
  weekLabel: string;
  monthContextLabel: string;
  days: PrintableAbsenceDay[];
}

export interface PrintableAbsenceWeeklyReport {
  requestedDateFrom: string;
  requestedDateTo: string;
  generatedAtIso: string;
  weekCount: number;
  bookingCount: number;
  employeeCount: number;
  weeks: PrintableAbsenceWeek[];
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseIsoDateToUtc(iso: string): Date {
  const [yearRaw, monthRaw, dayRaw] = iso.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIsoDateUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysUtc(date: Date, amount: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function startOfIsoWeekUtc(date: Date): Date {
  const day = date.getUTCDay();
  const offsetFromMonday = (day + 6) % 7;
  return addDaysUtc(date, -offsetFromMonday);
}

function endOfIsoWeekUtc(date: Date): Date {
  return addDaysUtc(startOfIsoWeekUtc(date), 6);
}

function formatLongDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseIsoDateToUtc(isoDate));
}

function formatWeekRange(startIso: string, endIso: string): string {
  const start = parseIsoDateToUtc(startIso);
  const end = parseIsoDateToUtc(endIso);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function formatMonthContextLabel(startIso: string, endIso: string): string {
  const start = parseIsoDateToUtc(startIso);
  const end = parseIsoDateToUtc(endIso);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const startLabel = formatter.format(start);
  const endLabel = formatter.format(end);
  return startLabel === endLabel ? startLabel : `${startLabel} / ${endLabel}`;
}

function getSafeEndDate(row: Pick<AbsencePrintSourceRow, 'date' | 'end_date'>): string {
  return row.end_date || row.date;
}

function doesOverlapRange(row: Pick<AbsencePrintSourceRow, 'date' | 'end_date'>, dateFrom: string, dateTo: string): boolean {
  const bookingEndDate = getSafeEndDate(row);
  return row.date <= dateTo && bookingEndDate >= dateFrom;
}

function clampRange(row: Pick<AbsencePrintSourceRow, 'date' | 'end_date'>, dateFrom: string, dateTo: string): { start: string; end: string } {
  const bookingEndDate = getSafeEndDate(row);
  return {
    start: row.date > dateFrom ? row.date : dateFrom,
    end: bookingEndDate < dateTo ? bookingEndDate : dateTo,
  };
}

async function fetchAbsenceRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tableName: 'absences' | 'absences_archive',
  dateFrom: string,
  dateTo: string
): Promise<AbsencePrintSourceRow[]> {
  const reasonJoin = 'reason:absence_reasons(name,color,is_paid)';
  const employeeJoin =
    tableName === 'absences'
      ? 'employee:profiles!absences_profile_id_fkey(full_name,employee_id,team_id)'
      : 'employee:profiles!absences_archive_profile_id_fkey(full_name,employee_id,team_id)';

  const { data, error } = await supabase
    .from(tableName)
    .select(`
      id,
      profile_id,
      date,
      end_date,
      status,
      notes,
      is_half_day,
      half_day_session,
      is_bank_holiday,
      ${reasonJoin},
      ${employeeJoin}
    `)
    .neq('status', 'cancelled')
    // Push overlap lower-bound filtering to SQL to avoid pulling old historical rows.
    .or(`date.gte.${dateFrom},end_date.gte.${dateFrom}`)
    .lte('date', dateTo)
    .order('date', { ascending: true });

  if (error) {
    throw error;
  }

  const recordSource = tableName === 'absences' ? 'active' : 'archived';
  const rows = (data || []) as Array<Omit<AbsencePrintSourceRow, 'record_source'>>;
  return rows.map((row) => ({
    ...row,
    record_source: recordSource,
  }));
}

function buildWeeks(
  rows: AbsencePrintSourceRow[],
  requestedDateFrom: string,
  requestedDateTo: string
): PrintableAbsenceWeek[] {
  const requestedStartDate = parseIsoDateToUtc(requestedDateFrom);
  const requestedEndDate = parseIsoDateToUtc(requestedDateTo);
  const firstWeekStart = startOfIsoWeekUtc(requestedStartDate);
  const lastWeekEnd = endOfIsoWeekUtc(requestedEndDate);

  const dayMap = new Map<string, { isNationalHoliday: boolean; entries: PrintableAbsenceDayEntry[] }>();

  for (let cursor = firstWeekStart; cursor.getTime() <= lastWeekEnd.getTime(); cursor = addDaysUtc(cursor, 1)) {
    dayMap.set(toIsoDateUtc(cursor), {
      isNationalHoliday: false,
      entries: [],
    });
  }

  for (const row of rows) {
    const clamped = clampRange(row, requestedDateFrom, requestedDateTo);
    const clampedStart = parseIsoDateToUtc(clamped.start);
    const clampedEnd = parseIsoDateToUtc(clamped.end);

    for (let cursor = clampedStart; cursor.getTime() <= clampedEnd.getTime(); cursor = addDaysUtc(cursor, 1)) {
      const isoDate = toIsoDateUtc(cursor);
      const targetDay = dayMap.get(isoDate);
      if (!targetDay) continue;

      if (row.is_bank_holiday) {
        targetDay.isNationalHoliday = true;
      }

      targetDay.entries.push({
        absenceId: row.id,
        profileId: row.profile_id,
        employeeName: row.employee?.full_name || 'Unknown',
        employeeId: row.employee?.employee_id || null,
        reasonName: row.reason?.name || 'Unknown reason',
        reasonColor: row.reason?.color || null,
        isPaid: row.reason?.is_paid === true,
        status: row.status,
        notes: row.notes || null,
        isHalfDay: Boolean(row.is_half_day),
        halfDaySession: row.half_day_session || null,
        bookingStart: row.date,
        bookingEnd: getSafeEndDate(row),
        recordSource: row.record_source,
      });
    }
  }

  for (const day of dayMap.values()) {
    day.entries.sort((a, b) => {
      const byName = a.employeeName.localeCompare(b.employeeName);
      if (byName !== 0) return byName;
      const byReason = a.reasonName.localeCompare(b.reasonName);
      if (byReason !== 0) return byReason;
      return a.status.localeCompare(b.status);
    });
  }

  const dayShortLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekDays: PrintableAbsenceWeek[] = [];

  for (let weekStart = firstWeekStart; weekStart.getTime() <= lastWeekEnd.getTime(); weekStart = addDaysUtc(weekStart, 7)) {
    const weekEnd = addDaysUtc(weekStart, 6);
    const weekStartIso = toIsoDateUtc(weekStart);
    const weekEndIso = toIsoDateUtc(weekEnd);
    const days: PrintableAbsenceDay[] = [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const dayDate = addDaysUtc(weekStart, dayIndex);
      const dayIso = toIsoDateUtc(dayDate);
      const dayData = dayMap.get(dayIso) || { isNationalHoliday: false, entries: [] };
      days.push({
        isoDate: dayIso,
        dayLabel: new Intl.DateTimeFormat('en-GB', {
          weekday: 'long',
          timeZone: 'UTC',
        }).format(dayDate),
        dayShortLabel: dayShortLabels[dayIndex],
        displayDate: formatLongDate(dayIso),
        isWithinRequestedRange: dayIso >= requestedDateFrom && dayIso <= requestedDateTo,
        isNationalHoliday: dayData.isNationalHoliday,
        entries: dayData.entries,
      });
    }

    weekDays.push({
      weekStartIso,
      weekEndIso,
      weekLabel: formatWeekRange(weekStartIso, weekEndIso),
      monthContextLabel: formatMonthContextLabel(weekStartIso, weekEndIso),
      days,
    });
  }

  return weekDays;
}

export async function getPrintableAbsenceWeeklyReportData(input: {
  dateFrom: string;
  dateTo: string;
}): Promise<PrintableAbsenceWeeklyReport> {
  const { dateFrom, dateTo } = input;
  if (!dateFrom || !dateTo || !isValidIsoDate(dateFrom) || !isValidIsoDate(dateTo)) {
    throw new Error('Valid dateFrom and dateTo are required (YYYY-MM-DD)');
  }
  if (dateFrom > dateTo) {
    throw new Error('dateFrom cannot be after dateTo');
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Unauthorized');
  }

  const [canAccessReports, canAccessAbsence] = await Promise.all([
    canEffectiveRoleAccessModule('reports'),
    canEffectiveRoleAccessModule('absence'),
  ]);
  if (!canAccessReports || !canAccessAbsence) {
    throw new Error('Forbidden');
  }

  const [activeRows, archivedRows, scopeContext] = await Promise.all([
    fetchAbsenceRows(supabase, 'absences', dateFrom, dateTo),
    fetchAbsenceRows(supabase, 'absences_archive', dateFrom, dateTo),
    getReportScopeContext(),
  ]);

  let scopedRows = [...activeRows, ...archivedRows].filter((row) => doesOverlapRange(row, dateFrom, dateTo));

  if (!scopeContext.isAdminTier) {
    const actorUserId = scopeContext.effectiveRole.user_id;
    if (!actorUserId) {
      throw new Error('Forbidden');
    }

    const moduleScopedProfileIds = await getScopedProfileIdsForModule('absence', scopeContext);
    if (moduleScopedProfileIds && moduleScopedProfileIds.size === 0) {
      scopedRows = [];
    } else {
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
        throw new Error('Forbidden');
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
  }

  const weeks = buildWeeks(scopedRows, dateFrom, dateTo);
  const employeeCount = new Set(scopedRows.map((row) => row.profile_id)).size;

  return {
    requestedDateFrom: dateFrom,
    requestedDateTo: dateTo,
    generatedAtIso: new Date().toISOString(),
    weekCount: weeks.length,
    bookingCount: scopedRows.length,
    employeeCount,
    weeks,
  };
}
