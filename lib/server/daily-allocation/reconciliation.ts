import { createAdminClient } from '@/lib/supabase/admin';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';
import { normalizeHiredPlantSerial } from '@/lib/utils/job-catalogue';
import { listJobCatalogueOptions, loadJobCatalogueRecords, resolveJobCatalogueRecord } from '@/lib/server/job-catalogue';
import {
  DailyAllocationError,
  fromUntyped,
  getDailyAllocationContext,
  isWorkDate,
  loadScopedProfileIds,
  requireDailyAllocationManagerContext,
  requireDailyAllocationUser,
} from '@/lib/server/daily-allocation/auth';
import { instructionsFromRow, snapshotVersionFromValue } from '@/lib/server/daily-allocation/legacy-adapter';
import {
  collapsePublishedPlantForDay,
  plantAssetKey,
  selectLatestPublicationsByDateTeam,
  type PlannedPlantSnapshot,
  type PublicationReadRow,
  type PublishedLabourRow,
  type PublishedPlantRow,
  type PublishedVisitRow,
} from '@/lib/server/daily-allocation/reads';
import { formatDailyAllocationVisitTime } from '@/lib/utils/daily-allocation-timeline';
import type { Database } from '@/types/database';
import type {
  DailyAllocationAvailability,
  DailyJobSheetPayload,
  DailyPlantReconciliationRow,
  DailyPlantReconciliationStatus,
} from '@/types/daily-allocation';

type LabourItemRow = Database['public']['Tables']['daily_allocation_labour_items']['Row'];
type PlantItemRow = Database['public']['Tables']['daily_allocation_plant_items']['Row'];

type PlannedPlantInput = {
  plant_kind: PlantItemRow['plant_kind'];
  plant_id: string | null;
  hired_serial: string | null;
  hired_description?: string | null;
  hired_company?: string | null;
  hired_serial_normalized?: string | null;
  hired_company_normalized?: string | null;
  job_code: string | null;
};

export function applyDistinctJobDaySemantics(
  rows: DailyPlantReconciliationRow[],
  planned: Array<Pick<PlannedPlantSnapshot, 'distinct_job_codes'> & Parameters<typeof plantAssetKey>[0]>
): DailyPlantReconciliationRow[] {
  const conflictKeys = new Set(
    planned
      .filter((item) => item.distinct_job_codes.length > 1)
      .map((item) => plantAssetKey(item))
  );
  if (!conflictKeys.size) return rows;
  return rows.map((row) => (
    conflictKeys.has(plantAssetKey(row))
      ? { ...row, status: 'job_conflict' as const }
      : row
  ));
}

