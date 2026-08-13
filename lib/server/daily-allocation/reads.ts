import { canEffectiveRoleUseModuleLevel } from '@/lib/utils/rbac';
import { formatDailyAllocationVisitTime } from '@/lib/utils/daily-allocation-timeline';
import { normalizeHiredPlantSerial } from '@/lib/utils/job-catalogue';
import {
  DailyAllocationError,
  fromUntyped,
  isWorkDate,
  requireDailyAllocationUser,
  type AuthedClient,
} from '@/lib/server/daily-allocation/auth';
import {
  absenceFromSnapshotRow,
  emptyLabourInstructions,
  mapIssuedItem,
  snapshotVersionFromValue,
} from '@/lib/server/daily-allocation/legacy-adapter';
import type {
  DailyAllocationAvailability,
  DailyAllocationIssuedItem,
  DailyAllocationIssuedPayload,
  DailyAllocationIssuedVisit,
  DailyAllocationPublicationMeta,
  DailyLabourInstructions,
  DailyPlantKind,
  LoadMyAllocationQuery,
} from '@/types/daily-allocation';

export type PublicationReadRow = {
  id: string;
  work_date: string;
  revision_no: number;
  published_at: string;
  published_by: string;
  scope_team_id: string | null;
  snapshot_version?: number | null;
  plan_day_id?: string | null;
  published_plan_version?: number | null;
  confirm_unallocated?: boolean | null;
};

export type PublishedLabourRow = {
  id: string;
  publication_id: string;
  published_visit_id: string | null;
  profile_id: string;
  availability: DailyAllocationAvailability;
  unallocated: boolean;
  job_source_type: string | null;
  job_source_id: string | null;
  job_code: string | null;
  site_address: string | null;
  customer_name: string | null;
  title: string | null;
  starts_at: string | null;
  ends_at: string | null;
  meeting_point: string | null;
  meet_person: string | null;
  notes: string | null;
  absence_id: string | null;
  absence_reason_id: string | null;
  absence_reason_name: string | null;
  absence_colour: string | null;
  absence_is_paid: boolean | null;
  absence_is_half_day: boolean | null;
  absence_half_day_session: string | null;
  absence_status: string | null;
  absence_allocation_behaviour: string | null;
  created_at: string;
};

export type PublishedVisitRow = {
  id: string;
  publication_id: string;
  sequence_no: number;
  work_date: string;
  job_code: string;
  site_address: string;
  customer_name: string | null;
  title: string | null;
  starts_at: string;
  ends_at: string;
  meeting_point: string | null;
  meet_person: string | null;
  notes: string | null;
};

export type PublishedPlantRow = {
  id: string;
  publication_id: string;
  published_visit_id: string;
  plant_kind: DailyPlantKind;
  plant_id: string | null;
  hired_serial: string | null;
  hired_description: string | null;
  hired_company: string | null;
  hired_serial_normalized: string | null;
  hired_company_normalized: string | null;
  owner_team_id: string | null;
  job_code: string;
  site_address: string;
  notes: string | null;
};

export type PlannedPlantSnapshot = {
  plant_kind: DailyPlantKind;
  plant_id: string | null;
  hired_serial: string | null;
  hired_description: string | null;
  hired_company: string | null;
  hired_serial_normalized: string | null;
  hired_company_normalized: string | null;
  job_code: string | null;
  distinct_job_codes: string[];
};

type AllocationMessageRow = {
  subject: string | null;
  created_at: string;
  daily_allocation_publication_id: string | null;
};

const EMPTY_INSTRUCTIONS = emptyLabourInstructions();

export function workDateFromAllocationMessageSubject(subject: string | null | undefined): string | null {
  const match = subject?.match(/(\d{4}-\d{2}-\d{2})/);
  return match && isWorkDate(match[1]) ? match[1] : null;
}

export function publicationTeamDateKey(publication: {
  id: string;
  work_date: string;
  scope_team_id: string | null;
}): string {
  return `${publication.work_date}:${publication.scope_team_id || publication.id}`;
}

export function selectLatestPublicationsByDateTeam<T extends {
  id: string;
  work_date: string;
  revision_no: number;
  published_at: string;
  scope_team_id: string | null;
  snapshot_version?: number | null;
}>(publications: T[]): T[] {
  const latest = new Map<string, T>();
  for (const publication of publications) {
    const key = publicationTeamDateKey(publication);
    const current = latest.get(key);
    if (!current) {
      latest.set(key, publication);
      continue;
    }
    if (publication.revision_no !== current.revision_no) {
      if (publication.revision_no > current.revision_no) latest.set(key, publication);
      continue;
    }
    if (publication.published_at > current.published_at) latest.set(key, publication);
  }
  return Array.from(latest.values());
}

