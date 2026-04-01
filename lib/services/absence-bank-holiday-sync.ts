import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadEmployeeWorkShiftPatternMap } from '@/lib/server/work-shifts';
import { fetchCarryoverMapForFinancialYear, getEffectiveAllowance } from '@/lib/utils/absence-carryover';
import { getBankHolidaysForYear } from '@/lib/utils/bank-holidays';
import { calculateDurationDays } from '@/lib/utils/date';
import type { WorkShiftPattern } from '@/types/work-shifts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

interface BankHolidaySeedOptions {
  supabase: AnySupabase;
  financialYearStartYear?: number;
  dryRun?: boolean;
}

export interface BankHolidaySeedResult {
  financialYearStartYear: number;
  financialYearLabel: string;
  bankHolidayCount: number;
  employeeCount: number;
  created: number;
  skippedExisting: number;
  carryoverGenerated: number;
}

export interface ProfileBankHolidaySeedResult {
  financialYearStartYear: number;
  financialYearLabel: string;
  bankHolidayCount: number;
  employeeCount: number;
  created: number;
  skippedExisting: number;
}

export interface AbsenceGenerationStatus {
  currentFinancialYearStartYear: number;
  latestGeneratedFinancialYearStartYear: number;
  latestGeneratedFinancialYearLabel: string;
  latestGeneratedFinancialYearEndDate: string;
  nextFinancialYearStartYear: number;
  nextFinancialYearLabel: string;
  latestClosedFinancialYearStartYear: number | null;
  latestClosedFinancialYearLabel: string | null;
  latestClosedFinancialYearClosedAt: string | null;
  latestClosedFinancialYearClosedByName: string | null;
  latestUndoableClosedFinancialYearStartYear: number | null;
  latestUndoableClosedFinancialYearLabel: string | null;
  canUndoLatestClosedFinancialYear: boolean;
  undoCloseBlockedReason: string | null;
  closedFinancialYearStartYears: number[];
}

export interface AbsenceGenerationRemoveResult {
  removedFinancialYearStartYear: number;
  removedFinancialYearLabel: string;
  removedGeneratedAbsences: number;
  removedExistingAbsences: number;
  removedCarryovers: number;
}

export interface AbsenceGenerationCloseResult {
  closedFinancialYearStartYear: number;
  closedFinancialYearLabel: string;
  pendingCount: number;
  carryoversWritten: number;
}

export interface AbsenceGenerationUndoResult {
  undoneFinancialYearStartYear: number;
  undoneFinancialYearLabel: string;
  restoredCarryovers: number;
}

export interface BankHolidayEvent {
  title: string;
  date: string;
}

interface BulkAbsenceEmployee {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  annual_holiday_allowance_days: number | null;
  role_id: string | null;
  role_name: string | null;
  role_display_name: string | null;
}

export interface BulkAbsenceAllowanceWarning {
  profileId: string;
  fullName: string;
  employeeId: string | null;
  allowance: number;
  alreadyBooked: number;
  requestedDays: number;
  projectedRemaining: number;
}

export interface BulkAbsenceConflictDetail {
  profileId: string;
  fullName: string;
  employeeId: string | null;
  reasonName: string | null;
  status: 'approved' | 'processed' | 'pending' | string;
  conflictStartDate: string;
  conflictEndDate: string;
}

export interface BulkAbsenceBookingResult {
  startDate: string;
  endDate: string;
  reasonId: string;
  reasonName: string;
  requestedDays: number;
  requestedDaysMin: number;
  requestedDaysMax: number;
  totalEmployees: number;
  targetedEmployees: number;
  wouldCreate: number;
  createdCount: number;
  duplicateCount: number; // Fully skipped employees due to existing overlapping absences
  partialConflictEmployeeCount: number;
  conflictingWorkingDaysSkipped: number;
  createdSegmentsCount: number;
  warningCount: number;
  warnings: BulkAbsenceAllowanceWarning[];
  conflicts: BulkAbsenceConflictDetail[];
  batchId: string | null;
}

export interface BulkAbsenceBatchSummary {
  id: string;
  reasonId: string;
  reasonName: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  applyToAll: boolean;
  roleNames: string[];
  explicitProfileIds: string[];
  targetedEmployees: number;
  createdCount: number;
  duplicateCount: number;
  createdAt: string;
  createdByName: string | null;
}

export interface UndoBulkAbsenceBatchResult {
  batchId: string;
  removedAbsences: number;
}

export interface ReplayBulkAbsenceForProfileResult {
  selectedBatchCount: number;
  appliedBatchCount: number;
  skippedOutOfRangeCount: number;
  totalCreatedCount: number;
  totalDuplicateCount: number;
  totalConflictingWorkingDaysSkipped: number;
  warningCount: number;
  warnings: BulkAbsenceAllowanceWarning[];
  conflicts: BulkAbsenceConflictDetail[];
  appliedBatchIds: string[];
}

const ABSENCE_CARRYOVER_GENERATION_SOURCE = 'absence-year-end-carryover';

export function getFinancialYearStartYear(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  if (month < 3 || (month === 3 && day < 1)) {
    return year - 1;
  }
  return year;
}

export function buildFinancialYearBounds(startYear: number): { start: Date; end: Date; label: string } {
  return {
    start: new Date(startYear, 3, 1),
    end: new Date(startYear + 1, 2, 31),
    label: `${startYear}/${(startYear + 1).toString().slice(-2)}`,
  };
}

function normalizeIsoDate(value: string): string {
  return value.trim().slice(0, 10);
}