export function reconcilePlant<T extends PlannedPlantInput>(
  planned: T[],
  inspections: Array<{
    id: string;
    inspection_date: string;
    plant_id: string | null;
    is_hired_plant: boolean;
    hired_plant_id_serial: string | null;
    hired_plant_hiring_company: string | null;
    hired_plant_description: string | null;
    job_code: string | null;
    status: string;
  }>,
  plantById: Map<string, { plant_id: string; nickname: string | null }>,
  workDate?: string
): DailyPlantReconciliationRow[] {
  const submitted = inspections.filter((row) => (
    row.status === 'submitted'
    && (!workDate || row.inspection_date === workDate)
  ));
  const usedInspectionIds = new Set<string>();
  const rows: DailyPlantReconciliationRow[] = [];

  for (const item of planned) {
    const matches = submitted.filter((inspection) => {
      if (!inspection.job_code) return false;
      if (item.plant_kind === 'registered') return inspection.plant_id === item.plant_id;
      return normalizeHiredPlantSerial(inspection.hired_plant_id_serial) === (item.hired_serial_normalized || '')
        && normalizeHiredPlantSerial(inspection.hired_plant_hiring_company) === (item.hired_company_normalized || '');
    }).sort((left, right) => left.id.localeCompare(right.id));
    const uniqueByAsset = new Map<string, typeof matches[number]>();
    for (const match of matches) {
      const key = item.plant_kind === 'registered'
        ? `registered:${match.plant_id}`
        : `hired:${normalizeHiredPlantSerial(match.hired_plant_id_serial)}:${normalizeHiredPlantSerial(match.hired_plant_hiring_company)}`;
      if (!uniqueByAsset.has(key)) uniqueByAsset.set(key, match);
    }
    const actual = Array.from(uniqueByAsset.values())[0] || null;
    if (actual) usedInspectionIds.add(actual.id);
    matches.slice(1).forEach((match) => usedInspectionIds.add(match.id));
    const actualJobs = Array.from(new Set(
      matches
        .map((match) => match.job_code)
        .filter((job): job is string => Boolean(job))
    ));
    const actualJob = actualJobs.length > 1
      ? actualJobs.sort((left, right) => left.localeCompare(right)).join(', ')
      : actual?.job_code || null;
    let status: DailyPlantReconciliationStatus = 'planned_only';
    if (actual && (actualJobs.length > 1 || (actualJob && actualJob !== item.job_code))) status = 'job_conflict';
    else if (actual) status = 'matched';
    const registered = item.plant_id ? plantById.get(item.plant_id) : null;
    rows.push({
      work_date: workDate || '',
      plant_kind: item.plant_kind,
      plant_id: item.plant_id,
      hired_serial: item.hired_serial,
      plant_label: item.plant_kind === 'hired'
        ? `${item.hired_description || 'Hired plant'} (${item.hired_serial || 'no serial'})`
        : formatFleetAssetLabel({
            identifier: registered?.plant_id || item.plant_id || 'Plant',
            nickname: registered?.nickname,
          }),
      planned_job_code: item.job_code,
      actual_job_code: actualJob,
      inspection_id: actual?.id || null,
      status,
    });
  }

  for (const inspection of submitted) {
    if (usedInspectionIds.has(inspection.id)) continue;
    const registered = inspection.plant_id ? plantById.get(inspection.plant_id) : null;
    rows.push({
      work_date: inspection.inspection_date,
      plant_kind: inspection.is_hired_plant ? 'hired' : 'registered',
      plant_id: inspection.plant_id,
      hired_serial: inspection.hired_plant_id_serial,
      plant_label: inspection.is_hired_plant
        ? `${inspection.hired_plant_description || 'Hired plant'} (${inspection.hired_plant_id_serial || 'no serial'})`
        : formatFleetAssetLabel({
            identifier: registered?.plant_id || inspection.plant_id || 'Plant',
            nickname: registered?.nickname,
          }),
      planned_job_code: null,
      actual_job_code: inspection.job_code,
      inspection_id: inspection.id,
      status: inspection.job_code ? 'unplanned_actual' : 'unclassified_actual',
    });
  }

  return rows;
}

async function loadPublicationsForIds(supabase: Awaited<ReturnType<typeof requireDailyAllocationUser>>['supabase'], ids: string[]) {
  if (!ids.length) return [] as PublicationReadRow[];
  const { data, error } = await fromUntyped<PublicationReadRow>(supabase, 'daily_allocation_publications')
    .select('id, work_date, revision_no, published_at, published_by, scope_team_id, snapshot_version, plan_day_id, published_plan_version, confirm_unallocated')
    .in('id', ids);
  if (error) throw error;
  return data || [];
}

function jobSheetSourceHref(record: { source_type: string; source_id: string } | null): string | null {
  if (!record) return null;
  if (record.source_type === 'live_quote') return `/quotes?quote_id=${record.source_id}`;
  if (record.source_type === 'project_number') return '/quotes?tab=projects';
  return '/quotes?tab=legacy';
}

