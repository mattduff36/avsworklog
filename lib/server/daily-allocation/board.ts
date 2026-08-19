import { createAdminClient } from '@/lib/supabase/admin';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';
import { isHiddenSystemTestAccountProfile } from '@/lib/utils/system-test-accounts';
import { filterSystemTeams, isSystemAccountProfile } from '@/lib/utils/system-accounts';
import { loadJobCatalogueRecords } from '@/lib/server/job-catalogue';
import { getJobCatalogueBlockReason } from '@/lib/utils/job-catalogue';
import {
  DailyAllocationError,
  fromUntyped,
  isWorkDate,
  loadScopedProfileIds,
  mapDailyAllocationRpcError,
  parseDailyAllocationBoardRange,
  requireDailyAllocationManagerContext,
  requireDailyAllocationUser,
  scopeIdsOrPlaceholder,
  type AuthedClient,
} from '@/lib/server/daily-allocation/auth';
import {
  absencesCoveringDate,
  buildBoardConflicts,
  classifyAbsence,
  classifyDayAbsences,
  isShiftSessionWorking,
  shiftPatternFromRow,
  type AbsenceRowInput,
  type ShiftRowInput,
} from '@/lib/server/daily-allocation/availability';
import {
  isConvertedTeamDate,
  mapLabourDraft,
  mapPlantDraft,
} from '@/lib/server/daily-allocation/legacy-adapter';
import type { Database } from '@/types/database';
import type { JobCatalogueRecord, JobCatalogueSourceType } from '@/types/job-catalogue';
import type { WorkShiftPattern } from '@/types/work-shifts';
import type {
  AbsenceAllocationBehaviour,
  DailyAllocationBoardPayload,
  DailyAllocationConflictKind,
  DailyAllocationConflictOverride,
  DailyAllocationJobProjection,
  DailyAllocationLabourAssignment,
  DailyLabourBoardRow,
  DailyAllocationPlanDay,
  DailyAllocationPlantAssignment,
  DailyPlantBoardRow,
  DailyAllocationPublicationMeta,
  DailyAllocationRangeBoardPayload,
  DailyAllocationSnapshotVersion,
  DailyAllocationVisit,
  DailyLabourDraft,
  DailyPlantDraft,
} from '@/types/daily-allocation';

type LabourItemRow = Database['public']['Tables']['daily_allocation_labour_items']['Row'];

type QueryError = { message?: string; code?: string } | null;

type PlanDayRow = {
  id: string;
  work_date: string;
  team_id: string;
  plan_version: number;
  converted_at: string;
  converted_by: string | null;
  updated_at: string;
};

type VisitRow = {
  id: string;
  plan_day_id: string;
  work_date: string;
  owner_team_id: string;
  job_source_type: JobCatalogueSourceType;
  job_source_id: string;
  job_code: string;
  site_address: string;
  starts_at: string;
  ends_at: string;
  meeting_point: string | null;
  meet_person: string | null;
  notes: string | null;
  row_version: number;
  updated_at: string;
};

type LabourAssignmentRow = {
  id: string;
  visit_id: string;
  plan_day_id: string;
  work_date: string;
  profile_id: string;
  starts_at: string;
  ends_at: string;
  meeting_point: string | null;
  meet_person: string | null;
  notes: string | null;
  row_version: number;
  updated_at: string;
};

type PlantAssignmentRow = {
  id: string;
  visit_id: string;
  plan_day_id: string;
  work_date: string;
  plant_kind: 'registered' | 'hired';
  plant_id: string | null;
  hired_serial: string | null;
  hired_description: string | null;
  hired_company: string | null;
  owner_team_id: string | null;
  starts_at: string;
  ends_at: string;
  notes: string | null;
  row_version: number;
  updated_at: string;
};

type OverrideRow = {
  id: string;
  plan_day_id: string;
  visit_id: string | null;
  profile_id: string | null;
  plant_id: string | null;
  conflict_kind: DailyAllocationConflictKind;
  evidence: string;
  confirmed_by: string;
  confirmed_at: string;
};

