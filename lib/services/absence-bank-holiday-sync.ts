import type { SupabaseClient } from '@supabase/supabase-js';
import { getBankHolidaysForYear } from '@/lib/utils/bank-holidays';

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

export function getFinancialYearStartYear(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  if (month < 3 || (month === 3 && day < 6)) {
    return year - 1;
  }
  return year;
}

export function buildFinancialYearBounds(startYear: number): { start: Date; end: Date; label: string } {
  return {
    start: new Date(startYear, 3, 6),
    end: new Date(startYear + 1, 3, 5),
    label: `${startYear}/${(startYear + 1).toString().slice(-2)}`,
  };
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