export async function loadJobSheet(jobCode: string): Promise<DailyJobSheetPayload> {
  const context = await getDailyAllocationContext();
  if (!context.is_manager) {
    throw new DailyAllocationError('Manager-level daily allocation access is required.', 403);
  }

  const admin = createAdminClient();
  const records = await loadJobCatalogueRecords(admin);
  const resolved = resolveJobCatalogueRecord(records, { jobCode });
  const { supabase } = await requireDailyAllocationUser();

  const canonicalJobCode = resolved.record?.job_code || jobCode;
  const { data: labourItems, error: labourError } = await supabase
    .from('daily_allocation_labour_items')
    .select('*')
    .eq('job_code', canonicalJobCode)
    .order('created_at', { ascending: false });
  if (labourError) throw labourError;

  const { data: plantItemsForJob, error: plantJobError } = await supabase
    .from('daily_allocation_plant_items')
    .select('*')
    .eq('job_code', canonicalJobCode);
  if (plantJobError) throw plantJobError;

  const { data: publishedVisitsForJob, error: publishedVisitError } = await fromUntyped<PublishedVisitRow>(
    supabase,
    'daily_allocation_published_visits'
  )
    .select('id, publication_id, sequence_no, work_date, job_code, site_address, customer_name, title, starts_at, ends_at, meeting_point, meet_person, notes')
    .eq('job_code', canonicalJobCode);
  if (publishedVisitError) throw publishedVisitError;

  const { data: publishedPlantForJob, error: publishedPlantError } = await fromUntyped<PublishedPlantRow>(
    supabase,
    'daily_allocation_published_plant'
  )
    .select('id, publication_id, published_visit_id, plant_kind, plant_id, hired_serial, hired_description, hired_company, hired_serial_normalized, hired_company_normalized, owner_team_id, job_code, site_address, notes')
    .eq('job_code', canonicalJobCode);
  if (publishedPlantError) throw publishedPlantError;

  const relatedPublicationIds = Array.from(new Set([
    ...(labourItems || []).map((item) => item.publication_id),
    ...(plantItemsForJob || []).map((item) => item.publication_id),
    ...(publishedVisitsForJob || []).map((item) => item.publication_id),
    ...(publishedPlantForJob || []).map((item) => item.publication_id),
  ]));
  const relatedPublications = await loadPublicationsForIds(supabase, relatedPublicationIds);

  const relatedDates = Array.from(new Set(relatedPublications.map((row) => row.work_date)));
  const { data: publications, error: publicationsError } = relatedDates.length
    ? await fromUntyped<PublicationReadRow>(supabase, 'daily_allocation_publications')
      .select('id, work_date, revision_no, published_at, published_by, scope_team_id, snapshot_version, plan_day_id, published_plan_version, confirm_unallocated')
      .in('work_date', relatedDates)
    : { data: relatedPublications, error: null };
  if (publicationsError) throw publicationsError;

  const publicationById = new Map((publications || []).map((row) => [row.id, row]));
  const latestPublications = selectLatestPublicationsByDateTeam(publications || []);
  const latestV1Ids = new Set(
    latestPublications
      .filter((row) => snapshotVersionFromValue(row.snapshot_version) === 1)
      .map((row) => row.id)
  );
  const latestV2Ids = new Set(
    latestPublications
      .filter((row) => snapshotVersionFromValue(row.snapshot_version) === 2)
      .map((row) => row.id)
  );

  const allPublicationIds = (publications || []).map((row) => row.id);
  const { data: allLabourItems, error: allLabourError } = allPublicationIds.length
    ? await supabase
        .from('daily_allocation_labour_items')
        .select('*')
        .in('publication_id', allPublicationIds)
    : { data: [] as LabourItemRow[], error: null };
  if (allLabourError) throw allLabourError;

  const latestLabourByDateProfile = new Map<string, LabourItemRow>();
  for (const item of allLabourItems || []) {
    if (!latestV1Ids.has(item.publication_id)) continue;
    const publication = publicationById.get(item.publication_id);
    if (!publication) continue;
    const key = `${publication.work_date}:${item.profile_id}`;
    const current = latestLabourByDateProfile.get(key);
    const currentRevision = current
      ? publicationById.get(current.publication_id)?.revision_no || 0
      : -1;
    if (!current || publication.revision_no > currentRevision) {
      latestLabourByDateProfile.set(key, item);
    }
  }
  const latestV1Labour = Array.from(latestLabourByDateProfile.values())
    .filter((item) => item.job_code === canonicalJobCode);

  const latestV2VisitIds = new Set(
    (publishedVisitsForJob || [])
      .filter((visit) => latestV2Ids.has(visit.publication_id))
      .map((visit) => visit.id)
  );
  const latestV2Visits = (publishedVisitsForJob || []).filter((visit) => latestV2VisitIds.has(visit.id));
  const visitsById = new Map(latestV2Visits.map((visit) => [visit.id, visit]));

  const latestV2PublicationIdList = Array.from(latestV2Ids);
  const { data: v2Labour, error: v2LabourError } = latestV2PublicationIdList.length
    ? await fromUntyped<PublishedLabourRow>(supabase, 'daily_allocation_published_labour')
      .select('*')
      .in('publication_id', latestV2PublicationIdList)
    : { data: [] as PublishedLabourRow[], error: null };
  if (v2LabourError) throw v2LabourError;
  const latestV2Labour = (v2Labour || []).filter((row) => (
    row.published_visit_id != null && latestV2VisitIds.has(row.published_visit_id)
  ));

  const plantItems = (plantItemsForJob || []).filter((item) => latestV1Ids.has(item.publication_id));
  const v2PlantItems = (publishedPlantForJob || []).filter((item) => latestV2Ids.has(item.publication_id));

  const scopedProfileIds = await loadScopedProfileIds(supabase, context.is_admin);
  const inspectionScope = scopedProfileIds.length
    ? scopedProfileIds
    : ['00000000-0000-0000-0000-000000000000'];
  const { data: jobInspections } = await admin
    .from('plant_inspections')
    .select('id, user_id, inspection_date, plant_id, is_hired_plant, hired_plant_id_serial, hired_plant_hiring_company, hired_plant_description, job_code, status')
    .eq('job_code', canonicalJobCode)
    .in('user_id', inspectionScope);
  const inspectionDates = Array.from(new Set((jobInspections || []).map((row) => row.inspection_date)));
  const workDates = Array.from(new Set([...relatedDates, ...inspectionDates]));
  const { data: inspections } = workDates.length
    ? await admin
        .from('plant_inspections')
        .select('id, user_id, inspection_date, plant_id, is_hired_plant, hired_plant_id_serial, hired_plant_hiring_company, hired_plant_description, job_code, status')
        .in('inspection_date', workDates)
        .in('user_id', inspectionScope)
    : { data: jobInspections || [] };

  const { data: plants } = await admin
    .from('plant')
    .select('id, plant_id, nickname');
  const plantById = new Map((plants || []).map((row) => [row.id, row]));

  const labourProfileIds = Array.from(new Set([
    ...latestV1Labour.map((item) => item.profile_id),
    ...latestV2Labour.map((item) => item.profile_id),
    ...inspectionScope,
  ]));
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name')
    .in('id', labourProfileIds.length ? labourProfileIds : inspectionScope);
  const nameById = new Map((profiles || []).map((row) => [row.id, row.full_name]));

  const plantByPublicationDate = new Map<string, Array<PlantItemRow | PlannedPlantSnapshot>>();
  const distinctByDate = new Map<string, PlannedPlantSnapshot[]>();
  for (const item of plantItems) {
    const publication = publicationById.get(item.publication_id);
    const workDate = publication?.work_date || '';
    plantByPublicationDate.set(workDate, [...(plantByPublicationDate.get(workDate) || []), item]);
  }
  const v2PlantByDate = new Map<string, PublishedPlantRow[]>();
  for (const item of v2PlantItems) {
    const publication = publicationById.get(item.publication_id);
    const workDate = publication?.work_date || '';
    v2PlantByDate.set(workDate, [...(v2PlantByDate.get(workDate) || []), item]);
  }
  for (const [workDate, rows] of v2PlantByDate) {
    const collapsed = collapsePublishedPlantForDay(rows);
    distinctByDate.set(workDate, collapsed);
    plantByPublicationDate.set(workDate, [
      ...(plantByPublicationDate.get(workDate) || []),
      ...collapsed,
    ]);
  }

  const plant: DailyPlantReconciliationRow[] = [];
  for (const workDate of workDates) {
    const planned = plantByPublicationDate.get(workDate) || [];
    const rows = applyDistinctJobDaySemantics(
      reconcilePlant(planned, inspections || [], plantById, workDate),
      distinctByDate.get(workDate) || []
    );
    for (const row of rows) {
      if (row.status === 'unplanned_actual' && row.actual_job_code !== canonicalJobCode) continue;
      plant.push(row);
    }
  }

  const snapshotIdentity = latestV2Visits[0] || latestV1Labour[0] || null;
  const sourceHref = jobSheetSourceHref(resolved.record);

  const v1LabourRows = latestV1Labour.map((item) => {
    const publication = publicationById.get(item.publication_id)!;
    return {
      work_date: publication.work_date,
      revision_no: publication.revision_no,
      snapshot_version: 1 as const,
      profile_name: nameById.get(item.profile_id) || 'Employee',
      availability: item.availability as DailyAllocationAvailability,
      job_code: item.job_code,
      customer_name: item.customer_name,
      title: item.title,
      site_address: item.site_address,
      starts_at: null,
      ends_at: null,
      sequence_no: null,
      published_visit_id: null,
      instructions: instructionsFromRow(item),
    };
  });

  const v2LabourRows = latestV2Labour.map((item) => {
    const publication = publicationById.get(item.publication_id)!;
    const visit = item.published_visit_id ? visitsById.get(item.published_visit_id) : null;
    const startsAt = item.starts_at || visit?.starts_at || null;
    const endsAt = item.ends_at || visit?.ends_at || null;
    return {
      work_date: publication.work_date || visit?.work_date || '',
      revision_no: publication.revision_no,
      snapshot_version: 2 as const,
      profile_name: nameById.get(item.profile_id) || 'Employee',
      availability: item.availability,
      job_code: item.job_code || visit?.job_code || canonicalJobCode,
      customer_name: item.customer_name || visit?.customer_name || null,
      title: item.title || visit?.title || null,
      site_address: item.site_address || visit?.site_address || null,
      starts_at: startsAt,
      ends_at: endsAt,
      sequence_no: visit?.sequence_no || null,
      published_visit_id: item.published_visit_id,
      instructions: {
        start_time: startsAt ? formatDailyAllocationVisitTime(startsAt) || null : null,
        meeting_point: item.meeting_point ?? visit?.meeting_point ?? null,
        meet_person: item.meet_person ?? visit?.meet_person ?? null,
        notes: item.notes ?? visit?.notes ?? null,
      },
    };
  }).sort((left, right) => {
    if (left.work_date !== right.work_date) return right.work_date.localeCompare(left.work_date);
    if (left.revision_no !== right.revision_no) return right.revision_no - left.revision_no;
    return (left.sequence_no || 0) - (right.sequence_no || 0);
  });

  return {
    job_code: resolved.record?.job_code || snapshotIdentity?.job_code || jobCode,
    source_type: resolved.record?.source_type || null,
    source_id: resolved.record?.source_id || null,
    customer_name: resolved.record?.customer_name || snapshotIdentity?.customer_name || null,
    title: resolved.record?.title || snapshotIdentity?.title || null,
    site_address: resolved.record?.site_address || snapshotIdentity?.site_address || null,
    source_href: sourceHref,
    labour: [...v1LabourRows, ...v2LabourRows],
    plant,
  };
}

