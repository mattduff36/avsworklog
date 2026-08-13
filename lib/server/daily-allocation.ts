import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { canEffectiveRoleUseModuleLevel, getEffectiveModuleAccessLevel } from '@/lib/utils/rbac';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { formatFleetAssetLabel } from '@/lib/utils/fleet-asset-label';
import { normalizeHiredPlantSerial } from '@/lib/utils/job-catalogue';
import { listJobCatalogueOptions, loadJobCatalogueRecords, resolveJobCatalogueRecord } from '@/lib/server/job-catalogue';
import { isHiddenSystemTestAccountProfile } from '@/lib/utils/system-test-accounts';
import type { Database } from '@/types/database';
import type { JobCatalogueSourceType } from '@/types/job-catalogue';
import type {
  AbsenceAllocationBehaviour,
  DailyAllocationAvailability,
  DailyAllocationBoardPayload,
  DailyAllocationContext,
  DailyAllocationIssuedItem,
  DailyJobSheetPayload,
  DailyLabourBoardRow,
  DailyLabourDraft,
  DailyLabourDraftInput,
  DailyLabourInstructions,
  DailyPlantBoardRow,
  DailyPlantDraft,
  DailyPlantDraftInput,
  DailyPlantReconciliationRow,
  DailyPlantReconciliationStatus,
} from '@/types/daily-allocation';

type AuthedClient = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;
type LabourDraftRow = Database['public']['Tables']['daily_labour_allocation_drafts']['Row'];
type PlantDraftRow = Database['public']['Tables']['daily_plant_allocation_drafts']['Row'];
type LabourItemRow = Database['public']['Tables']['daily_allocation_labour_items']['Row'];
type PlantItemRow = Database['public']['Tables']['daily_allocation_plant_items']['Row'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class DailyAllocationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'DailyAllocationError';
  }
}

export function isWorkDate(value: string | null | undefined): value is string {
  return Boolean(value && DATE_RE.test(value));
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim();
  return trimmed ? trimmed : null;
}

function mapPostgresError(error: { message?: string; code?: string } | null | undefined): DailyAllocationError | null {
  const message = error?.message || '';
  if (message.includes('STALE_DRAFT_VERSION')) {
    return new DailyAllocationError('This allocation was updated by someone else. Reload and try again.', 409, 'STALE_DRAFT_VERSION');
  }
  if (message.includes('JOB_AMBIGUOUS')) {
    return new DailyAllocationError('That job code matches more than one unrelated source.', 400, 'JOB_AMBIGUOUS');
  }
  if (message.includes('JOB_MISSING_SITE')) {
    return new DailyAllocationError('This job cannot be allocated until its source record has a proper site address.', 400, 'JOB_MISSING_SITE');
  }
  if (message.includes('JOB_NOT_FOUND') || message.includes('JOB_REQUIRED')) {
    return new DailyAllocationError('Choose a catalogue job with a valid site address.', 400, 'JOB_NOT_FOUND');
  }
  if (message.includes('PUBLISH_INCOMPLETE')) {
    return new DailyAllocationError('Every available employee needs a job before this date can be published.', 400, 'PUBLISH_INCOMPLETE');
  }
  if (message.includes('viewing as another role') || message.includes('cannot be changed while viewing')) {
    return new DailyAllocationError('Daily allocation cannot be changed while viewing as another role.', 403, 'VIEW_AS');
  }
  if (error?.code === '23505') {
    return new DailyAllocationError('That plant is already allocated on this date.', 409, 'PLANT_CONFLICT');
  }
  return null;
}

function instructionsFromRow(row: {
  start_time: string | null;
  meeting_point: string | null;
  meet_person: string | null;
  notes: string | null;
}): DailyLabourInstructions {
  return {
    start_time: row.start_time,
    meeting_point: row.meeting_point,
    meet_person: row.meet_person,
    notes: row.notes,
  };
}

function mapLabourDraft(row: LabourDraftRow): DailyLabourDraft {
  return {
    id: row.id,
    work_date: row.work_date,
    profile_id: row.profile_id,
    job_source_type: row.job_source_type,
    job_source_id: row.job_source_id,
    job_code: row.job_code,
    site_address: row.site_address,
    instructions: instructionsFromRow(row),
    row_version: row.row_version,
    updated_at: row.updated_at,
  };
}

