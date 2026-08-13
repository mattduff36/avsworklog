import type { Database } from '@/types/database';
import type {
  AbsenceAllocationBehaviour,
  DailyAllocationAbsenceSnapshot,
  DailyAllocationAvailability,
  DailyAllocationIssuedItem,
  DailyLabourDraft,
  DailyLabourInstructions,
  DailyPlantDraft,
} from '@/types/daily-allocation';

type LabourDraftRow = Database['public']['Tables']['daily_labour_allocation_drafts']['Row'];
type PlantDraftRow = Database['public']['Tables']['daily_plant_allocation_drafts']['Row'];
type LabourItemRow = Database['public']['Tables']['daily_allocation_labour_items']['Row'];

export function instructionsFromRow(row: {
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

export function emptyLabourInstructions(): DailyLabourInstructions {
  return {
    start_time: null,
    meeting_point: null,
    meet_person: null,
    notes: null,
  };
}

export function absenceFromSnapshotRow(row: {
  absence_id: string | null;
  absence_reason_id: string | null;
  absence_reason_name: string | null;
  absence_colour: string | null;
  absence_is_paid: boolean | null;
  absence_is_half_day: boolean | null;
  absence_half_day_session: string | null;
  absence_status: string | null;
  absence_allocation_behaviour: string | null;
}): DailyAllocationAbsenceSnapshot | null {
  if (!row.absence_reason_name) return null;
  return {
    absence_id: row.absence_id,
    reason_id: row.absence_reason_id,
    reason_name: row.absence_reason_name,
    colour: row.absence_colour,
    is_paid: Boolean(row.absence_is_paid),
    is_half_day: Boolean(row.absence_is_half_day),
    half_day_session: (row.absence_half_day_session as 'AM' | 'PM' | null) || null,
    status: (row.absence_status as 'pending' | 'approved' | 'processed') || 'approved',
    allocation_behaviour: (row.absence_allocation_behaviour || 'block') as AbsenceAllocationBehaviour,
  };
}

export function snapshotVersionFromValue(value: number | null | undefined): 1 | 2 {
  return value === 2 ? 2 : 1;
}

export function mapLabourDraft(row: LabourDraftRow): DailyLabourDraft {
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

export function mapPlantDraft(row: PlantDraftRow): DailyPlantDraft {
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

export function mapIssuedItem(
  item: LabourItemRow,
  publication: { id: string; revision_no: number; published_at: string; work_date: string }
): DailyAllocationIssuedItem {
  return {
    publication_id: publication.id,
    revision_no: publication.revision_no,
    published_at: publication.published_at,
    work_date: publication.work_date,
    snapshot_version: 1,
    unallocated: false,
    availability: item.availability as DailyAllocationAvailability,
    job_code: item.job_code,
    site_address: item.site_address,
    customer_name: item.customer_name,
    title: item.title,
    instructions: instructionsFromRow(item),
    absence: absenceFromSnapshotRow(item),
    visits: [],
  };
}

export function isConvertedTeamDate(
  planDays: Array<{ work_date: string; team_id: string }>,
  workDate: string,
  teamId: string | null | undefined
): boolean {
  if (!teamId) return false;
  return planDays.some((planDay) => planDay.work_date === workDate && planDay.team_id === teamId);
}