function isWeekdayIsoDate(isoDate: string): boolean {
  const date = new Date(`${isoDate}T00:00:00`);
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function formatIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface DateInterval {
  start: string;
  end: string;
}

function toDateAtMidnight(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`);
}

function addDaysIso(isoDate: string, days: number): string {
  const date = toDateAtMidnight(isoDate);
  date.setDate(date.getDate() + days);
  return formatIsoDate(date);
}

function maxIsoDate(...values: string[]): string {
  return values.reduce((maxValue, value) => (value > maxValue ? value : maxValue));
}

function minIsoDate(...values: string[]): string {
  return values.reduce((minValue, value) => (value < minValue ? value : minValue));
}

function countWeekdaysInInterval(interval: DateInterval, pattern?: WorkShiftPattern | null): number {
  const start = toDateAtMidnight(interval.start);
  const end = toDateAtMidnight(interval.end);
  return calculateDurationDays(start, end, false, { pattern: pattern || undefined });
}

function mergeDateIntervals(intervals: DateInterval[]): DateInterval[] {
  if (intervals.length <= 1) {
    return intervals.slice();
  }

  const sorted = intervals
    .slice()
    .sort((a, b) => (a.start === b.start ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start)));
  const merged: DateInterval[] = [];

  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...interval });
      continue;
    }

    const adjacentOrOverlapping = interval.start <= addDaysIso(last.end, 1);
    if (adjacentOrOverlapping) {
      if (interval.end > last.end) {
        last.end = interval.end;
      }
      continue;
    }

    merged.push({ ...interval });
  }

  return merged;
}

function subtractDateIntervals(base: DateInterval, blocked: DateInterval[]): DateInterval[] {
  const mergedBlocked = mergeDateIntervals(
    blocked
      .map((interval) => ({
        start: interval.start < base.start ? base.start : interval.start,
        end: interval.end > base.end ? base.end : interval.end,
      }))
      .filter((interval) => interval.start <= interval.end)
  );

  if (mergedBlocked.length === 0) {
    return [base];
  }

  const available: DateInterval[] = [];
  let cursor = base.start;

  for (const interval of mergedBlocked) {
    if (cursor < interval.start) {
      available.push({
        start: cursor,
        end: addDaysIso(interval.start, -1),
      });
    }
    const nextCursor = addDaysIso(interval.end, 1);
    if (nextCursor > cursor) {
      cursor = nextCursor;
    }
    if (cursor > base.end) {
      break;
    }
  }

  if (cursor <= base.end) {
    available.push({ start: cursor, end: base.end });
  }

  return available;
}

function buildHolidayKey(profileId: string, isoDate: string): string {
  return `uk-bank-holiday:england-and-wales:${profileId}:${isoDate}`;
}

function getGenerationSource(financialYearLabel: string): string {
  return `uk-bank-holiday:england-and-wales:${financialYearLabel}`;
}

async function getAnnualLeaveReasonId(supabase: AnySupabase): Promise<string> {
  const { data, error } = await supabase
    .from('absence_reasons')
    .select('id')
    .ilike('name', 'annual leave')
    .single();

  if (error || !data?.id) {
    throw new Error('Annual leave reason not found');
  }

  return data.id;
}

async function getEligibleEmployees(supabase: AnySupabase): Promise<Array<{ id: string }>> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, annual_holiday_allowance_days')
    .gt('annual_holiday_allowance_days', 0);

  if (error) {
    throw error;
  }

  return (data || []).map((row: { id: string }) => ({ id: row.id }));
}

export async function generateFinancialYearCarryovers(
  supabase: AnySupabase,
  sourceFinancialYearStartYear: number,
  targetFinancialYearStartYear: number,
  actorProfileId: string
): Promise<number> {
  const annualLeaveReasonId = await getAnnualLeaveReasonId(supabase);
  const sourceFinancialYear = buildFinancialYearBounds(sourceFinancialYearStartYear);
  const sourceStartIso = formatIsoDate(sourceFinancialYear.start);
  const sourceEndIso = formatIsoDate(sourceFinancialYear.end);

  const [
    { data: profiles, error: profilesError },
    { data: annualAbsences, error: annualAbsencesError },
    { data: sourceCarryovers, error: sourceCarryoversError },
  ] =
    await Promise.all([
      supabase
        .from('profiles')
        .select('id, annual_holiday_allowance_days')
        .order('id'),
      supabase
        .from('absences')
        .select('profile_id, duration_days')
        .eq('reason_id', annualLeaveReasonId)
        .in('status', ['approved', 'processed'])
        .gte('date', sourceStartIso)
        .lte('date', sourceEndIso),
      supabase
        .from('absence_allowance_carryovers')
        .select('profile_id, carried_days')
        .eq('financial_year_start_year', sourceFinancialYearStartYear),
    ]);

  if (profilesError) {
    throw profilesError;
  }

  if (annualAbsencesError) {
    throw annualAbsencesError;
  }
  if (sourceCarryoversError) {
    throw sourceCarryoversError;
  }

  const usedByProfile = new Map<string, number>();
  for (const row of (annualAbsences || []) as Array<{ profile_id: string; duration_days: number | null }>) {
    usedByProfile.set(row.profile_id, (usedByProfile.get(row.profile_id) || 0) + (row.duration_days || 0));
  }
  const carryInByProfile = new Map<string, number>();
  for (const row of (sourceCarryovers || []) as Array<{ profile_id: string; carried_days: number | null }>) {
    carryInByProfile.set(row.profile_id, row.carried_days || 0);
  }

  const rowsToInsert = ((profiles || []) as Array<{ id: string; annual_holiday_allowance_days: number | null }>)
    .map((profile) => {
      const baseAllowance = profile.annual_holiday_allowance_days ?? 28;
      const carryIn = carryInByProfile.get(profile.id) || 0;
      const usedDays = usedByProfile.get(profile.id) || 0;
      const carriedDays = baseAllowance + carryIn - usedDays;

      return {
        profile_id: profile.id,
        financial_year_start_year: targetFinancialYearStartYear,
        source_financial_year_start_year: sourceFinancialYearStartYear,
        carried_days: carriedDays,
        auto_generated: true,
        generation_source: ABSENCE_CARRYOVER_GENERATION_SOURCE,
        generated_by: actorProfileId,
        generated_at: new Date().toISOString(),
      };
    })
    .filter((row) => row.carried_days !== 0);

  const { error: deleteError } = await supabase
    .from('absence_allowance_carryovers')
    .delete()
    .eq('financial_year_start_year', targetFinancialYearStartYear)
    .eq('auto_generated', true)
    .eq('generation_source', ABSENCE_CARRYOVER_GENERATION_SOURCE);

  if (deleteError) {
    throw deleteError;
  }

  if (rowsToInsert.length === 0) {
    return 0;
  }

  const batchSize = 500;
  for (let i = 0; i < rowsToInsert.length; i += batchSize) {
    const chunk = rowsToInsert.slice(i, i + batchSize);
    const { error } = await supabase.from('absence_allowance_carryovers').insert(chunk);
    if (error) {
      throw error;
    }
  }

  return rowsToInsert.length;
}

export async function getFinancialYearBankHolidays(startYear: number): Promise<BankHolidayEvent[]> {
  const bounds = buildFinancialYearBounds(startYear);
  const startIso = formatIsoDate(bounds.start);
  const endIso = formatIsoDate(bounds.end);

  const [eventsStartYear, eventsEndYear] = await Promise.all([
    getBankHolidaysForYear(startYear, 'england-and-wales'),
    getBankHolidaysForYear(startYear + 1, 'england-and-wales'),
  ]);

  return [...eventsStartYear, ...eventsEndYear]
    .filter((event) => event.date >= startIso && event.date <= endIso)
    .filter((event) => isWeekdayIsoDate(event.date));
}

async function getEligibleEmployeesByIds(
  supabase: AnySupabase,
  profileIds: string[]
): Promise<Array<{ id: string }>> {
  const uniqueProfileIds = Array.from(new Set(profileIds.filter(Boolean)));
  if (uniqueProfileIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, annual_holiday_allowance_days')
    .in('id', uniqueProfileIds)
    .gt('annual_holiday_allowance_days', 0);

  if (error) {
    throw error;
  }

  return (data || []).map((row: { id: string }) => ({ id: row.id }));
}

export async function seedFinancialYearBankHolidays(
  options: BankHolidaySeedOptions
): Promise<BankHolidaySeedResult> {
  const financialYearStartYear = options.financialYearStartYear ?? getFinancialYearStartYear(new Date());
  const financialYear = buildFinancialYearBounds(financialYearStartYear);
  const annualLeaveReasonId = await getAnnualLeaveReasonId(options.supabase);
  const employees = await getEligibleEmployees(options.supabase);
  const bankHolidays = await getFinancialYearBankHolidays(financialYearStartYear);

  const allRows = employees.flatMap((employee) =>
    bankHolidays.map((holiday) => {
      const holidayKey = buildHolidayKey(employee.id, holiday.date);
      return {
        profile_id: employee.id,
        date: holiday.date,
        end_date: null,
        reason_id: annualLeaveReasonId,
        duration_days: 1,
        is_half_day: false,
        half_day_session: null,
        notes: `Auto-added UK bank holiday: ${holiday.title}`,
        status: 'approved' as const,
        created_by: null,
        approved_by: null,
        approved_at: new Date().toISOString(),
        is_bank_holiday: true,
        auto_generated: true,
        generation_source: getGenerationSource(financialYear.label),
        holiday_key: holidayKey,
      };
    })
  );

  if (allRows.length === 0) {
    return {
      financialYearStartYear,
      financialYearLabel: financialYear.label,
      bankHolidayCount: bankHolidays.length,
      employeeCount: employees.length,
      created: 0,
      skippedExisting: 0,
      carryoverGenerated: 0,
    };
  }

  const { data: existingRows, error: existingError } = await options.supabase
    .from('absences')
    .select('holiday_key')
    .eq('auto_generated', true)
    .eq('is_bank_holiday', true)
    .eq('generation_source', getGenerationSource(financialYear.label));

  if (existingError) {
    throw existingError;
  }

  const existingKeys = new Set(
    ((existingRows || []) as Array<{ holiday_key: string | null }>)
      .map((row) => row.holiday_key)
      .filter((key): key is string => !!key)
  );

  const rowsToInsert = allRows.filter((row) => !existingKeys.has(row.holiday_key));

  if (!options.dryRun && rowsToInsert.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < rowsToInsert.length; i += batchSize) {
      const chunk = rowsToInsert.slice(i, i + batchSize);
      const { error } = await options.supabase.from('absences').insert(chunk);
      if (error) {
        throw error;
      }
    }
  }

  return {
    financialYearStartYear,
    financialYearLabel: financialYear.label,
    bankHolidayCount: bankHolidays.length,
    employeeCount: employees.length,
    created: rowsToInsert.length,
    skippedExisting: allRows.length - rowsToInsert.length,
    carryoverGenerated: 0,
  };
}

export async function seedRemainingFinancialYearBankHolidaysForProfiles(options: {
  supabase: AnySupabase;
  profileIds: string[];
  financialYearStartYear?: number;
  fromDate?: string;
  dryRun?: boolean;
}): Promise<ProfileBankHolidaySeedResult> {
  const financialYearStartYear = options.financialYearStartYear ?? getFinancialYearStartYear(new Date());
  const financialYear = buildFinancialYearBounds(financialYearStartYear);
  const annualLeaveReasonId = await getAnnualLeaveReasonId(options.supabase);
  const employees = await getEligibleEmployeesByIds(options.supabase, options.profileIds);
  const bankHolidays = await getFinancialYearBankHolidays(financialYearStartYear);
  const financialYearStartIso = formatIsoDate(financialYear.start);
  const financialYearEndIso = formatIsoDate(financialYear.end);
  const fromDateIso = normalizeIsoDate(options.fromDate || formatIsoDate(new Date()));
  const effectiveStartIso = maxIsoDate(financialYearStartIso, fromDateIso);
  const futureBankHolidays = bankHolidays.filter(
    (holiday) => holiday.date >= effectiveStartIso && holiday.date <= financialYearEndIso
  );

  const allRows = employees.flatMap((employee) =>
    futureBankHolidays.map((holiday) => {
      const holidayKey = buildHolidayKey(employee.id, holiday.date);
      return {
        profile_id: employee.id,
        date: holiday.date,
        end_date: null,
        reason_id: annualLeaveReasonId,
        duration_days: 1,
        is_half_day: false,
        half_day_session: null,
        notes: `Auto-added UK bank holiday: ${holiday.title}`,
        status: 'approved' as const,
        created_by: null,
        approved_by: null,
        approved_at: new Date().toISOString(),
        is_bank_holiday: true,
        auto_generated: true,
        generation_source: getGenerationSource(financialYear.label),
        holiday_key: holidayKey,
      };
    })
  );

  if (allRows.length === 0) {
    return {
      financialYearStartYear,
      financialYearLabel: financialYear.label,
      bankHolidayCount: futureBankHolidays.length,
      employeeCount: employees.length,
      created: 0,
      skippedExisting: 0,
    };
  }

  const { data: existingRows, error: existingError } = await options.supabase
    .from('absences')
    .select('holiday_key')
    .eq('auto_generated', true)
    .eq('is_bank_holiday', true)
    .eq('generation_source', getGenerationSource(financialYear.label))
    .in('profile_id', employees.map((employee) => employee.id));

  if (existingError) {
    throw existingError;
  }

  const existingKeys = new Set(
    ((existingRows || []) as Array<{ holiday_key: string | null }>)
      .map((row) => row.holiday_key)
      .filter((key): key is string => Boolean(key))
  );

  const rowsToInsert = allRows.filter((row) => !existingKeys.has(row.holiday_key));

  if (!options.dryRun && rowsToInsert.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < rowsToInsert.length; i += batchSize) {
      const chunk = rowsToInsert.slice(i, i + batchSize);
      const { error } = await options.supabase.from('absences').insert(chunk);
      if (error) {
        throw error;
      }
    }
  }

  return {
    financialYearStartYear,
    financialYearLabel: financialYear.label,
    bankHolidayCount: futureBankHolidays.length,
    employeeCount: employees.length,
    created: rowsToInsert.length,
    skippedExisting: allRows.length - rowsToInsert.length,
  };
}

async function getLatestTrackedGenerationStartYear(
  supabase: AnySupabase
): Promise<number | null> {
  const { data, error } = await supabase
    .from('absence_financial_year_generations')
    .select('financial_year_start_year')
    .order('financial_year_start_year', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.financial_year_start_year ?? null;
}

async function getClosedFinancialYearStatus(
  supabase: AnySupabase
): Promise<{
  years: number[];
  latest: {
    financialYearStartYear: number;
    closedAt: string;
    closedByName: string | null;
  } | null;
}> {
  const { data, error } = await supabase
    .from('absence_financial_year_closures')
    .select(
      'financial_year_start_year, closed_at, closed_by_profile:profiles!absence_financial_year_closures_closed_by_fkey(full_name)'
    )
    .order('financial_year_start_year', { ascending: false });

  if (error) {
    throw error;
  }

  const rows = (data || []) as Array<{
    financial_year_start_year: number;
    closed_at: string;
    closed_by_profile?: { full_name?: string | null } | null;
  }>;

  const years = rows.map((row) => row.financial_year_start_year);
  const latestRow = rows[0];

  return {
    years,
    latest: latestRow
      ? {
          financialYearStartYear: latestRow.financial_year_start_year,
          closedAt: latestRow.closed_at,
          closedByName: latestRow.closed_by_profile?.full_name || null,
        }
      : null,
  };
}

async function getLatestCloseUndoStatus(
  supabase: AnySupabase
): Promise<{
  latestClosedFinancialYearStartYear: number | null;
  latestClosedFinancialYearLabel: string | null;
  canUndo: boolean;
  blockedReason: string | null;
}> {
  const { data, error } = await supabase.rpc('get_latest_absence_close_undo_status');

  if (error) {
    throw new Error(error.message || 'Failed to load undo-close status');
  }

  const row = ((data || [])[0] || null) as
    | {
        latest_closed_financial_year_start_year: number | null;
        latest_closed_financial_year_label: string | null;
        can_undo: boolean | null;
        blocked_reason: string | null;
      }
    | null;

  if (!row) {
    return {
      latestClosedFinancialYearStartYear: null,
      latestClosedFinancialYearLabel: null,
      canUndo: false,
      blockedReason: 'No closed financial year found to undo.',
    };
  }

  return {
    latestClosedFinancialYearStartYear: row.latest_closed_financial_year_start_year,
    latestClosedFinancialYearLabel: row.latest_closed_financial_year_label,
    canUndo: row.can_undo === true,
    blockedReason: row.blocked_reason || null,
  };
}

export async function getAbsenceGenerationStatus(
  supabase: AnySupabase
): Promise<AbsenceGenerationStatus> {
  const currentFinancialYearStartYear = getFinancialYearStartYear(new Date());
  const [latestTracked, closedYearStatus, latestCloseUndoStatus] = await Promise.all([
    getLatestTrackedGenerationStartYear(supabase),
    getClosedFinancialYearStatus(supabase),
    getLatestCloseUndoStatus(supabase),
  ]);
  const closedFinancialYearStartYears = closedYearStatus.years;
  const latestGeneratedFinancialYearStartYear =
    latestTracked === null
      ? currentFinancialYearStartYear
      : Math.max(latestTracked, currentFinancialYearStartYear);
  const latestGenerated = buildFinancialYearBounds(latestGeneratedFinancialYearStartYear);
  const nextFinancialYearStartYear = latestGeneratedFinancialYearStartYear + 1;
  const nextFinancialYear = buildFinancialYearBounds(nextFinancialYearStartYear);
  const latestClosedFinancialYearStartYear = closedFinancialYearStartYears[0] ?? null;
  const latestClosedFinancialYearLabel =
    latestClosedFinancialYearStartYear === null
      ? null
      : buildFinancialYearBounds(latestClosedFinancialYearStartYear).label;
  const latestClosedFinancialYearClosedAt = closedYearStatus.latest?.closedAt || null;
  const latestClosedFinancialYearClosedByName = closedYearStatus.latest?.closedByName || null;

  return {
    currentFinancialYearStartYear,
    latestGeneratedFinancialYearStartYear,
    latestGeneratedFinancialYearLabel: latestGenerated.label,
    latestGeneratedFinancialYearEndDate: formatIsoDate(latestGenerated.end),
    nextFinancialYearStartYear,
    nextFinancialYearLabel: nextFinancialYear.label,
    latestClosedFinancialYearStartYear,
    latestClosedFinancialYearLabel,
    latestClosedFinancialYearClosedAt,
    latestClosedFinancialYearClosedByName,
    latestUndoableClosedFinancialYearStartYear: latestCloseUndoStatus.latestClosedFinancialYearStartYear,
    latestUndoableClosedFinancialYearLabel: latestCloseUndoStatus.latestClosedFinancialYearLabel,
    canUndoLatestClosedFinancialYear: latestCloseUndoStatus.canUndo,
    undoCloseBlockedReason: latestCloseUndoStatus.blockedReason,
    closedFinancialYearStartYears,
  };
}

interface GenerateNextFinancialYearOptions {
  supabase: AnySupabase;
  actorProfileId: string;
}

export async function generateNextFinancialYearAllowances(
  options: GenerateNextFinancialYearOptions
): Promise<BankHolidaySeedResult> {
  const status = await getAbsenceGenerationStatus(options.supabase);
  const result = await seedFinancialYearBankHolidays({
    supabase: options.supabase,
    financialYearStartYear: status.nextFinancialYearStartYear,
  });

  const { error } = await options.supabase
    .from('absence_financial_year_generations')
    .upsert(
      {
        financial_year_start_year: status.nextFinancialYearStartYear,
        generated_by: options.actorProfileId,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'financial_year_start_year' }
    );

  if (error) {
    throw error;
  }

  return {
    ...result,
    carryoverGenerated: 0,
  };
}

interface CloseCurrentFinancialYearOptions {
  supabase: AnySupabase;
  actorProfileId: string;
  financialYearStartYear?: number;
  notes?: string;
}

export async function closeCurrentFinancialYearBookings(
  options: CloseCurrentFinancialYearOptions
): Promise<AbsenceGenerationCloseResult> {
  const targetFinancialYearStartYear =
    options.financialYearStartYear ?? getFinancialYearStartYear(new Date());
  const { data, error } = await options.supabase.rpc('close_absence_financial_year_bookings', {
    p_financial_year_start_year: targetFinancialYearStartYear,
    p_actor_profile_id: options.actorProfileId,
    p_notes: options.notes || null,
  });

  if (error) {
    throw new Error(error.message || 'Failed to close current year');
  }

  const row = ((data || [])[0] || null) as
    | {
        financial_year_start_year: number;
        pending_count: number;
        carryovers_written: number;
      }
    | null;

  if (!row) {
    throw new Error('No close-year result was returned');
  }

  const bounds = buildFinancialYearBounds(row.financial_year_start_year);
  return {
    closedFinancialYearStartYear: row.financial_year_start_year,
    closedFinancialYearLabel: bounds.label,
    pendingCount: row.pending_count || 0,
    carryoversWritten: row.carryovers_written || 0,
  };
}

interface UndoLatestClosedFinancialYearOptions {
  supabase: AnySupabase;
  actorProfileId: string;
}

export async function undoLatestClosedFinancialYearBookings(
  options: UndoLatestClosedFinancialYearOptions
): Promise<AbsenceGenerationUndoResult> {
  const { data, error } = await options.supabase.rpc('undo_close_absence_financial_year_bookings', {
    p_actor_profile_id: options.actorProfileId,
  });

  if (error) {
    throw new Error(error.message || 'Failed to undo close year');
  }

  const row = ((data || [])[0] || null) as
    | {
        financial_year_start_year: number;
        restored_carryovers: number;
      }
    | null;

  if (!row) {
    throw new Error('No undo-close result was returned');
  }

  const bounds = buildFinancialYearBounds(row.financial_year_start_year);
  return {
    undoneFinancialYearStartYear: row.financial_year_start_year,
    undoneFinancialYearLabel: bounds.label,
    restoredCarryovers: row.restored_carryovers || 0,
  };
}

interface RemoveGeneratedFinancialYearOptions {
  supabase: AnySupabase;
  deleteExistingBookings?: boolean;
}

export async function removeLatestGeneratedFinancialYear(
  options: RemoveGeneratedFinancialYearOptions
): Promise<AbsenceGenerationRemoveResult> {
  const { data: latestGeneration, error: latestError } = await options.supabase
    .from('absence_financial_year_generations')
    .select('id, financial_year_start_year')
    .order('financial_year_start_year', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    throw latestError;
  }

  if (!latestGeneration) {
    throw new Error('No generated financial year found to remove.');
  }

  const financialYear = buildFinancialYearBounds(latestGeneration.financial_year_start_year);
  const fyStartIso = formatIsoDate(financialYear.start);
  const fyEndIso = formatIsoDate(financialYear.end);

  const { data: userEnteredRows, error: userEnteredError } = await options.supabase
    .from('absences')
    .select('id')
    .gte('date', fyStartIso)
    .lte('date', fyEndIso)
    .eq('auto_generated', false)
    .neq('status', 'cancelled')
    .limit(1);

  if (userEnteredError) {
    throw userEnteredError;
  }

  const existingRows = userEnteredRows || [];
  const shouldDeleteExistingBookings = options.deleteExistingBookings === true;

  if (existingRows.length > 0 && !shouldDeleteExistingBookings) {
    throw new Error(
      `Cannot remove ${financialYear.label}. User-entered leave requests already exist in this financial year. Enable booking deletion to continue.`
    );
  }

  let removedExistingAbsences = 0;
  if (existingRows.length > 0 && shouldDeleteExistingBookings) {
    const { count: removedExistingCount, error: deleteExistingError } = await options.supabase
      .from('absences')
      .delete({ count: 'exact' })
      .gte('date', fyStartIso)
      .lte('date', fyEndIso)
      .eq('auto_generated', false)
      .neq('status', 'cancelled');

    if (deleteExistingError) {
      throw deleteExistingError;
    }
    removedExistingAbsences = removedExistingCount ?? 0;
  }

  const { count: removedCount, error: deleteGeneratedError } = await options.supabase
    .from('absences')
    .delete({ count: 'exact' })
    .gte('date', fyStartIso)
    .lte('date', fyEndIso)
    .eq('auto_generated', true)
    .eq('is_bank_holiday', true)
    .eq('generation_source', getGenerationSource(financialYear.label));

  if (deleteGeneratedError) {
    throw deleteGeneratedError;
  }

  const { error: deleteGenerationError } = await options.supabase
    .from('absence_financial_year_generations')
    .delete()
    .eq('id', latestGeneration.id);

  if (deleteGenerationError) {
    throw deleteGenerationError;
  }

  return {
    removedFinancialYearStartYear: latestGeneration.financial_year_start_year,
    removedFinancialYearLabel: financialYear.label,
    removedGeneratedAbsences: removedCount ?? 0,
    removedExistingAbsences,
    removedCarryovers: 0,
  };
}

async function getAnnualLeaveReason(
  supabase: AnySupabase
): Promise<{ id: string; name: string }> {
  const { data, error } = await supabase
    .from('absence_reasons')
    .select('id, name')
    .ilike('name', 'annual leave')
    .single();

  if (error || !data?.id) {
    throw new Error('Annual leave reason not found');
  }

  return data as { id: string; name: string };
}

async function getAbsenceReasonById(
  supabase: AnySupabase,
  reasonId: string
): Promise<{ id: string; name: string }> {
  const { data, error } = await supabase
    .from('absence_reasons')
    .select('id, name, is_active')
    .eq('id', reasonId)
    .single();

  if (error || !data?.id) {
    throw new Error('Absence reason not found');
  }

  if (!data.is_active) {
    throw new Error('Selected absence reason is inactive');
  }

  return { id: data.id, name: data.name };
}

async function getBulkAbsenceEmployees(supabase: AnySupabase): Promise<BulkAbsenceEmployee[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, employee_id, annual_holiday_allowance_days, roles(id, name, display_name)')
    .gt('annual_holiday_allowance_days', 0)
    .order('full_name');

  if (error) {
    throw error;
  }

  return ((data || []) as Array<Record<string, unknown>>).map((row) => {
    const roleRef = row.roles as { id?: string; name?: string; display_name?: string } | null;
    return {
      id: String(row.id || ''),
      full_name: (row.full_name as string | null) || null,
      employee_id: (row.employee_id as string | null) || null,
      annual_holiday_allowance_days: (row.annual_holiday_allowance_days as number | null) ?? null,
      role_id: roleRef?.id || null,
      role_name: roleRef?.name || null,
      role_display_name: roleRef?.display_name || null,
    };
  });
}

function buildBulkAbsenceNotes(reasonName: string, startDate: string, endDate: string, customNotes?: string | null): string {
  if (customNotes && customNotes.trim().length > 0) {
    return customNotes.trim();
  }
  if (startDate === endDate) {
    return `Bulk ${reasonName} booking: ${startDate}`;
  }
  return `Bulk ${reasonName} booking: ${startDate} to ${endDate}`;
}

interface BookBulkAbsenceOptions {
  supabase: AnySupabase;
  actorProfileId: string;
  reasonId: string;
  startDate: string;
  endDate?: string;
  notes?: string | null;
  applyToAll?: boolean;
  roleIds?: string[];
  roleNames?: string[];
  employeeIds?: string[];
  confirm?: boolean;
}

function normalizeRoleName(value: string): string {
  return value.trim().toLowerCase();
}

function resolveTargetEmployees(
  employees: BulkAbsenceEmployee[],
  applyToAll: boolean,
  roleIds: string[],
  roleNames: string[],
  employeeIds: string[]
): BulkAbsenceEmployee[] {
  if (applyToAll) {
    return employees;
  }

  const roleIdSet = new Set(roleIds.filter((value) => value.length > 0));
  const normalizedRoleSet = new Set(roleNames.map(normalizeRoleName).filter((value) => value.length > 0));
  const employeeSet = new Set(employeeIds.filter((value) => value.length > 0));

  if (roleIdSet.size === 0 && normalizedRoleSet.size === 0 && employeeSet.size === 0) {
    throw new Error('Choose at least one role or employee when not applying to all employees');
  }

  return employees.filter((employee) => {
    const inRoleIdSet = employee.role_id ? roleIdSet.has(employee.role_id) : false;
    const normalizedName = employee.role_name ? normalizeRoleName(employee.role_name) : '';
    const normalizedDisplayName = employee.role_display_name ? normalizeRoleName(employee.role_display_name) : '';
    const inRoleSet =
      normalizedRoleSet.has(normalizedName) ||
      normalizedRoleSet.has(normalizedDisplayName);
    const explicitlySelected = employeeSet.has(employee.id);
    // Union behaviour: role matches + explicitly selected employees
    return inRoleIdSet || inRoleSet || explicitlySelected;
  });
}

export async function bookBulkAbsence(
  options: BookBulkAbsenceOptions
): Promise<BulkAbsenceBookingResult> {
  const startDate = normalizeIsoDate(options.startDate);
  const endDate = normalizeIsoDate(options.endDate || options.startDate);
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid start or end date');
  }
  if (end < start) {
    throw new Error('End date cannot be before start date');
  }

  const reason = await getAbsenceReasonById(options.supabase, options.reasonId);
  const allEmployees = await getBulkAbsenceEmployees(options.supabase);
  if (allEmployees.length === 0) {
    return {
      startDate,
      endDate,
      reasonId: reason.id,
      reasonName: reason.name,
      requestedDays: 0,
      requestedDaysMin: 0,
      requestedDaysMax: 0,
      totalEmployees: 0,
      targetedEmployees: 0,
      wouldCreate: 0,
      createdCount: 0,
      duplicateCount: 0,
      partialConflictEmployeeCount: 0,
      conflictingWorkingDaysSkipped: 0,
      createdSegmentsCount: 0,
      warningCount: 0,
      warnings: [],
      conflicts: [],
      batchId: null,
    };
  }

  const applyToAll = options.applyToAll !== false;
  const roleIds = options.roleIds || [];
  const roleNames = options.roleNames || [];
  const employeeIds = options.employeeIds || [];
  const employees = resolveTargetEmployees(allEmployees, applyToAll, roleIds, roleNames, employeeIds);
  if (employees.length === 0) {
    throw new Error('No employees matched the selected filters');
  }

  const profileIds = employees.map((employee) => employee.id);
  const workShiftPatterns = await loadEmployeeWorkShiftPatternMap(createAdminClient(), profileIds);
  const requestedDaysByEmployee = new Map<string, number>();
  for (const employee of employees) {
    const pattern = workShiftPatterns.get(employee.id);
    requestedDaysByEmployee.set(employee.id, calculateDurationDays(start, end, false, { pattern }));
  }
  const requestedDayValues = employees.map((employee) => requestedDaysByEmployee.get(employee.id) || 0);
  const requestedDays = requestedDayValues.length > 0 ? Math.max(...requestedDayValues) : 0;
  const requestedDaysMin = requestedDayValues.length > 0 ? Math.min(...requestedDayValues) : 0;
  const requestedDaysMax = requestedDays;
  const hasAnyWorkingTime = requestedDaysMax > 0;

  if (!hasAnyWorkingTime) {
    throw new Error('Selected date range does not include a working day');
  }

  const financialYear = buildFinancialYearBounds(getFinancialYearStartYear(start));
  const fyStartIso = formatIsoDate(financialYear.start);
  const fyEndIso = formatIsoDate(financialYear.end);
  const carryoverByProfile = await fetchCarryoverMapForFinancialYear(
    options.supabase,
    financialYear.start.getFullYear(),
    profileIds
  );
  const reasonIsAnnualLeave = reason.name.trim().toLowerCase() === 'annual leave';
  const annualLeaveReason = reasonIsAnnualLeave ? reason : await getAnnualLeaveReason(options.supabase);

  const [{ data: annualAbsences, error: annualAbsencesError }, { data: existingRows, error: existingRowsError }] =
    await Promise.all([
      options.supabase
        .from('absences')
        .select('profile_id, duration_days, status')
        .eq('reason_id', annualLeaveReason.id)
        .in('profile_id', profileIds)
        .in('status', ['approved', 'processed', 'pending'])
        .gte('date', fyStartIso)
        .lte('date', fyEndIso),
      options.supabase
        .from('absences')
        .select('profile_id, date, end_date, status, absence_reasons(name)')
        .in('profile_id', profileIds)
        .in('status', ['approved', 'processed', 'pending'])
        .lte('date', endDate),
    ]);

  if (annualAbsencesError) {
    throw annualAbsencesError;
  }
  if (existingRowsError) {
    throw existingRowsError;
  }

  const usedByProfile = new Map<string, number>();
  for (const row of (annualAbsences || []) as Array<{ profile_id: string; duration_days: number | null }>) {
    usedByProfile.set(row.profile_id, (usedByProfile.get(row.profile_id) || 0) + (row.duration_days || 0));
  }

  const employeesById = new Map(employees.map((employee) => [employee.id, employee]));
  const conflicts: BulkAbsenceConflictDetail[] = [];
  const blockedIntervalsByProfile = new Map<string, DateInterval[]>();
  for (const row of (existingRows || []) as Array<{
    profile_id: string;
    date: string;
    end_date: string | null;
    status: string | null;
    absence_reasons?: { name?: string | null } | null;
  }>) {
    const rowEnd = row.end_date || row.date;
    const overlaps = row.date <= endDate && rowEnd >= startDate;
    if (overlaps) {
      const overlapStart = row.date < startDate ? startDate : row.date;
      const overlapEnd = rowEnd > endDate ? endDate : rowEnd;
      const existingIntervals = blockedIntervalsByProfile.get(row.profile_id) || [];
      existingIntervals.push({ start: overlapStart, end: overlapEnd });
      blockedIntervalsByProfile.set(row.profile_id, existingIntervals);
      const employee = employeesById.get(row.profile_id);
      conflicts.push({
        profileId: row.profile_id,
        fullName: employee?.full_name || 'Unknown employee',
        employeeId: employee?.employee_id || null,
        reasonName: row.absence_reasons?.name || null,
        status: row.status || 'approved',
        conflictStartDate: row.date,
        conflictEndDate: rowEnd,
      });
    }
  }
  conflicts.sort((a, b) => {
    const byName = a.fullName.localeCompare(b.fullName);
    if (byName !== 0) return byName;
    return a.conflictStartDate.localeCompare(b.conflictStartDate);
  });

  const warnings: BulkAbsenceAllowanceWarning[] = [];
  const rowsToInsert: Array<{
    profile_id: string;
    date: string;
    end_date: string | null;
    reason_id: string;
    duration_days: number;
    is_half_day: boolean;
    half_day_session: null;
    notes: string;
    status: 'approved';
    created_by: string;
    approved_by: string;
    approved_at: string;
    bulk_batch_id: string | null;
  }> = [];
  const requestedRange: DateInterval = { start: startDate, end: endDate };
  let duplicateCount = 0;
  let partialConflictEmployeeCount = 0;
  let conflictingWorkingDaysSkipped = 0;

  for (const employee of employees) {
    const employeePattern = workShiftPatterns.get(employee.id);
    const requestedDaysForEmployee = requestedDaysByEmployee.get(employee.id) || 0;
    const blockedIntervals = blockedIntervalsByProfile.get(employee.id) || [];
    const mergedBlockedIntervals = mergeDateIntervals(blockedIntervals);
    const availableIntervals = subtractDateIntervals(requestedRange, mergedBlockedIntervals);
    const employeeRows = availableIntervals
      .map((interval) => {
        const durationDays = countWeekdaysInInterval(interval, employeePattern);
        if (durationDays <= 0) {
          return null;
        }

        return {
          profile_id: employee.id,
          date: interval.start,
          end_date: interval.start === interval.end ? null : interval.end,
          reason_id: reason.id,
          duration_days: durationDays,
          is_half_day: false,
          half_day_session: null,
          notes: buildBulkAbsenceNotes(reason.name, interval.start, interval.end, options.notes),
          status: 'approved' as const,
          created_by: options.actorProfileId,
          approved_by: options.actorProfileId,
          approved_at: new Date().toISOString(),
          bulk_batch_id: null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const createdDaysForEmployee = employeeRows.reduce((total, row) => total + row.duration_days, 0);
    const skippedDaysForEmployee = Math.max(0, requestedDaysForEmployee - createdDaysForEmployee);

    if (skippedDaysForEmployee > 0) {
      conflictingWorkingDaysSkipped += skippedDaysForEmployee;
      if (createdDaysForEmployee <= 0) {
        duplicateCount += 1;
      } else {
        partialConflictEmployeeCount += 1;
      }
    }

    if (reasonIsAnnualLeave && createdDaysForEmployee > 0) {
      const allowance = getEffectiveAllowance(
        employee.annual_holiday_allowance_days,
        carryoverByProfile.get(employee.id) || 0
      );
      const alreadyBooked = usedByProfile.get(employee.id) || 0;
      const projectedRemaining = allowance - alreadyBooked - createdDaysForEmployee;
      if (projectedRemaining < 0) {
        warnings.push({
          profileId: employee.id,
          fullName: employee.full_name || 'Unknown employee',
          employeeId: employee.employee_id,
          allowance,
          alreadyBooked,
          requestedDays: createdDaysForEmployee,
          projectedRemaining,
        });
      }
    }

    rowsToInsert.push(...employeeRows);
  }
  const createdSegmentsCount = rowsToInsert.length;

  if (!options.confirm) {
    return {
      startDate,
      endDate,
      reasonId: reason.id,
      reasonName: reason.name,
      requestedDays,
      requestedDaysMin,
      requestedDaysMax,
      totalEmployees: allEmployees.length,
      targetedEmployees: employees.length,
      wouldCreate: rowsToInsert.length,
      createdCount: 0,
      duplicateCount,
      partialConflictEmployeeCount,
      conflictingWorkingDaysSkipped,
      createdSegmentsCount,
      warningCount: warnings.length,
      warnings,
      conflicts,
      batchId: null,
    };
  }

  const roleNamesForBatch = roleIds.length > 0
    ? Array.from(
        new Set(
          allEmployees
            .filter((employee) => employee.role_id && roleIds.includes(employee.role_id))
            .map((employee) => employee.role_name)
            .filter((value): value is string => Boolean(value))
        )
      )
    : roleNames;

  let batchId: string | null = null;
  if (rowsToInsert.length > 0) {
    const { data: createdBatch, error: batchError } = await options.supabase
      .from('absence_bulk_batches')
      .insert({
        created_by: options.actorProfileId,
        reason_id: reason.id,
        reason_name: reason.name,
        start_date: startDate,
        end_date: endDate,
        notes: options.notes?.trim() || null,
        apply_to_all: applyToAll,
        role_names: roleNamesForBatch,
        explicit_profile_ids: employeeIds,
        targeted_count: employees.length,
        created_count: rowsToInsert.length,
        duplicate_count: duplicateCount,
      })
      .select('id')
      .single();

    if (batchError || !createdBatch?.id) {
      throw batchError || new Error('Failed to create bulk absence batch');
    }
    batchId = createdBatch.id;

    const batchSize = 500;
    for (let i = 0; i < rowsToInsert.length; i += batchSize) {
      const chunk = rowsToInsert.slice(i, i + batchSize).map((row) => ({ ...row, bulk_batch_id: batchId }));
      const { error } = await options.supabase.from('absences').insert(chunk);
      if (error) {
        throw error;
      }
    }
  }

  return {
    startDate,
    endDate,
    reasonId: reason.id,
    reasonName: reason.name,
    requestedDays,
    requestedDaysMin,
    requestedDaysMax,
    totalEmployees: allEmployees.length,
    targetedEmployees: employees.length,
    wouldCreate: rowsToInsert.length,
    createdCount: rowsToInsert.length,
    duplicateCount,
    partialConflictEmployeeCount,
    conflictingWorkingDaysSkipped,
    createdSegmentsCount,
    warningCount: warnings.length,
    warnings,
    conflicts,
    batchId,
  };
}

export async function listBulkAbsenceBatches(
  supabase: AnySupabase,
  options?: number | { limit?: number; financialYearStartYear?: number }
): Promise<BulkAbsenceBatchSummary[]> {
  const resolvedOptions = typeof options === 'number' ? { limit: options } : (options || {});
  const limit = resolvedOptions.limit ?? 25;
  let query = supabase
    .from('absence_bulk_batches')
    .select('id, reason_id, reason_name, start_date, end_date, notes, apply_to_all, role_names, explicit_profile_ids, targeted_count, created_count, duplicate_count, created_at, created_by_profile:profiles!absence_bulk_batches_created_by_fkey(full_name)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (typeof resolvedOptions.financialYearStartYear === 'number') {
    const financialYear = buildFinancialYearBounds(resolvedOptions.financialYearStartYear);
    const financialYearStartIso = formatIsoDate(financialYear.start);
    const financialYearEndIso = formatIsoDate(financialYear.end);
    query = query
      .lte('start_date', financialYearEndIso)
      .gte('end_date', financialYearStartIso);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return ((data || []) as Array<Record<string, unknown>>).map((row) => {
    const creator = row.created_by_profile as { full_name?: string } | null;
    return {
      id: String(row.id),
      reasonId: String(row.reason_id),
      reasonName: String(row.reason_name),
      startDate: String(row.start_date),
      endDate: String(row.end_date),
      notes: (row.notes as string | null) || null,
      applyToAll: Boolean(row.apply_to_all),
      roleNames: ((row.role_names as string[] | null) || []).map((value) => String(value)),
      explicitProfileIds: ((row.explicit_profile_ids as string[] | null) || []).map((value) => String(value)),
      targetedEmployees: Number(row.targeted_count || 0),
      createdCount: Number(row.created_count || 0),
      duplicateCount: Number(row.duplicate_count || 0),
      createdAt: String(row.created_at),
      createdByName: creator?.full_name || null,
    };
  });
}

export async function replayBulkAbsenceBatchesForProfile(options: {
  supabase: AnySupabase;
  actorProfileId: string;
  profileId: string;
  batchIds: string[];
  financialYearStartYear?: number;
  fromDate?: string;
  bookBulkAbsenceFn?: typeof bookBulkAbsence;
}): Promise<ReplayBulkAbsenceForProfileResult> {
  const selectedBatchIds = Array.from(new Set(options.batchIds.filter(Boolean)));
  const bookBulkAbsenceFn = options.bookBulkAbsenceFn || bookBulkAbsence;
  if (selectedBatchIds.length === 0) {
    return {
      selectedBatchCount: 0,
      appliedBatchCount: 0,
      skippedOutOfRangeCount: 0,
      totalCreatedCount: 0,
      totalDuplicateCount: 0,
      totalConflictingWorkingDaysSkipped: 0,
      warningCount: 0,
      warnings: [],
      conflicts: [],
      appliedBatchIds: [],
    };
  }

  const financialYearStartYear = options.financialYearStartYear ?? getFinancialYearStartYear(new Date());
  const financialYear = buildFinancialYearBounds(financialYearStartYear);
  const financialYearStartIso = formatIsoDate(financialYear.start);
  const financialYearEndIso = formatIsoDate(financialYear.end);
  const fromDateIso = normalizeIsoDate(options.fromDate || formatIsoDate(new Date()));
  const replayStartFloor = maxIsoDate(financialYearStartIso, fromDateIso);

  const { data: selectedBatches, error: batchError } = await options.supabase
    .from('absence_bulk_batches')
    .select('id, reason_id, reason_name, start_date, end_date, notes')
    .in('id', selectedBatchIds);

  if (batchError) {
    throw batchError;
  }

  const batches = (selectedBatches || []) as Array<{
    id: string;
    reason_id: string;
    reason_name: string;
    start_date: string;
    end_date: string;
    notes: string | null;
  }>;

  const foundIds = new Set(batches.map((batch) => batch.id));
  const missingBatchIds = selectedBatchIds.filter((batchId) => !foundIds.has(batchId));
  if (missingBatchIds.length > 0) {
    throw new Error(`Unknown bulk batch IDs: ${missingBatchIds.join(', ')}`);
  }

  let appliedBatchCount = 0;
  let skippedOutOfRangeCount = 0;
  let totalCreatedCount = 0;
  let totalDuplicateCount = 0;
  let totalConflictingWorkingDaysSkipped = 0;
  const warnings: BulkAbsenceAllowanceWarning[] = [];
  const conflicts: BulkAbsenceConflictDetail[] = [];
  const appliedBatchIds: string[] = [];

  for (const batch of batches) {
    const clippedStart = maxIsoDate(batch.start_date, replayStartFloor);
    const clippedEnd = minIsoDate(batch.end_date, financialYearEndIso);

    if (clippedStart > clippedEnd) {
      skippedOutOfRangeCount += 1;
      continue;
    }

    const replayResult = await bookBulkAbsenceFn({
      supabase: options.supabase,
      actorProfileId: options.actorProfileId,
      reasonId: batch.reason_id,
      startDate: clippedStart,
      endDate: clippedEnd,
      notes: batch.notes || undefined,
      applyToAll: false,
      employeeIds: [options.profileId],
      confirm: true,
    });

    appliedBatchCount += 1;
    appliedBatchIds.push(batch.id);
    totalCreatedCount += replayResult.createdCount;
    totalDuplicateCount += replayResult.duplicateCount;
    totalConflictingWorkingDaysSkipped += replayResult.conflictingWorkingDaysSkipped;
    warnings.push(...replayResult.warnings);
    conflicts.push(...replayResult.conflicts);
  }

  return {
    selectedBatchCount: selectedBatchIds.length,
    appliedBatchCount,
    skippedOutOfRangeCount,
    totalCreatedCount,
    totalDuplicateCount,
    totalConflictingWorkingDaysSkipped,
    warningCount: warnings.length,
    warnings,
    conflicts,
    appliedBatchIds,
  };
}

export async function undoBulkAbsenceBatch(
  supabase: AnySupabase,
  batchId: string
): Promise<UndoBulkAbsenceBatchResult> {
  const { data: batch, error: batchError } = await supabase
    .from('absence_bulk_batches')
    .select('id')
    .eq('id', batchId)
    .maybeSingle();

  if (batchError) {
    throw batchError;
  }
  if (!batch?.id) {
    throw new Error('Bulk absence batch not found');
  }

  const { count: removedAbsences, error: deleteAbsencesError } = await supabase
    .from('absences')
    .delete({ count: 'exact' })
    .eq('bulk_batch_id', batchId);

  if (deleteAbsencesError) {
    throw deleteAbsencesError;
  }

  const { error: deleteBatchError } = await supabase
    .from('absence_bulk_batches')
    .delete()
    .eq('id', batchId);

  if (deleteBatchError) {
    throw deleteBatchError;
  }

  return {
    batchId,
    removedAbsences: removedAbsences ?? 0,
  };
}

// Backward-compatible wrapper while UI/API naming migrates from "shutdown".
export async function bookCompanyShutdownForAllStaff(
  options: Omit<BookBulkAbsenceOptions, 'reasonId' | 'applyToAll'> & { reasonId?: string }
): Promise<BulkAbsenceBookingResult> {
  const annualLeave = await getAnnualLeaveReason(options.supabase);
  return bookBulkAbsence({
    ...options,
    reasonId: options.reasonId || annualLeave.id,
    applyToAll: true,
  });
}