type PublicationRow = {
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

type PlantConflictRow = {
  plant_id: string | null;
  hired_serial: string | null;
  hired_company: string | null;
  owner_team_id: string | null;
};

function throwIfError(error: QueryError): void {
  if (!error) return;
  throw mapDailyAllocationRpcError(error) || error;
}

function jobSourceHref(record: Pick<JobCatalogueRecord, 'source_type' | 'source_id'>): string {
  if (record.source_type === 'live_quote') return `/quotes?quote_id=${record.source_id}`;
  if (record.source_type === 'project_number') return '/quotes?tab=projects';
  return '/quotes?tab=legacy';
}

function mapPlanDay(row: PlanDayRow): DailyAllocationPlanDay {
  return {
    id: row.id,
    work_date: row.work_date,
    team_id: row.team_id,
    plan_version: row.plan_version,
    converted_at: row.converted_at,
    converted_by: row.converted_by,
    updated_at: row.updated_at,
  };
}

function mapVisit(row: VisitRow): DailyAllocationVisit {
  return {
    id: row.id,
    plan_day_id: row.plan_day_id,
    work_date: row.work_date,
    owner_team_id: row.owner_team_id,
    job_source_type: row.job_source_type,
    job_source_id: row.job_source_id,
    job_code: row.job_code,
    site_address: row.site_address,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    meeting_point: row.meeting_point,
    meet_person: row.meet_person,
    notes: row.notes,
    row_version: row.row_version,
    updated_at: row.updated_at,
  };
}

function mapLabourAssignment(row: LabourAssignmentRow): DailyAllocationLabourAssignment {
  return {
    id: row.id,
    visit_id: row.visit_id,
    plan_day_id: row.plan_day_id,
    work_date: row.work_date,
    profile_id: row.profile_id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    meeting_point: row.meeting_point,
    meet_person: row.meet_person,
    notes: row.notes,
    row_version: row.row_version,
    updated_at: row.updated_at,
  };
}

function mapPlantAssignment(row: PlantAssignmentRow): DailyAllocationPlantAssignment {
  return {
    id: row.id,
    visit_id: row.visit_id,
    plan_day_id: row.plan_day_id,
    work_date: row.work_date,
    plant_kind: row.plant_kind,
    plant_id: row.plant_id,
    hired_serial: row.hired_serial,
    hired_description: row.hired_description,
    hired_company: row.hired_company,
    owner_team_id: row.owner_team_id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    notes: row.notes,
    row_version: row.row_version,
    updated_at: row.updated_at,
  };
}

function mapOverride(row: OverrideRow): DailyAllocationConflictOverride {
  return {
    id: row.id,
    plan_day_id: row.plan_day_id,
    visit_id: row.visit_id,
    profile_id: row.profile_id,
    plant_id: row.plant_id,
    conflict_kind: row.conflict_kind,
    evidence: row.evidence,
    confirmed_by: row.confirmed_by,
    confirmed_at: row.confirmed_at,
  };
}

export function projectDailyAllocationJobs(
  records: JobCatalogueRecord[],
  visits: DailyAllocationVisit[] = [],
  labourDrafts: DailyLabourDraft[] = [],
  plantDrafts: DailyPlantDraft[] = []
): DailyAllocationJobProjection[] {
  const recordByIdentity = new Map(records.map((record) => [`${record.source_type}:${record.source_id}`, record]));
  const seen = new Map<string, DailyAllocationJobProjection>();

  const add = (
    sourceType: JobCatalogueSourceType | null,
    sourceId: string | null,
    jobCode: string | null,
    siteAddress: string | null
  ) => {
    if (!sourceType || !sourceId || !jobCode) return;
    const key = `${sourceType}:${sourceId}`;
    if (seen.has(key)) return;
    const record = recordByIdentity.get(key);
    if (!record || getJobCatalogueBlockReason(record)) return;
    seen.set(key, {
      source_type: record.source_type,
      source_id: record.source_id,
      job_code: record.job_code || jobCode,
      customer_name: record.customer_name || null,
      title: record.title || null,
      site_address: record.site_address || siteAddress,
      source_href: jobSourceHref(record),
    });
  };

  for (const record of records) {
    add(record.source_type, record.source_id, record.job_code, record.site_address);
  }
  for (const visit of visits) {
    add(visit.job_source_type, visit.job_source_id, visit.job_code, visit.site_address);
  }
  for (const draft of labourDrafts) {
    add(draft.job_source_type, draft.job_source_id, draft.job_code, draft.site_address);
  }
  for (const draft of plantDrafts) {
    add(draft.job_source_type, draft.job_source_id, draft.job_code, draft.site_address);
  }
  return Array.from(seen.values()).sort((left, right) => left.job_code.localeCompare(right.job_code));
}

export async function loadDailyAllocationBoard(workDate: string): Promise<DailyAllocationBoardPayload> {
  if (!isWorkDate(workDate)) {
    throw new DailyAllocationError('A valid work date is required.', 400);
  }

  const context = await requireDailyAllocationManagerContext();
  const { supabase } = await requireDailyAllocationUser();
  const admin = createAdminClient();
  const scopedIds = await loadScopedProfileIds(supabase, context.is_admin);

  const [
    { data: profiles, error: profileError },
    { data: labourDrafts, error: labourError },
    { data: plantDrafts, error: plantError },
    { data: absences, error: absenceError },
    { data: publications, error: publicationError },
    { data: plants, error: plantListError },
    { data: teams, error: teamError },
    { data: plantConflicts, error: plantConflictError },
  ] = await Promise.all([
    admin
      .from('profiles')
      .select('id, full_name, employee_id, team_id, is_system_account')
      .in('id', scopedIds.length ? scopedIds : ['00000000-0000-0000-0000-000000000000'])
      .order('full_name'),
    supabase
      .from('daily_labour_allocation_drafts')
      .select('*')
      .eq('work_date', workDate),
    supabase
      .from('daily_plant_allocation_drafts')
      .select('*')
      .eq('work_date', workDate),
    admin
      .from('absences')
      .select(`
        id,
        profile_id,
        reason_id,
        status,
        is_half_day,
        half_day_session,
        date,
        end_date,
        absence_reasons(id, name, color, is_paid, allocation_behaviour)
      `)
      .in('profile_id', scopedIds.length ? scopedIds : ['00000000-0000-0000-0000-000000000000'])
      .lte('date', workDate)
      .or(`end_date.is.null,end_date.gte.${workDate}`),
    fromUntyped<PublicationRow>(supabase as AuthedClient, 'daily_allocation_publications')
      .select('id, revision_no, published_at, published_by, scope_team_id, snapshot_version')
      .eq('work_date', workDate)
      .order('revision_no', { ascending: false }),
    admin
      .from('plant')
      .select('id, plant_id, nickname, status')
      .eq('status', 'active'),
    admin
      .from('org_teams')
      .select('id, name, is_system'),
    supabase
      .rpc('list_daily_allocation_plant_conflicts', { p_work_date: workDate }),
  ]);

  if (profileError) throw profileError;
  if (labourError) throw labourError;
  if (plantError) throw plantError;
  if (absenceError) throw absenceError;
  if (publicationError) throw publicationError;
  if (plantListError) throw plantListError;
  if (teamError) throw teamError;
  if (plantConflictError) throw plantConflictError;

  const teamNameById = new Map(
    filterSystemTeams(teams || []).map((team) => [team.id, team.name])
  );
  const labourByProfile = new Map((labourDrafts || []).map((row) => [row.profile_id, mapLabourDraft(row)]));
  const publicationIds = (publications || []).map((row) => row.id);
  const { data: issuedItems, error: issuedError } = publicationIds.length
    ? await supabase
        .from('daily_allocation_labour_items')
        .select('*')
        .in('publication_id', publicationIds)
        .in('profile_id', scopedIds.length ? scopedIds : ['00000000-0000-0000-0000-000000000000'])
    : { data: [] as LabourItemRow[], error: null };
  if (issuedError) throw issuedError;

  const revisionByPublication = new Map((publications || []).map((row) => [row.id, row]));
  const issuedByProfile = new Map<string, LabourItemRow>();
  for (const item of issuedItems || []) {
    const current = issuedByProfile.get(item.profile_id);
    const itemRevision = revisionByPublication.get(item.publication_id)?.revision_no || 0;
    const currentRevision = current ? revisionByPublication.get(current.publication_id)?.revision_no || 0 : -1;
    if (!current || itemRevision > currentRevision) {
      issuedByProfile.set(item.profile_id, item);
    }
  }

  const scopedPublicationIds = new Set((issuedItems || []).map((item) => item.publication_id));
  const teamPublications = (publications || []).filter((row) => (
    context.is_admin
    || !context.team_id
    || row.scope_team_id === context.team_id
    || row.published_by === context.user_id
    || scopedPublicationIds.has(row.id)
  ));
  const latestPublication = teamPublications[0] || publications?.[0] || null;

  const publisherIds = Array.from(new Set(teamPublications.map((publication) => publication.published_by)));
  const { data: publishers } = publisherIds.length
    ? await admin
      .from('profiles')
      .select('id, full_name')
      .in('id', publisherIds)
    : { data: [] as Array<{ id: string; full_name: string }> };
  const publisherNameById = new Map((publishers || []).map((publisher) => [publisher.id, publisher.full_name]));

  const labour: DailyLabourBoardRow[] = (profiles || [])
    .filter((profile) => !isHiddenSystemTestAccountProfile(profile) && !isSystemAccountProfile(profile))
    .map((profile) => {
    const profileAbsences = (absences || []).filter((absence) => absence.profile_id === profile.id);
    const reasonOf = (absence: (typeof profileAbsences)[number]) => {
      const reason = Array.isArray(absence.absence_reasons) ? absence.absence_reasons[0] : absence.absence_reasons;
      return reason;
    };
    const blocking = profileAbsences
      .map((absence) => {
        const reason = reasonOf(absence);
        const availability = classifyAbsence({
          status: absence.status,
          is_half_day: absence.is_half_day,
          allocation_behaviour: (reason?.allocation_behaviour || 'block') as AbsenceAllocationBehaviour,
        });
        return { absence, reason, availability };
      })
      .filter((entry) => entry.availability === 'full_day_absence' || entry.availability === 'half_day_absence')
      .sort((left, right) => Number(left.availability === 'half_day_absence') - Number(right.availability === 'half_day_absence'))[0] || null;
    const pending = profileAbsences.find((absence) => absence.status === 'pending') || null;
    const pendingReason = pending ? reasonOf(pending) : null;
    const draft = labourByProfile.get(profile.id) || null;
    const issued = issuedByProfile.get(profile.id) || null;
    const availability = blocking?.availability === 'full_day_absence' || blocking?.availability === 'half_day_absence'
      ? blocking.availability
      : 'available';
    const warnings: string[] = [];
    if (pending) warnings.push('A pending absence exists for this date.');
    if (availability !== 'full_day_absence' && !draft?.job_code) {
      warnings.push('A catalogue job is required before publish.');
    }
    const publishReady = availability === 'full_day_absence' || Boolean(draft?.job_code && draft.site_address);

    return {
      profile_id: profile.id,
      full_name: profile.full_name,
      employee_id: profile.employee_id,
      team_id: profile.team_id,
      team_name: profile.team_id ? teamNameById.get(profile.team_id) || null : null,
      availability,
      blocking_absence: blocking
        ? {
            absence_id: blocking.absence.id,
            reason_id: blocking.reason?.id || blocking.absence.reason_id,
            reason_name: blocking.reason?.name || 'Absence',
            colour: blocking.reason?.color || null,
            is_paid: Boolean(blocking.reason?.is_paid),
            is_half_day: Boolean(blocking.absence.is_half_day),
            half_day_session: (blocking.absence.half_day_session as 'AM' | 'PM' | null) || null,
            status: blocking.absence.status as 'pending' | 'approved' | 'processed',
            allocation_behaviour: (blocking.reason?.allocation_behaviour || 'block') as AbsenceAllocationBehaviour,
          }
        : null,
      pending_absence: pending
        ? {
            absence_id: pending.id,
            reason_id: pendingReason?.id || pending.reason_id,
            reason_name: pendingReason?.name || 'Absence',
            colour: pendingReason?.color || null,
            is_paid: Boolean(pendingReason?.is_paid),
            is_half_day: Boolean(pending.is_half_day),
            half_day_session: (pending.half_day_session as 'AM' | 'PM' | null) || null,
            status: 'pending',
            allocation_behaviour: (pendingReason?.allocation_behaviour || 'block') as AbsenceAllocationBehaviour,
          }
        : null,
      draft,
      latest_issued: issued
        ? {
            publication_id: issued.publication_id,
            revision_no: revisionByPublication.get(issued.publication_id)?.revision_no || 0,
            published_at: revisionByPublication.get(issued.publication_id)?.published_at || issued.created_at,
            job_code: issued.job_code,
            site_address: issued.site_address,
            instructions: {
              start_time: issued.start_time,
              meeting_point: issued.meeting_point,
              meet_person: issued.meet_person,
              notes: issued.notes,
            },
            availability: issued.availability,
          }
        : null,
      can_manage: true,
      publish_ready: publishReady,
      warnings,
    };
  });

  const plantById = new Map((plants || []).map((row) => [row.id, row]));
  const plant: DailyPlantBoardRow[] = (plantDrafts || []).map((row) => {
    const draft = mapPlantDraft(row);
    const registered = draft.plant_id ? plantById.get(draft.plant_id) : null;
    const warnings: string[] = [];
    if (!draft.job_code || !draft.site_address) warnings.push('A catalogue job is required before publish.');
    return {
      draft,
      plant_label: draft.plant_kind === 'hired'
        ? `${draft.hired_description || 'Hired plant'} (${draft.hired_serial || 'no serial'})`
        : formatFleetAssetLabel({
            identifier: registered?.plant_id || draft.plant_id || 'Plant',
            nickname: registered?.nickname,
          }),
      owned_by_other_team: Boolean(
        draft.owner_team_id
        && context.team_id
        && draft.owner_team_id !== context.team_id
      ),
      can_reassign: context.is_admin,
      publish_ready: Boolean(draft.job_code && draft.site_address),
      warnings,
    };
  });

  for (const conflict of plantConflicts || []) {
    const registered = conflict.plant_id ? plantById.get(conflict.plant_id) : null;
    plant.push({
      draft: {
        id: `conflict:${conflict.plant_id || conflict.hired_serial || 'unknown'}`,
        work_date: workDate,
        plant_kind: conflict.plant_id ? 'registered' : 'hired',
        plant_id: conflict.plant_id,
        hired_serial: conflict.hired_serial,
        hired_description: null,
        hired_company: conflict.hired_company,
        owner_team_id: conflict.owner_team_id,
        job_source_type: null,
        job_source_id: null,
        job_code: null,
        site_address: null,
        notes: null,
        row_version: 0,
        updated_at: '',
      },
      plant_label: conflict.plant_id
        ? formatFleetAssetLabel({
            identifier: registered?.plant_id || conflict.plant_id,
            nickname: registered?.nickname,
          })
        : `Hired plant (${conflict.hired_serial || 'no serial'})`,
      owned_by_other_team: true,
      can_reassign: context.is_admin,
      publish_ready: false,
      warnings: ['Another team already owns this plant on this date.'],
    });
  }

  return {
    work_date: workDate,
    context,
    labour,
    plant,
    latest_publication: latestPublication
      ? {
          id: latestPublication.id,
          revision_no: latestPublication.revision_no,
          published_at: latestPublication.published_at,
          published_by_name: publisherNameById.get(latestPublication.published_by) || null,
        }
      : null,
    publication_history: teamPublications.map((publication) => ({
      id: publication.id,
      revision_no: publication.revision_no,
      published_at: publication.published_at,
      published_by_name: publisherNameById.get(publication.published_by) || null,
      scope_team_id: publication.scope_team_id,
      snapshot_version: (publication.snapshot_version === 2 ? 2 : 1) as DailyAllocationSnapshotVersion,
    })),
    available_plant: (plants || []).map((row) => ({
      id: row.id,
      plant_id: row.plant_id,
      nickname: row.nickname,
    })),
    available_teams: (teams || [])
      .filter((team) => context.is_admin || team.id === context.team_id)
      .map((team) => ({ id: team.id, name: team.name })),
  };
}

export async function loadDailyAllocationBoardRange(
  start: string,
  end: string
): Promise<DailyAllocationRangeBoardPayload> {
  const context = await requireDailyAllocationManagerContext();
  const range = parseDailyAllocationBoardRange(start, end);
  const { supabase } = await requireDailyAllocationUser();
  const admin = createAdminClient();
  const scopedIds = await loadScopedProfileIds(supabase, context.is_admin);
  const scopeIds = scopeIdsOrPlaceholder(scopedIds);

  const [
    profilesResult,
    absencesResult,
    shiftsResult,
    plantsResult,
    teamsResult,
    planDaysResult,
    visitsResult,
    labourAssignResult,
    plantAssignResult,
    overridesResult,
    labourDraftsResult,
    plantDraftsResult,
    publicationsResult,
    catalogue,
    conflictResults,
  ] = await Promise.all([
    admin
      .from('profiles')
      .select('id, full_name, employee_id, team_id, is_system_account')
      .in('id', scopeIds)
      .order('full_name'),
    admin
      .from('absences')
      .select(`
        id,
        profile_id,
        reason_id,
        status,
        is_half_day,
        half_day_session,
        date,
        end_date,
        absence_reasons(id, name, color, is_paid, allocation_behaviour)
      `)
      .in('profile_id', scopeIds)
      .lte('date', range.end)
      .or(`end_date.is.null,end_date.gte.${range.start}`),
    admin
      .from('employee_work_shifts')
      .select('profile_id, monday_am, monday_pm, tuesday_am, tuesday_pm, wednesday_am, wednesday_pm, thursday_am, thursday_pm, friday_am, friday_pm, saturday_am, saturday_pm, sunday_am, sunday_pm')
      .in('profile_id', scopeIds),
    admin
      .from('plant')
      .select('id, plant_id, nickname, status')
      .eq('status', 'active'),
    admin
      .from('org_teams')
      .select('id, name, is_system'),
    fromUntyped<PlanDayRow>(supabase, 'daily_allocation_plan_days')
      .select('id, work_date, team_id, plan_version, converted_at, converted_by, updated_at')
      .gte('work_date', range.start)
      .lte('work_date', range.end),
    fromUntyped<VisitRow>(supabase, 'daily_allocation_visits')
      .select('id, plan_day_id, work_date, owner_team_id, job_source_type, job_source_id, job_code, site_address, starts_at, ends_at, meeting_point, meet_person, notes, row_version, updated_at')
      .gte('work_date', range.start)
      .lte('work_date', range.end)
      .order('starts_at', { ascending: true }),
    fromUntyped<LabourAssignmentRow>(supabase, 'daily_allocation_visit_labour')
      .select('id, visit_id, plan_day_id, work_date, profile_id, starts_at, ends_at, meeting_point, meet_person, notes, row_version, updated_at')
      .gte('work_date', range.start)
      .lte('work_date', range.end),
    fromUntyped<PlantAssignmentRow>(supabase, 'daily_allocation_visit_plant')
      .select('id, visit_id, plan_day_id, work_date, plant_kind, plant_id, hired_serial, hired_description, hired_company, owner_team_id, starts_at, ends_at, notes, row_version, updated_at')
      .gte('work_date', range.start)
      .lte('work_date', range.end),
    fromUntyped<OverrideRow>(supabase, 'daily_allocation_conflict_overrides')
      .select('id, plan_day_id, visit_id, profile_id, plant_id, conflict_kind, evidence, confirmed_by, confirmed_at'),
    supabase
      .from('daily_labour_allocation_drafts')
      .select('*')
      .gte('work_date', range.start)
      .lte('work_date', range.end),
    supabase
      .from('daily_plant_allocation_drafts')
      .select('*')
      .gte('work_date', range.start)
      .lte('work_date', range.end),
    fromUntyped<PublicationRow>(supabase as AuthedClient, 'daily_allocation_publications')
      .select('id, work_date, revision_no, published_at, published_by, scope_team_id, snapshot_version, plan_day_id, published_plan_version, confirm_unallocated')
      .gte('work_date', range.start)
      .lte('work_date', range.end)
      .order('revision_no', { ascending: false }),
    loadJobCatalogueRecords(admin),
    Promise.all(range.dates.map((workDate) => (
      supabase.rpc('list_daily_allocation_plant_conflicts', { p_work_date: workDate })
    ))),
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (absencesResult.error) throw absencesResult.error;
  if (shiftsResult.error) throw shiftsResult.error;
  if (plantsResult.error) throw plantsResult.error;
  if (teamsResult.error) throw teamsResult.error;
  throwIfError(planDaysResult.error);
  throwIfError(visitsResult.error);
  throwIfError(labourAssignResult.error);
  throwIfError(plantAssignResult.error);
  throwIfError(overridesResult.error);
  if (labourDraftsResult.error) throw labourDraftsResult.error;
  if (plantDraftsResult.error) throw plantDraftsResult.error;
  throwIfError(publicationsResult.error);
  for (const conflictResult of conflictResults) {
    if (conflictResult.error) throw conflictResult.error;
  }

  const planDays = (planDaysResult.data || []).map(mapPlanDay);
  const visits = (visitsResult.data || []).map(mapVisit);
  const labourAssignments = (labourAssignResult.data || []).map(mapLabourAssignment);
  const plantAssignments = (plantAssignResult.data || []).map(mapPlantAssignment);
  const planDayIds = new Set(planDays.map((planDay) => planDay.id));
  const overrides = (overridesResult.data || [])
    .filter((row) => planDayIds.has(row.plan_day_id))
    .map(mapOverride);

  const profileById = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
  const teamNameById = new Map(
    filterSystemTeams(teamsResult.data || []).map((team) => [team.id, team.name])
  );
  const shiftsByProfile = new Map<string, WorkShiftPattern>();
  for (const row of (shiftsResult.data || []) as ShiftRowInput[]) {
    shiftsByProfile.set(row.profile_id, shiftPatternFromRow(row));
  }

  const absences = (absencesResult.data || []) as AbsenceRowInput[];
  const labourDrafts = (labourDraftsResult.data || [])
    .map(mapLabourDraft)
    .filter((draft) => {
      if (!scopedIds.includes(draft.profile_id)) return false;
      const teamId = profileById.get(draft.profile_id)?.team_id || null;
      return !isConvertedTeamDate(planDays, draft.work_date, teamId);
    });
  const plantDrafts = (plantDraftsResult.data || [])
    .map(mapPlantDraft)
    .filter((draft) => !isConvertedTeamDate(planDays, draft.work_date, draft.owner_team_id));

  conflictResults.forEach((result, index) => {
    const workDate = range.dates[index];
    if (!workDate) return;
    const rows = (result.data || []) as PlantConflictRow[];
    for (const conflict of rows) {
      if (isConvertedTeamDate(planDays, workDate, conflict.owner_team_id)) continue;
      plantDrafts.push({
        id: `conflict:${workDate}:${conflict.plant_id || conflict.hired_serial || 'unknown'}`,
        work_date: workDate,
        plant_kind: conflict.plant_id ? 'registered' : 'hired',
        plant_id: conflict.plant_id,
        hired_serial: conflict.hired_serial,
        hired_description: null,
        hired_company: conflict.hired_company,
        owner_team_id: conflict.owner_team_id,
        job_source_type: null,
        job_source_id: null,
        job_code: null,
        site_address: null,
        notes: null,
        row_version: 0,
        updated_at: '',
      });
    }
  });

  const publications = publicationsResult.data || [];
  const publisherIds = Array.from(new Set(publications.map((publication) => publication.published_by)));
  const { data: publishers } = publisherIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', publisherIds)
    : { data: [] as Array<{ id: string; full_name: string }> };
  const publisherNameById = new Map((publishers || []).map((publisher) => [publisher.id, publisher.full_name]));

  const publicationMeta: DailyAllocationPublicationMeta[] = publications
    .filter((row) => (
      context.is_admin
      || !context.team_id
      || row.scope_team_id === context.team_id
      || row.published_by === context.user_id
    ))
    .map((row) => ({
      id: row.id,
      work_date: row.work_date,
      revision_no: row.revision_no,
      published_at: row.published_at,
      published_by: row.published_by,
      published_by_name: publisherNameById.get(row.published_by) || null,
      scope_team_id: row.scope_team_id,
      snapshot_version: (row.snapshot_version === 2 ? 2 : 1) as DailyAllocationSnapshotVersion,
      plan_day_id: row.plan_day_id || null,
      published_plan_version: row.published_plan_version ?? null,
      confirm_unallocated: Boolean(row.confirm_unallocated),
    }));

  const employees = (profilesResult.data || [])
    .filter((profile) => !isHiddenSystemTestAccountProfile(profile) && !isSystemAccountProfile(profile))
    .map((profile) => ({
      profile_id: profile.id,
      full_name: profile.full_name,
      employee_id: profile.employee_id,
      team_id: profile.team_id,
      team_name: profile.team_id ? teamNameById.get(profile.team_id) || null : null,
      days: range.dates.map((workDate) => {
        const classified = classifyDayAbsences(absencesCoveringDate(absences, profile.id, workDate));
        const pattern = shiftsByProfile.get(profile.id) || null;
        return {
          work_date: workDate,
          availability: classified.availability,
          blocking_absence: classified.blocking,
          pending_absence: classified.pending,
          am_working: isShiftSessionWorking(pattern, workDate, 'AM'),
          pm_working: isShiftSessionWorking(pattern, workDate, 'PM'),
        };
      }),
    }));

  return {
    start_date: range.start,
    end_date: range.end,
    dates: range.dates,
    context,
    plan_days: planDays,
    visits,
    labour_assignments: labourAssignments,
    plant_assignments: plantAssignments,
    overrides,
    conflicts: buildBoardConflicts({
      visits,
      labour: labourAssignments,
      plant: plantAssignments,
      overrides,
      absences,
      shiftsByProfile,
    }),
    legacy: { labour: labourDrafts, plant: plantDrafts },
    jobs: projectDailyAllocationJobs(catalogue, visits, labourDrafts, plantDrafts),
    resources: {
      employees,
      plant: (plantsResult.data || []).map((row) => ({
        id: row.id,
        plant_id: row.plant_id,
        nickname: row.nickname,
      })),
      teams: filterSystemTeams(teamsResult.data || [])
        .filter((team) => context.is_admin || team.id === context.team_id)
        .map((team) => ({ id: team.id, name: team.name })),
    },
    publications: publicationMeta,
  };
}