function mapPlantDraft(row: PlantDraftRow): DailyPlantDraft {
  return {
    id: row.id,
    work_date: row.work_date,
    plant_kind: row.plant_kind,
    plant_id: row.plant_id,
    hired_serial: row.hired_serial,
    hired_description: row.hired_description,
    hired_company: row.hired_company,
    owner_team_id: row.owner_team_id,
    job_source_type: row.job_source_type,
    job_source_id: row.job_source_id,
    job_code: row.job_code,
    site_address: row.site_address,
    notes: row.notes,
    row_version: row.row_version,
    updated_at: row.updated_at,
  };
}

export async function requireDailyAllocationUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new DailyAllocationError('Unauthorized', 401);
  }
  return { supabase, user };
}

export async function requireDailyAllocationMutation() {
  const auth = await requireDailyAllocationUser();
  const effectiveRole = await getEffectiveRole();
  if (effectiveRole.is_viewing_as) {
    throw new DailyAllocationError('Daily allocation cannot be changed while viewing as another role.', 403, 'VIEW_AS');
  }
  return { ...auth, effectiveRole };
}

export async function getDailyAllocationContext(): Promise<DailyAllocationContext> {
  const { user } = await requireDailyAllocationUser();
  const accessLevel = await getEffectiveModuleAccessLevel('daily-allocation');
  if (accessLevel < 2) {
    throw new DailyAllocationError('Daily allocation access required', 403);
  }
  const effectiveRole = await getEffectiveRole();
  return {
    user_id: user.id,
    access_level: accessLevel,
    is_manager: accessLevel >= 4,
    is_admin: accessLevel >= 5,
    team_id: effectiveRole.team_id,
    team_name: effectiveRole.team_name,
  };
}

