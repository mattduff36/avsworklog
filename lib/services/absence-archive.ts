import type { SupabaseClient } from '@supabase/supabase-js';
import { buildFinancialYearBounds, getFinancialYearStartYear } from '@/lib/services/absence-bank-holiday-sync';
import type { AbsenceWithRelations } from '@/types/absence';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

type ArchiveRunRow = {
  id: string;
  financial_year_start_year: number;
  archived_at: string;
  archived_by: string | null;
  row_count: number;
  notes: string | null;
  idempotency_key: string | null;
};

type ArchiveRunRpcResult = {
  archive_run_id: string;
  financial_year_start_year: number;
  row_count: number;
  skipped: boolean;
};

export interface ArchiveRunSummary {
  archiveRunId: string;
  financialYearStartYear: number;
  financialYearLabel: string;
  movedRows: number;
  skipped: boolean;
}

export interface ArchiveRunBatchResult {
  summaries: ArchiveRunSummary[];
  eligibleFinancialYearStartYears: number[];
  durationMs: number;
}

export interface ArchiveStatusResult {
  currentFinancialYearStartYear: number;
  eligibleFinancialYearStartYears: number[];
  archivedFinancialYearStartYears: number[];
  latestRun: ArchiveRunRow | null;
  runs: ArchiveRunRow[];
}

interface ArchiveReportFilters {
  financialYearStartYear?: number;
  profileId?: string;
  reasonId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface ArchiveReportResult {
  rows: AbsenceWithRelations[];
  total: number;
  page: number;
  pageSize: number;
}

function hasValue(value?: string): value is string {
  return !!value && value.trim().length > 0;
}

export function isClosedFinancialYearDate(isoDate: string): boolean {
  const target = new Date(`${isoDate}T00:00:00`);
  const fyStartYear = getFinancialYearStartYear(target);
  const bounds = buildFinancialYearBounds(fyStartYear);
  const fyEnd = new Date(bounds.end);
  fyEnd.setHours(23, 59, 59, 999);
  return new Date() > fyEnd;
}

export async function getArchiveEligibleFinancialYears(supabase: AnySupabase): Promise<number[]> {
  const { data, error } = await supabase.rpc('get_archive_eligible_financial_years');
  if (error) throw error;
  return ((data || []) as Array<{ financial_year_start_year: number }>)
    .map((row) => row.financial_year_start_year)
    .sort((a, b) => a - b);
}

export async function getAbsenceArchiveStatus(supabase: AnySupabase): Promise<ArchiveStatusResult> {
  const [eligibleYears, runsResult] = await Promise.all([
    getArchiveEligibleFinancialYears(supabase),
    supabase
      .from('absence_financial_year_archives')
      .select('id, financial_year_start_year, archived_at, archived_by, row_count, notes, idempotency_key')
      .order('financial_year_start_year', { ascending: false })
      .order('archived_at', { ascending: false }),
  ]);

  if (runsResult.error) {
    throw runsResult.error;
  }

  const runs = (runsResult.data || []) as ArchiveRunRow[];
  const archivedFinancialYearStartYears = Array.from(
    new Set(runs.map((run) => run.financial_year_start_year))
  ).sort((a, b) => a - b);

  return {
    currentFinancialYearStartYear: getFinancialYearStartYear(new Date()),
    eligibleFinancialYearStartYears: eligibleYears,
    archivedFinancialYearStartYears,
    latestRun: runs[0] || null,
    runs,
  };
}

export async function runAbsenceFinancialYearArchive(
  supabase: AnySupabase,
  options: {
    financialYearStartYear?: number;
    allEligible?: boolean;
    force?: boolean;
    notes?: string;
    actorId: string;
  }
): Promise<ArchiveRunBatchResult> {
  const startedAt = Date.now();
  const status = await getAbsenceArchiveStatus(supabase);

  const hasSpecificYear = typeof options.financialYearStartYear === 'number';
  const targetYears = options.allEligible
    ? status.eligibleFinancialYearStartYears
    : hasSpecificYear
    ? [options.financialYearStartYear]
    : [];

  if (targetYears.length === 0) {
    return {
      summaries: [],
      eligibleFinancialYearStartYears: status.eligibleFinancialYearStartYears,
      durationMs: Date.now() - startedAt,
    };
  }

  const summaries: ArchiveRunSummary[] = [];

  for (const startYear of targetYears) {
    const idempotencyKey = `absence-archive:${startYear}`;
    const { data, error } = await supabase.rpc('archive_closed_financial_year_absences', {
      p_financial_year_start_year: startYear,
      p_archived_by: options.actorId,
      p_notes: options.notes ?? null,
      p_idempotency_key: options.force ? null : idempotencyKey,
      p_force: options.force === true,
    });

    if (error) {
      throw error;
    }

    const result = ((data || [])[0] || null) as ArchiveRunRpcResult | null;
    if (!result) {
      throw new Error(`Archive run failed for FY ${startYear}: no result returned`);
    }

    const financialYearLabel = buildFinancialYearBounds(result.financial_year_start_year).label;
    summaries.push({
      archiveRunId: result.archive_run_id,
      financialYearStartYear: result.financial_year_start_year,
      financialYearLabel,
      movedRows: result.row_count,
      skipped: result.skipped,
    });
  }

  return {
    summaries,
    eligibleFinancialYearStartYears: status.eligibleFinancialYearStartYears,
    durationMs: Date.now() - startedAt,
  };
}

export async function getAbsenceArchiveReport(
  supabase: AnySupabase,
  filters: ArchiveReportFilters
): Promise<ArchiveReportResult> {
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(250, Math.max(1, filters.pageSize || 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('absences_archive')
    .select(
      `
      *,
      absence_reasons (*),
      profiles!absences_archive_profile_id_fkey (full_name, employee_id),
      created_by_profile:profiles!absences_archive_created_by_fkey (full_name),
      approved_by_profile:profiles!absences_archive_approved_by_fkey (full_name)
    `,
      { count: 'exact' }
    )
    .order('date', { ascending: false })
    .range(from, to);

  if (typeof filters.financialYearStartYear === 'number') {
    query = query.eq('financial_year_start_year', filters.financialYearStartYear);
  }
  if (hasValue(filters.profileId)) {
    query = query.eq('profile_id', filters.profileId);
  }
  if (hasValue(filters.reasonId)) {
    query = query.eq('reason_id', filters.reasonId);
  }
  if (hasValue(filters.status)) {
    query = query.eq('status', filters.status);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = ((data || []) as AbsenceWithRelations[]).map((row) => ({
    ...row,
    record_source: 'archived' as const,
  }));

  return {
    rows,
    total: count || 0,
    page,
    pageSize,
  };
}