export function plantAssetKey(item: {
  plant_kind: DailyPlantKind;
  plant_id: string | null;
  hired_serial?: string | null;
  hired_company?: string | null;
  hired_serial_normalized?: string | null;
  hired_company_normalized?: string | null;
}): string {
  if (item.plant_kind === 'registered') return `registered:${item.plant_id || ''}`;
  const serial = item.hired_serial_normalized || normalizeHiredPlantSerial(item.hired_serial);
  const company = item.hired_company_normalized || normalizeHiredPlantSerial(item.hired_company);
  return `hired:${serial}:${company}`;
}

export function collapsePublishedPlantForDay(rows: PublishedPlantRow[]): PlannedPlantSnapshot[] {
  const grouped = new Map<string, PlannedPlantSnapshot>();
  for (const row of rows) {
    const key = plantAssetKey(row);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        plant_kind: row.plant_kind,
        plant_id: row.plant_id,
        hired_serial: row.hired_serial,
        hired_description: row.hired_description,
        hired_company: row.hired_company,
        hired_serial_normalized: row.hired_serial_normalized,
        hired_company_normalized: row.hired_company_normalized,
        job_code: row.job_code,
        distinct_job_codes: [row.job_code],
      });
      continue;
    }
    if (!current.distinct_job_codes.includes(row.job_code)) {
      current.distinct_job_codes.push(row.job_code);
      current.distinct_job_codes.sort((left, right) => left.localeCompare(right));
      current.job_code = current.distinct_job_codes.join(', ');
    }
  }
  return Array.from(grouped.values());
}

export function sortIssuedHistory(
  left: DailyAllocationIssuedItem,
  right: DailyAllocationIssuedItem
): number {
  if (left.work_date !== right.work_date) return right.work_date.localeCompare(left.work_date);
  if (left.snapshot_version === 1 && right.snapshot_version === 1) {
    return right.revision_no - left.revision_no;
  }
  if (left.revision_no > 0 && right.revision_no > 0 && left.revision_no !== right.revision_no) {
    return right.revision_no - left.revision_no;
  }
  return right.published_at.localeCompare(left.published_at);
}

export function selectIssuedItinerary(
  history: DailyAllocationIssuedItem[],
  query: LoadMyAllocationQuery & { itemPublicationId?: string | null }
): DailyAllocationIssuedItem | null {
  if (query.publicationId) {
    return history.find((item) => item.publication_id === query.publicationId) || null;
  }
  if (query.itemPublicationId) {
    return history.find((item) => item.publication_id === query.itemPublicationId) || null;
  }
  let pool = history;
  if (query.workDate) pool = pool.filter((item) => item.work_date === query.workDate);
  if (query.revisionNo != null) {
    return pool.find((item) => item.revision_no === query.revisionNo) || null;
  }
  return pool[0] || null;
}

function visitInstructions(
  labour: PublishedLabourRow,
  visit: PublishedVisitRow
): DailyLabourInstructions {
  return {
    start_time: formatDailyAllocationVisitTime(labour.starts_at || visit.starts_at) || null,
    meeting_point: labour.meeting_point ?? visit.meeting_point,
    meet_person: labour.meet_person ?? visit.meet_person,
    notes: labour.notes ?? visit.notes,
  };
}

