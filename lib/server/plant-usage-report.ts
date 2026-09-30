import { loadJobCatalogueRecords } from '@/lib/server/job-catalogue';
import {
  dailyAllocationJobSheetHref,
  fleetPlantHistoryHref,
  plantInspectionHref,
} from '@/lib/navigation/canonical-links';
import {
  enumerateInclusiveIsoDates,
  fromUntyped,
  requireDailyAllocationManagerContext,
  requireDailyAllocationUser,
} from '@/lib/server/daily-allocation/auth';
import { loadPlantReconciliation } from '@/lib/server/daily-allocation/reconciliation';
import { classifyDailyAllocationSession, dailyAllocationSessionLabel } from '@/lib/utils/daily-allocation-sessions';
import { getDailyAllocationTimeMinutes } from '@/lib/utils/daily-allocation-timeline';
import type { DailyPlantReconciliationRow, DailyPlantReconciliationStatus } from '@/types/daily-allocation';
import type { ReportDateRange } from '@/lib/server/report-date-range';

export interface PlantUsageRow {
  date: string;
  plant: string;
  plant_type: string;
  job_code: string;
  job_title: string;
  site: string;
  customer: string;
  session: string;
  publication_revision: number | null;
  planned_source: string;
  check_evidence: string;
  actual_job_code: string;
  status: string;
  plant_history_url: string;
  job_sheet_url: string;
  inspection_url: string;
}

const STATUS_LABELS: Record<DailyPlantReconciliationStatus, string> = {
  matched: 'matched',
  planned_only: 'planned only',
  job_conflict: 'job conflict',
  unplanned_actual: 'unplanned actual',
  unclassified_actual: 'unclassified actual',
};

interface PublishedUsageContext {
  work_date: string;
  scope_team_id: string | null;
  plant_id: string | null;
  hired_serial: string | null;
  hired_company: string | null;
  job_code: string;
  starts_at: string;
  ends_at: string;
  revision_no: number;
  customer_name: string | null;
  title: string | null;
  site_address: string | null;
}

function sessionFromInstants(startsAt: string, endsAt: string): string {
  const startMinutes = getDailyAllocationTimeMinutes(startsAt);
  const endMinutes = getDailyAllocationTimeMinutes(endsAt);
  const session = classifyDailyAllocationSession(startMinutes, endMinutes);
  if (session) return dailyAllocationSessionLabel(session);
  const format = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return `${format(startMinutes)}-${format(endMinutes)}`;
}

function sameAsset(left: { plant_id: string | null; hired_serial: string | null; hired_company: string | null }, right: { plant_id: string | null; hired_serial: string | null; hired_company: string | null }): boolean {
  if (left.plant_id || right.plant_id) return left.plant_id === right.plant_id;
  return (left.hired_serial || '').trim().toUpperCase() === (right.hired_serial || '').trim().toUpperCase()
    && (left.hired_company || '').trim().toUpperCase() === (right.hired_company || '').trim().toUpperCase();
}

async function loadPublishedUsageContext(startDate: string, endDate: string): Promise<PublishedUsageContext[]> {
  const allocation = await requireDailyAllocationManagerContext();
  const { supabase } = await requireDailyAllocationUser();
  const { data: publications, error: publicationError } = await fromUntyped<{
    id: string;
    work_date: string;
    revision_no: number;
    snapshot_version: number;
    scope_team_id: string | null;
  }>(supabase, 'daily_allocation_publications')
    .select('id, work_date, revision_no, snapshot_version, scope_team_id')
    .gte('work_date', startDate)
    .lte('work_date', endDate);
  if (publicationError) throw publicationError;
  const latestByTeamDate = new Map<string, { id: string; work_date: string; revision_no: number; scope_team_id: string | null }>();
  for (const publication of publications || []) {
    if (publication.snapshot_version !== 2) continue;
    if (!allocation.is_admin && allocation.team_id && publication.scope_team_id !== allocation.team_id) continue;
    const key = `${publication.work_date}:${publication.scope_team_id || ''}`;
    const current = latestByTeamDate.get(key);
    if (!current || publication.revision_no > current.revision_no) {
      latestByTeamDate.set(key, publication);
    }
  }
  const publicationIds = [...latestByTeamDate.values()].map((publication) => publication.id);
  const publicationsById = new Map([...latestByTeamDate.values()].map((publication) => [publication.id, publication]));
  if (publicationIds.length === 0) return [];

  const { data: visits, error: visitError } = await fromUntyped<{
    id: string;
    publication_id: string;
    job_code: string;
    starts_at: string;
    ends_at: string;
    customer_name: string | null;
    title: string | null;
    site_address: string | null;
  }>(supabase, 'daily_allocation_published_visits')
    .select('id, publication_id, job_code, starts_at, ends_at, customer_name, title, site_address')
    .in('publication_id', publicationIds);
  if (visitError) throw visitError;
  const { data: plantRows, error: plantError } = await fromUntyped<{
    published_visit_id: string;
    plant_id: string | null;
    hired_serial: string | null;
    hired_company: string | null;
    job_code: string;
  }>(supabase, 'daily_allocation_published_plant')
    .select('published_visit_id, plant_id, hired_serial, hired_company, job_code')
    .in('publication_id', publicationIds);
  if (plantError) throw plantError;

  const visitsById = new Map((visits || []).map((visit) => [visit.id, visit]));
  const contexts: PublishedUsageContext[] = [];
  for (const plant of plantRows || []) {
    const visit = visitsById.get(plant.published_visit_id);
    const publication = publicationsById.get(visit?.publication_id || '');
    if (!visit || !publication) continue;
    contexts.push({
      work_date: publication.work_date,
      scope_team_id: publication.scope_team_id,
      plant_id: plant.plant_id,
      hired_serial: plant.hired_serial,
      hired_company: plant.hired_company,
      job_code: plant.job_code || visit.job_code,
      starts_at: visit.starts_at,
      ends_at: visit.ends_at,
      revision_no: publication.revision_no,
      customer_name: visit.customer_name,
      title: visit.title,
      site_address: visit.site_address,
    });
  }
  return contexts;
}