async function loadScopedProfileIds(supabase: AuthedClient, isAdmin: boolean): Promise<string[]> {
  if (isAdmin) {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('profiles')
      .select('id, full_name, employee_id')
      .eq('is_placeholder', false);
    if (error) throw error;
    return (data || [])
      .filter((row) => !isHiddenSystemTestAccountProfile(row))
      .map((row) => row.id);
  }

  const { data, error } = await supabase.rpc('list_daily_allocation_scope_profile_ids');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export function classifyAbsence(input: {
  status: string | null;
  is_half_day: boolean | null;
  allocation_behaviour: AbsenceAllocationBehaviour | null;
}): DailyAllocationAvailability | 'pending' | null {
  const behaviour = input.allocation_behaviour || 'block';
  if (input.status === 'pending') return 'pending';
  if (input.status !== 'approved' && input.status !== 'processed') return null;
  if (behaviour === 'ignore') return null;
  if (behaviour === 'block' || !input.is_half_day) return 'full_day_absence';
  return 'half_day_absence';
}

export async function loadDailyAllocationBoard(workDate: string): Promise<DailyAllocationBoardPayload> {
  if (!isWorkDate(workDate)) {
    throw new DailyAllocationError('A valid work date is required.', 400);
  }

  const context = await getDailyAllocationContext();
  if (!context.is_manager) {
    throw new DailyAllocationError('Manager-level daily allocation access is required.', 403);
  }

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
      .select('id, full_name, employee_id, team_id')
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
    supabase
      .from('daily_allocation_publications')
      .select('id, revision_no, published_at, published_by, scope_team_id')
      .eq('work_date', workDate)
      .order('revision_no', { ascending: false }),
    admin
      .from('plant')
      .select('id, plant_id, nickname, status')
      .eq('status', 'active'),
    admin
      .from('org_teams')
      .select('id, name'),
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

  const teamNameById = new Map((teams || []).map((team) => [team.id, team.name]));
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
    .filter((profile) => !isHiddenSystemTestAccountProfile(profile))
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
            instructions: instructionsFromRow(issued),
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

export async function saveLabourDraft(input: DailyLabourDraftInput): Promise<DailyLabourDraft> {
  const { supabase } = await requireDailyAllocationMutation();
  const canManage = await canEffectiveRoleUseModuleLevel('daily-allocation', 4);
  if (!canManage) throw new DailyAllocationError('Manager-level daily allocation access is required.', 403);
  if (!isWorkDate(input.work_date)) throw new DailyAllocationError('A valid work date is required.', 400);

  const payload = {
    work_date: input.work_date,
    profile_id: input.profile_id,
    job_source_type: input.job_source_type || null,
    job_source_id: input.job_source_id || null,
    job_code: blankToNull(input.job_code),
    start_time: blankToNull(input.start_time),
    meeting_point: blankToNull(input.meeting_point),
    meet_person: blankToNull(input.meet_person),
    notes: blankToNull(input.notes),
  };

  const { data: existing } = await supabase
    .from('daily_labour_allocation_drafts')
    .select('id, row_version')
    .eq('work_date', input.work_date)
    .eq('profile_id', input.profile_id)
    .maybeSingle();

  let result;
  if (existing) {
    if (input.row_version != null && input.row_version !== existing.row_version) {
      throw new DailyAllocationError('This allocation was updated by someone else. Reload and try again.', 409, 'STALE_DRAFT_VERSION');
    }
    result = await supabase
      .from('daily_labour_allocation_drafts')
      .update({ ...payload, row_version: existing.row_version })
      .eq('id', existing.id)
      .eq('row_version', existing.row_version)
      .select('*')
      .maybeSingle();
  } else {
    result = await supabase
      .from('daily_labour_allocation_drafts')
      .insert(payload)
      .select('*')
      .maybeSingle();
  }

  if (result.error) {
    throw mapPostgresError(result.error) || result.error;
  }
  if (!result.data) {
    throw new DailyAllocationError('This allocation was updated by someone else. Reload and try again.', 409, 'STALE_DRAFT_VERSION');
  }
  return mapLabourDraft(result.data);
}

export async function deleteLabourDraft(workDate: string, profileId: string): Promise<void> {
  const { supabase } = await requireDailyAllocationMutation();
  const canManage = await canEffectiveRoleUseModuleLevel('daily-allocation', 4);
  if (!canManage) throw new DailyAllocationError('Manager-level daily allocation access is required.', 403);
  const { error } = await supabase
    .from('daily_labour_allocation_drafts')
    .delete()
    .eq('work_date', workDate)
    .eq('profile_id', profileId);
  if (error) throw mapPostgresError(error) || error;
}

export async function savePlantDraft(input: DailyPlantDraftInput): Promise<DailyPlantDraft> {
  const { supabase } = await requireDailyAllocationMutation();
  const accessLevel = await getEffectiveModuleAccessLevel('daily-allocation');
  if (accessLevel < 4) throw new DailyAllocationError('Manager-level daily allocation access is required.', 403);
  if (!isWorkDate(input.work_date)) throw new DailyAllocationError('A valid work date is required.', 400);
  if (input.owner_team_id && accessLevel < 5) {
    throw new DailyAllocationError('Only level-5 administrators can reassign plant ownership.', 403);
  }

  const payload = {
    work_date: input.work_date,
    plant_kind: input.plant_kind,
    plant_id: input.plant_kind === 'registered' ? input.plant_id || null : null,
    hired_serial: input.plant_kind === 'hired' ? blankToNull(input.hired_serial) : null,
    hired_description: input.plant_kind === 'hired' ? blankToNull(input.hired_description) : null,
    hired_company: input.plant_kind === 'hired' ? blankToNull(input.hired_company) : null,
    ...(input.owner_team_id ? { owner_team_id: input.owner_team_id } : {}),
    job_source_type: input.job_source_type || null,
    job_source_id: input.job_source_id || null,
    job_code: blankToNull(input.job_code),
    notes: blankToNull(input.notes),
  };

  let existingQuery = supabase
    .from('daily_plant_allocation_drafts')
    .select('id, row_version, owner_team_id')
    .eq('work_date', input.work_date);
  if (input.id) {
    existingQuery = existingQuery.eq('id', input.id);
  } else if (input.plant_kind === 'registered') {
    if (!input.plant_id) {
      throw new DailyAllocationError('Choose a registered plant asset.', 400);
    }
    existingQuery = existingQuery.eq('plant_id', input.plant_id);
  } else {
    const hiredSerial = normalizeHiredPlantSerial(input.hired_serial);
    const hiredCompany = normalizeHiredPlantSerial(input.hired_company);
    if (!hiredSerial || !hiredCompany) {
      throw new DailyAllocationError('Hired plant needs a serial or ID, description, and hire company.', 400);
    }
    existingQuery = existingQuery
      .eq('hired_serial_normalized', hiredSerial)
      .eq('hired_company_normalized', hiredCompany);
  }

  const { data: existing } = await existingQuery.maybeSingle();
  let result;
  if (existing) {
    if (input.row_version != null && input.row_version !== existing.row_version) {
      throw new DailyAllocationError('This allocation was updated by someone else. Reload and try again.', 409, 'STALE_DRAFT_VERSION');
    }
    result = await supabase
      .from('daily_plant_allocation_drafts')
      .update({ ...payload, row_version: existing.row_version })
      .eq('id', existing.id)
      .eq('row_version', existing.row_version)
      .select('*')
      .maybeSingle();
  } else {
    result = await supabase
      .from('daily_plant_allocation_drafts')
      .insert(payload)
      .select('*')
      .maybeSingle();
  }

  if (result.error) throw mapPostgresError(result.error) || result.error;
  if (!result.data) {
    throw new DailyAllocationError('This allocation was updated by someone else. Reload and try again.', 409, 'STALE_DRAFT_VERSION');
  }
  return mapPlantDraft(result.data);
}

export async function deletePlantDraft(id: string): Promise<void> {
  const { supabase } = await requireDailyAllocationMutation();
  const canManage = await canEffectiveRoleUseModuleLevel('daily-allocation', 4);
  if (!canManage) throw new DailyAllocationError('Manager-level daily allocation access is required.', 403);
  const { error } = await supabase
    .from('daily_plant_allocation_drafts')
    .delete()
    .eq('id', id);
  if (error) throw mapPostgresError(error) || error;
}

export async function publishDailyAllocation(workDate: string, idempotencyKey: string) {
  const { supabase } = await requireDailyAllocationMutation();
  const canManage = await canEffectiveRoleUseModuleLevel('daily-allocation', 4);
  if (!canManage) throw new DailyAllocationError('Manager-level daily allocation access is required.', 403);
  if (!isWorkDate(workDate)) throw new DailyAllocationError('A valid work date is required.', 400);
  const key = blankToNull(idempotencyKey);
  if (!key) throw new DailyAllocationError('Idempotency key is required.', 400);

  const insert = await supabase
    .from('daily_allocation_publications')
    .insert({
      work_date: workDate,
      idempotency_key: key,
    })
    .select('id, work_date, revision_no, published_at, published_by')
    .maybeSingle();

  if (insert.error?.code === '23505') {
    const existing = await supabase
      .from('daily_allocation_publications')
      .select('id, work_date, revision_no, published_at, published_by')
      .eq('idempotency_key', key)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return existing.data;
  }

  if (insert.error) throw mapPostgresError(insert.error) || insert.error;
  if (!insert.data) throw new DailyAllocationError('Unable to publish this allocation.', 500);
  return insert.data;
}

function mapIssuedItem(
  item: LabourItemRow,
  publication: { id: string; revision_no: number; published_at: string; work_date: string }
): DailyAllocationIssuedItem {
  return {
    publication_id: publication.id,
    revision_no: publication.revision_no,
    published_at: publication.published_at,
    work_date: publication.work_date,
    availability: item.availability,
    job_code: item.job_code,
    site_address: item.site_address,
    customer_name: item.customer_name,
    title: item.title,
    instructions: instructionsFromRow(item),
    absence: item.absence_reason_name
      ? {
          absence_id: item.absence_id,
          reason_id: item.absence_reason_id,
          reason_name: item.absence_reason_name,
          colour: item.absence_colour,
          is_paid: Boolean(item.absence_is_paid),
          is_half_day: Boolean(item.absence_is_half_day),
          half_day_session: (item.absence_half_day_session as 'AM' | 'PM' | null) || null,
          status: (item.absence_status as 'pending' | 'approved' | 'processed') || 'approved',
          allocation_behaviour: (item.absence_allocation_behaviour || 'block') as AbsenceAllocationBehaviour,
        }
      : null,
  };
}

export async function loadMyAllocation(workDate?: string, itemId?: string): Promise<{
  current: DailyAllocationIssuedItem | null;
  history: DailyAllocationIssuedItem[];
}> {
  const { supabase, user } = await requireDailyAllocationUser();
  const canView = await canEffectiveRoleUseModuleLevel('daily-allocation', 2);
  if (!canView) throw new DailyAllocationError('Daily allocation access required', 403);

  const itemsQuery = supabase
    .from('daily_allocation_labour_items')
    .select('*')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false });

  const { data: items, error } = await itemsQuery;
  if (error) throw error;
  if (!items?.length) return { current: null, history: [] };

  const publicationIds = Array.from(new Set(items.map((item) => item.publication_id)));
  const { data: publications, error: publicationError } = await supabase
    .from('daily_allocation_publications')
    .select('id, work_date, revision_no, published_at')
    .in('id', publicationIds);
  if (publicationError) throw publicationError;

  const publicationById = new Map((publications || []).map((row) => [row.id, row]));
  const mapped = items
    .map((item) => {
      const publication = publicationById.get(item.publication_id);
      if (!publication) return null;
      if (workDate && publication.work_date !== workDate) return null;
      return mapIssuedItem(item, publication);
    })
    .filter((item): item is DailyAllocationIssuedItem => Boolean(item))
    .sort((left, right) => {
      if (left.work_date !== right.work_date) return right.work_date.localeCompare(left.work_date);
      return right.revision_no - left.revision_no;
    });

  const requestedPublicationId = itemId
    ? items.find((item) => item.id === itemId)?.publication_id
    : null;
  const current = requestedPublicationId
    ? mapped.find((item) => item.publication_id === requestedPublicationId) || null
    : mapped[0] || null;
  return { current, history: mapped };
}