export function mapV2IssuedItinerary(
  publication: Pick<PublicationReadRow, 'id' | 'work_date' | 'revision_no' | 'published_at'>,
  labourRows: PublishedLabourRow[],
  visitsById: Map<string, PublishedVisitRow>
): DailyAllocationIssuedItem {
  const dayState = labourRows.find((row) => row.published_visit_id == null) || null;
  const visitRows = labourRows
    .filter((row) => row.published_visit_id)
    .map((row) => {
      const visit = visitsById.get(row.published_visit_id as string);
      if (!visit) return null;
      const mapped: DailyAllocationIssuedVisit = {
        published_visit_id: visit.id,
        sequence_no: visit.sequence_no,
        job_code: row.job_code || visit.job_code,
        site_address: row.site_address || visit.site_address,
        customer_name: row.customer_name || visit.customer_name,
        title: row.title || visit.title,
        starts_at: row.starts_at || visit.starts_at,
        ends_at: row.ends_at || visit.ends_at,
        instructions: visitInstructions(row, visit),
      };
      return { row, visit: mapped };
    })
    .filter((entry): entry is { row: PublishedLabourRow; visit: DailyAllocationIssuedVisit } => Boolean(entry))
    .sort((left, right) => {
      if (left.visit.sequence_no !== right.visit.sequence_no) {
        return left.visit.sequence_no - right.visit.sequence_no;
      }
      return left.visit.starts_at.localeCompare(right.visit.starts_at);
    });

  const visits = visitRows.map((entry) => entry.visit);
  const firstVisit = visits[0] || null;
  const absenceSource = dayState || visitRows[0]?.row || labourRows[0];
  const availability = dayState?.availability
    || visitRows.find((entry) => entry.row.availability === 'half_day_absence')?.row.availability
    || labourRows[0]?.availability
    || 'available';

  return {
    publication_id: publication.id,
    revision_no: publication.revision_no,
    published_at: publication.published_at,
    work_date: publication.work_date,
    snapshot_version: 2,
    unallocated: Boolean(dayState?.unallocated) && visits.length === 0,
    availability,
    job_code: visits.length === 1 ? firstVisit?.job_code || null : null,
    site_address: visits.length === 1 ? firstVisit?.site_address || null : null,
    customer_name: visits.length === 1 ? firstVisit?.customer_name || null : null,
    title: visits.length === 1 ? firstVisit?.title || null : null,
    instructions: visits.length === 1 ? firstVisit?.instructions || EMPTY_INSTRUCTIONS : EMPTY_INSTRUCTIONS,
    absence: absenceSource ? absenceFromSnapshotRow(absenceSource) : null,
    visits,
  };
}

export function publicationMetaFromRow(row: PublicationReadRow): DailyAllocationPublicationMeta {
  return {
    id: row.id,
    work_date: row.work_date,
    revision_no: row.revision_no,
    published_at: row.published_at,
    published_by: row.published_by,
    published_by_name: null,
    scope_team_id: row.scope_team_id,
    snapshot_version: snapshotVersionFromValue(row.snapshot_version),
    plan_day_id: row.plan_day_id || null,
    published_plan_version: row.published_plan_version ?? null,
    confirm_unallocated: Boolean(row.confirm_unallocated),
  };
}

function synthesizeV2Publication(
  publicationId: string,
  labourRows: PublishedLabourRow[],
  visits: PublishedVisitRow[],
  message: AllocationMessageRow | null
): PublicationReadRow {
  // Defensive fallback for partially deployed environments where RLS hides
  // the header. Query errors are thrown by loadPublicationRows and must not
  // be synthesized away.
  const visitDate = visits.find((visit) => visit.work_date)?.work_date
    || workDateFromAllocationMessageSubject(message?.subject)
    || '';
  const publishedAt = message?.created_at || labourRows[0]?.created_at || '';
  return {
    id: publicationId,
    work_date: visitDate,
    revision_no: 0,
    published_at: publishedAt,
    published_by: '',
    scope_team_id: null,
    snapshot_version: 2,
  };
}

async function loadPublicationRows(
  supabase: AuthedClient,
  publicationIds: string[]
): Promise<PublicationReadRow[]> {
  if (!publicationIds.length) return [];
  const { data, error } = await fromUntyped<PublicationReadRow>(
    supabase,
    'daily_allocation_publications'
  )
    .select('id, work_date, revision_no, published_at, published_by, scope_team_id, snapshot_version, plan_day_id, published_plan_version, confirm_unallocated')
    .in('id', publicationIds);
  if (error) throw error;
  return data || [];
}

export function resolveIssuedPublicationHeader(
  publicationId: string,
  publicationById: Map<string, PublicationReadRow>,
  labourRows: PublishedLabourRow[],
  visits: PublishedVisitRow[],
  message: AllocationMessageRow | null
): PublicationReadRow {
  const header = publicationById.get(publicationId);
  if (header) return header;
  return synthesizeV2Publication(publicationId, labourRows, visits, message);
}