function matchingContext(row: DailyPlantReconciliationRow, contexts: PublishedUsageContext[]): PublishedUsageContext | null {
  const jobCode = row.planned_job_code || '';
  const matches = contexts.filter((context) => (
    context.work_date === row.work_date
    && context.job_code === jobCode
    && sameAsset(context, row)
  ));
  return matches.length === 1 ? matches[0] : null;
}

function rowFromReconciliation(
  links: { fleet: boolean; inspections: boolean },
  row: DailyPlantReconciliationRow,
  jobs: Map<string, { customer_name: string | null; title: string | null; site_address: string | null }>,
  contexts: PublishedUsageContext[],
): PlantUsageRow {
  const jobCode = row.planned_job_code || row.actual_job_code || '';
  const context = matchingContext(row, contexts);
  const catalogue = jobs.get(jobCode);
  return {
    date: row.work_date,
    plant: row.plant_label,
    plant_type: row.plant_kind === 'hired' ? 'Hired' : 'Registered',
    job_code: jobCode,
    job_title: context?.title || catalogue?.title || '',
    site: context?.site_address || catalogue?.site_address || '',
    customer: context?.customer_name || catalogue?.customer_name || '',
    session: context ? sessionFromInstants(context.starts_at, context.ends_at) : '',
    publication_revision: context?.revision_no ?? null,
    planned_source: row.planned_job_code || '',
    check_evidence: row.inspection_id ? 'submitted plant check' : '',
    actual_job_code: row.actual_job_code || '',
    status: STATUS_LABELS[row.status],
    plant_history_url: links.fleet && row.plant_kind === 'registered' && row.plant_id
      ? fleetPlantHistoryHref(row.plant_id)
      : '',
    job_sheet_url: jobCode ? dailyAllocationJobSheetHref(jobCode) : '',
    inspection_url: links.inspections && row.inspection_id ? plantInspectionHref(row.inspection_id) : '',
  };
}

export async function buildPlantUsageRows(
  range: ReportDateRange,
  links: { fleet: boolean; inspections: boolean } = { fleet: false, inspections: false },
): Promise<PlantUsageRow[]> {
  if (!range.dateFrom || !range.dateTo) return [];
  const catalogue = await loadJobCatalogueRecords();
  const jobs = new Map(catalogue.map((record) => [record.job_code, record]));
  const contexts = await loadPublishedUsageContext(range.dateFrom, range.dateTo);
  const rows: PlantUsageRow[] = [];
  for (const date of enumerateInclusiveIsoDates(range.dateFrom, range.dateTo)) {
    const day = await loadPlantReconciliation(date);
    for (const row of day.plant) {
      rows.push(rowFromReconciliation(links, row, jobs, contexts));
    }
  }
  return rows;
}

export function summarizePlantUsage(rows: PlantUsageRow[]): Array<Record<string, string | number | null>> {
  const groups = new Map<string, string[]>();
  const labels = new Map<string, { plant: string; job_code: string; statuses: Set<string> }>();
  for (const row of rows) {
    const key = `${row.plant}|${row.job_code}`;
    const dates = groups.get(key) ?? [];
    if (!dates.includes(row.date)) dates.push(row.date);
    groups.set(key, dates);
    const label = labels.get(key) ?? { plant: row.plant, job_code: row.job_code, statuses: new Set<string>() };
    label.statuses.add(row.status);
    labels.set(key, label);
  }

  const summary: Array<Record<string, string | number | null>> = [];
  for (const [key, dates] of groups) {
    const label = labels.get(key)!;
    const sorted = [...dates].sort();
    let runStart = sorted[0];
    let previous = sorted[0];
    let count = 1;
    const flush = (end: string) => {
      summary.push({
        plant: label.plant,
        job_code: label.job_code,
        first_date: runStart,
        last_date: end,
        days: count,
        statuses: [...label.statuses].join(', '),
      });
    };
    for (const date of sorted.slice(1)) {
      const expected = new Date(`${previous}T00:00:00Z`);
      expected.setUTCDate(expected.getUTCDate() + 1);
      if (expected.toISOString().slice(0, 10) === date) {
        previous = date;
        count += 1;
        continue;
      }
      flush(previous);
      runStart = date;
      previous = date;
      count = 1;
    }
    flush(previous);
  }
  return summary;
}