export function reconcilePlant(
  planned: PlantItemRow[],
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

  const relatedPublicationIds = Array.from(new Set([
    ...(labourItems || []).map((item) => item.publication_id),
    ...(plantItemsForJob || []).map((item) => item.publication_id),
  ]));
  const { data: relatedPublications } = relatedPublicationIds.length
    ? await supabase
        .from('daily_allocation_publications')
        .select('id, work_date, revision_no, published_at, scope_team_id')
        .in('id', relatedPublicationIds)
    : { data: [] as Array<{ id: string; work_date: string; revision_no: number; published_at: string; scope_team_id: string | null }> };

  const relatedDates = Array.from(new Set((relatedPublications || []).map((row) => row.work_date)));
  const { data: publications } = relatedDates.length
    ? await supabase
        .from('daily_allocation_publications')
        .select('id, work_date, revision_no, published_at, scope_team_id')
        .in('work_date', relatedDates)
    : { data: relatedPublications || [] };

  const publicationById = new Map((publications || []).map((row) => [row.id, row]));
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
  const latestLabour = Array.from(latestLabourByDateProfile.values())
    .filter((item) => item.job_code === canonicalJobCode);

  const latestByDateTeam = new Map<string, { id: string; revision_no: number; work_date: string; scope_team_id: string | null }>();
  for (const publication of publications || []) {
    const key = `${publication.work_date}:${publication.scope_team_id || publication.id}`;
    const current = latestByDateTeam.get(key);
    if (!current || publication.revision_no > current.revision_no) {
      latestByDateTeam.set(key, publication);
    }
  }

  const latestPublicationIds = new Set(Array.from(latestByDateTeam.values()).map((row) => row.id));
  const plantItems = (plantItemsForJob || []).filter((item) => latestPublicationIds.has(item.publication_id));

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

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name')
    .in('id', inspectionScope);
  const nameById = new Map((profiles || []).map((row) => [row.id, row.full_name]));

  const plantByPublicationDate = new Map<string, PlantItemRow[]>();
  for (const item of plantItems) {
    const publication = publicationById.get(item.publication_id);
    const workDate = publication?.work_date || '';
    plantByPublicationDate.set(workDate, [...(plantByPublicationDate.get(workDate) || []), item]);
  }

  const plant: DailyPlantReconciliationRow[] = [];
  for (const workDate of workDates) {
    const planned = plantByPublicationDate.get(workDate) || [];
    const rows = reconcilePlant(planned, inspections || [], plantById, workDate);
    for (const row of rows) {
      if (row.status === 'unplanned_actual' && row.actual_job_code !== canonicalJobCode) continue;
      plant.push(row);
    }
  }

  const sourceHref = resolved.record
    ? resolved.record.source_type === 'live_quote'
      ? `/quotes?quote_id=${resolved.record.source_id}`
      : resolved.record.source_type === 'project_number'
        ? '/quotes?tab=projects'
        : '/quotes?tab=legacy'
    : null;

  return {
    job_code: resolved.record?.job_code || jobCode,
    source_type: resolved.record?.source_type || null,
    source_id: resolved.record?.source_id || null,
    customer_name: resolved.record?.customer_name || null,
    title: resolved.record?.title || null,
    site_address: resolved.record?.site_address || null,
    source_href: sourceHref,
    labour: latestLabour.map((item) => {
      const publication = publicationById.get(item.publication_id)!;
      return {
        work_date: publication.work_date,
        revision_no: publication.revision_no,
        profile_name: nameById.get(item.profile_id) || 'Employee',
        availability: item.availability,
        site_address: item.site_address,
        instructions: instructionsFromRow(item),
      };
    }),
    plant,
  };
}

export async function listAllocationJobCodes(query = '') {
  await getDailyAllocationContext();
  const records = await loadJobCatalogueRecords();
  return listJobCatalogueOptions(records, query);
}

export function jsonDailyAllocationError(error: unknown) {
  if (error instanceof DailyAllocationError) {
    return { error: error.message, code: error.code, status: error.status };
  }
  return { error: 'Unable to complete daily allocation request.', status: 500 };
}

export type { JobCatalogueSourceType, AdminClient };