export async function loadMyAllocation(
  query: LoadMyAllocationQuery = {}
): Promise<DailyAllocationIssuedPayload> {
  const { supabase, user } = await requireDailyAllocationUser();
  const canView = await canEffectiveRoleUseModuleLevel('daily-allocation', 2);
  if (!canView) throw new DailyAllocationError('Daily allocation access required', 403);
  if (query.workDate && !isWorkDate(query.workDate)) {
    throw new DailyAllocationError('A valid work date is required.', 400, 'VALIDATION');
  }

  const { data: v1Items, error: v1Error } = await supabase
    .from('daily_allocation_labour_items')
    .select('*')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false });
  if (v1Error) throw v1Error;

  const { data: v2Labour, error: v2Error } = await fromUntyped<PublishedLabourRow>(
    supabase,
    'daily_allocation_published_labour'
  )
    .select('*')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false });
  if (v2Error) throw v2Error;

  const v1Rows = v1Items || [];
  const v2Rows = v2Labour || [];
  if (!v1Rows.length && !v2Rows.length) return { current: null, history: [] };

  const publicationIds = Array.from(new Set([
    ...v1Rows.map((item) => item.publication_id),
    ...v2Rows.map((item) => item.publication_id),
  ]));
  const publications = await loadPublicationRows(supabase, publicationIds);
  const publicationById = new Map(publications.map((row) => [row.id, row]));

  const visitIds = Array.from(new Set(
    v2Rows
      .map((row) => row.published_visit_id)
      .filter((id): id is string => Boolean(id))
  ));
  const { data: visitRows, error: visitError } = visitIds.length
    ? await fromUntyped<PublishedVisitRow>(supabase, 'daily_allocation_published_visits')
      .select('id, publication_id, sequence_no, work_date, job_code, site_address, customer_name, title, starts_at, ends_at, meeting_point, meet_person, notes')
      .in('id', visitIds)
    : { data: [] as PublishedVisitRow[], error: null };
  if (visitError) throw visitError;
  const visitsById = new Map((visitRows || []).map((row) => [row.id, row]));

  const missingV2PublicationIds = Array.from(new Set(
    v2Rows
      .map((row) => row.publication_id)
      .filter((id) => !publicationById.has(id))
  ));
  const { data: messages, error: messageError } = missingV2PublicationIds.length
    ? await fromUntyped<AllocationMessageRow>(supabase, 'messages')
      .select('subject, created_at, daily_allocation_publication_id')
      .in('daily_allocation_publication_id', missingV2PublicationIds)
      .eq('module_key', 'daily_allocation')
    : { data: [] as AllocationMessageRow[], error: null };
  if (messageError) throw messageError;
  const messageByPublication = new Map<string, AllocationMessageRow>();
  for (const message of messages || []) {
    if (!message.daily_allocation_publication_id) continue;
    const current = messageByPublication.get(message.daily_allocation_publication_id);
    if (!current || message.created_at < current.created_at) {
      messageByPublication.set(message.daily_allocation_publication_id, message);
    }
  }

  const v1History = v1Rows
    .map((item) => {
      const publication = publicationById.get(item.publication_id);
      if (!publication) return null;
      if (query.workDate && publication.work_date !== query.workDate) return null;
      return mapIssuedItem(item, publication);
    })
    .filter((item): item is DailyAllocationIssuedItem => Boolean(item));

  const v2ByPublication = new Map<string, PublishedLabourRow[]>();
  for (const row of v2Rows) {
    v2ByPublication.set(row.publication_id, [...(v2ByPublication.get(row.publication_id) || []), row]);
  }

  const v2History: DailyAllocationIssuedItem[] = [];
  for (const [publicationId, labourRows] of v2ByPublication) {
    const relatedVisits = labourRows
      .map((row) => (row.published_visit_id ? visitsById.get(row.published_visit_id) : null))
      .filter((visit): visit is PublishedVisitRow => Boolean(visit));
    const publication = resolveIssuedPublicationHeader(
      publicationId,
      publicationById,
      labourRows,
      relatedVisits,
      messageByPublication.get(publicationId) || null
    );
    if (query.workDate && publication.work_date !== query.workDate) continue;
    v2History.push(mapV2IssuedItinerary(publication, labourRows, visitsById));
  }

  const history = [...v1History, ...v2History].sort(sortIssuedHistory);
  const itemPublicationId = query.itemId
    ? v1Rows.find((item) => item.id === query.itemId)?.publication_id || null
    : null;
  const current = selectIssuedItinerary(history, { ...query, itemPublicationId });
  return { current, history };
}

export async function listMyPublicationHistory(workDate?: string): Promise<{
  publications: DailyAllocationPublicationMeta[];
}> {
  const { history } = await loadMyAllocation({ workDate });
  const seen = new Set<string>();
  const publications: DailyAllocationPublicationMeta[] = [];
  for (const item of history) {
    if (seen.has(item.publication_id)) continue;
    seen.add(item.publication_id);
    publications.push({
      id: item.publication_id,
      work_date: item.work_date,
      revision_no: item.revision_no,
      published_at: item.published_at,
      published_by: '',
      published_by_name: null,
      scope_team_id: null,
      snapshot_version: item.snapshot_version,
      plan_day_id: null,
      published_plan_version: null,
      confirm_unallocated: item.unallocated,
    });
  }
  return { publications };
}