export async function loadPlantReconciliation(workDate: string): Promise<{
  work_date: string;
  plant: DailyPlantReconciliationRow[];
}> {
  const context = await requireDailyAllocationManagerContext();
  if (!isWorkDate(workDate)) {
    throw new DailyAllocationError('A valid work date is required.', 400, 'VALIDATION');
  }
  const { supabase } = await requireDailyAllocationUser();
  const admin = createAdminClient();

  const { data: publications, error: publicationError } = await fromUntyped<PublicationReadRow>(
    supabase,
    'daily_allocation_publications'
  )
    .select('id, work_date, revision_no, published_at, published_by, scope_team_id, snapshot_version, plan_day_id, published_plan_version, confirm_unallocated')
    .eq('work_date', workDate);
  if (publicationError) throw publicationError;

  const latestPublications = selectLatestPublicationsByDateTeam(publications || []);
  const latestV1Ids = latestPublications
    .filter((row) => snapshotVersionFromValue(row.snapshot_version) === 1)
    .map((row) => row.id);
  const latestV2Ids = latestPublications
    .filter((row) => snapshotVersionFromValue(row.snapshot_version) === 2)
    .map((row) => row.id);

  const { data: v1Plant, error: v1PlantError } = latestV1Ids.length
    ? await supabase
        .from('daily_allocation_plant_items')
        .select('*')
        .in('publication_id', latestV1Ids)
    : { data: [] as PlantItemRow[], error: null };
  if (v1PlantError) throw v1PlantError;

  const { data: v2Plant, error: v2PlantError } = latestV2Ids.length
    ? await fromUntyped<PublishedPlantRow>(supabase, 'daily_allocation_published_plant')
      .select('id, publication_id, published_visit_id, plant_kind, plant_id, hired_serial, hired_description, hired_company, hired_serial_normalized, hired_company_normalized, owner_team_id, job_code, site_address, notes')
      .in('publication_id', latestV2Ids)
    : { data: [] as PublishedPlantRow[], error: null };
  if (v2PlantError) throw v2PlantError;

  const collapsedV2 = collapsePublishedPlantForDay(v2Plant || []);
  const planned = [...(v1Plant || []), ...collapsedV2];

  const scopedProfileIds = await loadScopedProfileIds(supabase, context.is_admin);
  const inspectionScope = scopedProfileIds.length
    ? scopedProfileIds
    : ['00000000-0000-0000-0000-000000000000'];
  const { data: inspections } = await admin
    .from('plant_inspections')
    .select('id, user_id, inspection_date, plant_id, is_hired_plant, hired_plant_id_serial, hired_plant_hiring_company, hired_plant_description, job_code, status')
    .eq('inspection_date', workDate)
    .in('user_id', inspectionScope);
  const { data: plants } = await admin
    .from('plant')
    .select('id, plant_id, nickname');
  const plantById = new Map((plants || []).map((row) => [row.id, row]));

  return {
    work_date: workDate,
    plant: applyDistinctJobDaySemantics(
      reconcilePlant(planned, inspections || [], plantById, workDate),
      collapsedV2
    ),
  };
}

export async function listAllocationJobCodes(query = '') {
  await getDailyAllocationContext();
  const records = await loadJobCatalogueRecords();
  return listJobCatalogueOptions(records, query);
}
