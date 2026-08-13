import type { PermissionAccessLevel } from './roles';
import type { JobCatalogueSourceType } from './job-catalogue';

export type AbsenceAllocationBehaviour = 'block' | 'reduce' | 'ignore';
export type DailyAllocationAvailability = 'available' | 'full_day_absence' | 'half_day_absence';
export type DailyPlantKind = 'registered' | 'hired';
export type DailyPlantReconciliationStatus =
  | 'planned_only'
  | 'matched'
  | 'job_conflict'
  | 'unplanned_actual'
  | 'unclassified_actual';

export interface DailyAllocationContext {
  user_id: string;
  access_level: PermissionAccessLevel;
  is_manager: boolean;
  is_admin: boolean;
  team_id: string | null;
  team_name: string | null;
}

export interface DailyLabourInstructions {
  start_time: string | null;
  meeting_point: string | null;
  meet_person: string | null;
  notes: string | null;
}

export interface DailyLabourDraft {
  id: string;
  work_date: string;
  profile_id: string;
  job_source_type: JobCatalogueSourceType | null;
  job_source_id: string | null;
  job_code: string | null;
  site_address: string | null;
  instructions: DailyLabourInstructions;
  row_version: number;
  updated_at: string;
}

export interface DailyPlantDraft {
  id: string;
  work_date: string;
  plant_kind: DailyPlantKind;
  plant_id: string | null;
  hired_serial: string | null;
  hired_description: string | null;
  hired_company: string | null;
  owner_team_id: string | null;
  job_source_type: JobCatalogueSourceType | null;
  job_source_id: string | null;
  job_code: string | null;
  site_address: string | null;
  notes: string | null;
  row_version: number;
  updated_at: string;
}

export interface DailyAllocationAbsenceSnapshot {
  absence_id: string | null;
  reason_id: string | null;
  reason_name: string;
  colour: string | null;
  is_paid: boolean;
  is_half_day: boolean;
  half_day_session: 'AM' | 'PM' | null;
  status: 'pending' | 'approved' | 'processed';
  allocation_behaviour: AbsenceAllocationBehaviour;
}

export interface DailyLabourBoardRow {
  profile_id: string;
  full_name: string;
  employee_id: string | null;
  team_id: string | null;
  team_name: string | null;
  availability: DailyAllocationAvailability;
  blocking_absence: DailyAllocationAbsenceSnapshot | null;
  pending_absence: DailyAllocationAbsenceSnapshot | null;
  draft: DailyLabourDraft | null;
  latest_issued: {
    publication_id: string;
    revision_no: number;
    published_at: string;
    job_code: string | null;
    site_address: string | null;
    instructions: DailyLabourInstructions;
    availability: DailyAllocationAvailability;
  } | null;
  can_manage: boolean;
  publish_ready: boolean;
  warnings: string[];
}

export interface DailyPlantBoardRow {
  draft: DailyPlantDraft;
  plant_label: string;
  owned_by_other_team: boolean;
  can_reassign: boolean;
  publish_ready: boolean;
  warnings: string[];
}

export interface DailyAllocationBoardPayload {
  work_date: string;
  context: DailyAllocationContext;
  labour: DailyLabourBoardRow[];
  plant: DailyPlantBoardRow[];
  latest_publication: {
    id: string;
    revision_no: number;
    published_at: string;
    published_by_name: string | null;
  } | null;
  available_plant: Array<{
    id: string;
    plant_id: string;
    nickname: string | null;
  }>;
}

export interface DailyAllocationIssuedItem {
  publication_id: string;
  revision_no: number;
  published_at: string;
  work_date: string;
  availability: DailyAllocationAvailability;
  job_code: string | null;
  site_address: string | null;
  customer_name: string | null;
  title: string | null;
  instructions: DailyLabourInstructions;
  absence: DailyAllocationAbsenceSnapshot | null;
}

export interface DailyPlantReconciliationRow {
  work_date: string;
  plant_kind: DailyPlantKind;
  plant_id: string | null;
  hired_serial: string | null;
  plant_label: string;
  planned_job_code: string | null;
  actual_job_code: string | null;
  inspection_id: string | null;
  status: DailyPlantReconciliationStatus;
}

export interface DailyLabourDraftInput {
  work_date: string;
  profile_id: string;
  job_source_type?: JobCatalogueSourceType | null;
  job_source_id?: string | null;
  job_code?: string | null;
  start_time?: string | null;
  meeting_point?: string | null;
  meet_person?: string | null;
  notes?: string | null;
  row_version?: number | null;
}

export interface DailyPlantDraftInput {
  work_date: string;
  plant_kind: DailyPlantKind;
  plant_id?: string | null;
  hired_serial?: string | null;
  hired_description?: string | null;
  hired_company?: string | null;
  job_source_type?: JobCatalogueSourceType | null;
  job_source_id?: string | null;
  job_code?: string | null;
  notes?: string | null;
  row_version?: number | null;
  id?: string | null;
}

export interface DailyJobSheetPayload {
  job_code: string;
  source_type: JobCatalogueSourceType | null;
  source_id: string | null;
  customer_name: string | null;
  title: string | null;
  site_address: string | null;
  source_href: string | null;
  labour: Array<{
    work_date: string;
    revision_no: number;
    profile_name: string;
    availability: DailyAllocationAvailability;
    site_address: string | null;
    instructions: DailyLabourInstructions;
  }>;
  plant: DailyPlantReconciliationRow[];
}

