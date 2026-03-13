import type { SupabaseClient } from '@supabase/supabase-js';
import { getBankHolidaysForYear } from '@/lib/utils/bank-holidays';
import { calculateDurationDays } from '@/lib/utils/date';

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
}

export interface AbsenceGenerationStatus {
  currentFinancialYearStartYear: number;
  latestGeneratedFinancialYearStartYear: number;
  latestGeneratedFinancialYearLabel: string;
  latestGeneratedFinancialYearEndDate: string;
  nextFinancialYearStartYear: number;
  nextFinancialYearLabel: string;
}

export interface AbsenceGenerationRemoveResult {
  removedFinancialYearStartYear: number;
  removedFinancialYearLabel: string;
  removedGeneratedAbsences: number;
}

interface BankHolidayEvent {
  title: string;
  date: string;
}

interface BulkShutdownEmployee {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  annual_holiday_allowance_days: number | null;
}

export interface ShutdownAllowanceWarning {
  profileId: string;
  fullName: string;
  employeeId: string | null;
  allowance: number;
  alreadyBooked: number;
  requestedDays: number;
  projectedRemaining: number;
}

export interface CompanyShutdownBookingResult {
  startDate: string;
  endDate: string;
  requestedDays: number;
  totalEmployees: number;
  wouldCreate: number;
  createdCount: number;
  duplicateCount: number;
  warningCount: number;
  warnings: ShutdownAllowanceWarning[];
}

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

async function getFinancialYearBankHolidays(startYear: number): Promise<BankHolidayEvent[]> {
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

export async function getAbsenceGenerationStatus(
  supabase: AnySupabase
): Promise<AbsenceGenerationStatus> {
  const currentFinancialYearStartYear = getFinancialYearStartYear(new Date());
  const latestTracked = await getLatestTrackedGenerationStartYear(supabase);
  const latestGeneratedFinancialYearStartYear =
    latestTracked === null
      ? currentFinancialYearStartYear
      : Math.max(latestTracked, currentFinancialYearStartYear);
  const latestGenerated = buildFinancialYearBounds(latestGeneratedFinancialYearStartYear);
  const nextFinancialYearStartYear = latestGeneratedFinancialYearStartYear + 1;
  const nextFinancialYear = buildFinancialYearBounds(nextFinancialYearStartYear);

  return {
    currentFinancialYearStartYear,
    latestGeneratedFinancialYearStartYear,
    latestGeneratedFinancialYearLabel: latestGenerated.label,
    latestGeneratedFinancialYearEndDate: formatIsoDate(latestGenerated.end),
    nextFinancialYearStartYear,
    nextFinancialYearLabel: nextFinancialYear.label,
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

  return result;
}

interface RemoveGeneratedFinancialYearOptions {
  supabase: AnySupabase;
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

  if ((userEnteredRows || []).length > 0) {
    throw new Error(
      `Cannot remove ${financialYear.label}. User-entered leave requests already exist in this financial year.`
    );
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

async function getBulkShutdownEmployees(supabase: AnySupabase): Promise<BulkShutdownEmployee[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, employee_id, annual_holiday_allowance_days')
    .order('full_name');

  if (error) {
    throw error;
  }

  return (data || []) as BulkShutdownEmployee[];
}

function buildShutdownNotes(startDate: string, endDate: string, customNotes?: string | null): string {
  if (customNotes && customNotes.trim().length > 0) {
    return customNotes.trim();
  }
  if (startDate === endDate) {
    return `Company shutdown: ${startDate}`;
  }
  return `Company shutdown: ${startDate} to ${endDate}`;
}

interface BookCompanyShutdownOptions {
  supabase: AnySupabase;
  actorProfileId: string;
  startDate: string;
  endDate?: string;
  notes?: string | null;
  confirm?: boolean;
}

export async function bookCompanyShutdownForAllStaff(
  options: BookCompanyShutdownOptions
): Promise<CompanyShutdownBookingResult> {
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

  const requestedDays = calculateDurationDays(start, end, false);
  if (requestedDays <= 0) {
    throw new Error('Selected shutdown range does not include a working day');
  }

  const annualLeaveReason = await getAnnualLeaveReason(options.supabase);
  const employees = await getBulkShutdownEmployees(options.supabase);
  if (employees.length === 0) {
    return {
      startDate,
      endDate,
      requestedDays,
      totalEmployees: 0,
      wouldCreate: 0,
      createdCount: 0,
      duplicateCount: 0,
      warningCount: 0,
      warnings: [],
    };
  }

  const profileIds = employees.map((employee) => employee.id);
  const financialYear = buildFinancialYearBounds(getFinancialYearStartYear(start));
  const fyStartIso = formatIsoDate(financialYear.start);
  const fyEndIso = formatIsoDate(financialYear.end);

  const [{ data: annualAbsences, error: annualAbsencesError }, { data: existingRows, error: existingRowsError }] =
    await Promise.all([
      options.supabase
        .from('absences')
        .select('profile_id, duration_days, status')
        .eq('reason_id', annualLeaveReason.id)
        .in('profile_id', profileIds)
        .in('status', ['approved', 'pending'])
        .gte('date', fyStartIso)
        .lte('date', fyEndIso),
      options.supabase
        .from('absences')
        .select('profile_id, date, end_date')
        .eq('reason_id', annualLeaveReason.id)
        .in('profile_id', profileIds)
        .in('status', ['approved', 'pending']),
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

  const existingKeySet = new Set<string>();
  const normalizedEndDate = endDate === startDate ? null : endDate;
  for (const row of (existingRows || []) as Array<{ profile_id: string; date: string; end_date: string | null }>) {
    const existingKey = `${row.profile_id}:${row.date}:${row.end_date || ''}`;
    existingKeySet.add(existingKey);
  }

  const warnings: ShutdownAllowanceWarning[] = [];
  const rowsToInsert = employees
    .filter((employee) => {
      const key = `${employee.id}:${startDate}:${normalizedEndDate || ''}`;
      return !existingKeySet.has(key);
    })
    .map((employee) => {
      const allowance = employee.annual_holiday_allowance_days ?? 28;
      const alreadyBooked = usedByProfile.get(employee.id) || 0;
      const projectedRemaining = allowance - alreadyBooked - requestedDays;
      if (projectedRemaining < 0) {
        warnings.push({
          profileId: employee.id,
          fullName: employee.full_name || 'Unknown employee',
          employeeId: employee.employee_id,
          allowance,
          alreadyBooked,
          requestedDays,
          projectedRemaining,
        });
      }

      return {
        profile_id: employee.id,
        date: startDate,
        end_date: normalizedEndDate,
        reason_id: annualLeaveReason.id,
        duration_days: requestedDays,
        is_half_day: false,
        half_day_session: null,
        notes: buildShutdownNotes(startDate, endDate, options.notes),
        status: 'approved' as const,
        created_by: options.actorProfileId,
        approved_by: options.actorProfileId,
        approved_at: new Date().toISOString(),
      };
    });

  if (!options.confirm) {
    return {
      startDate,
      endDate,
      requestedDays,
      totalEmployees: employees.length,
      wouldCreate: rowsToInsert.length,
      createdCount: 0,
      duplicateCount: employees.length - rowsToInsert.length,
      warningCount: warnings.length,
      warnings,
    };
  }

  if (rowsToInsert.length > 0) {
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
    startDate,
    endDate,
    requestedDays,
    totalEmployees: employees.length,
    wouldCreate: rowsToInsert.length,
    createdCount: rowsToInsert.length,
    duplicateCount: employees.length - rowsToInsert.length,
    warningCount: warnings.length,
    warnings,
  };
}
