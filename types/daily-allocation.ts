import type { PermissionAccessLevel } from './roles';
import type { JobCatalogueSourceType } from './job-catalogue';

export type AbsenceAllocationBehaviour = 'block' | 'reduce' | 'ignore';
export type DailyAllocationAvailability = 'available' | 'full_day_absence' | 'half_day_absence';
export type DailyPlantKind = 'registered' | 'hired';
export type DailyAllocationSnapshotVersion = 1 | 2;
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
  publication_history: Array<{
    id: string;
    revision_no: number;
    published_at: string;
    published_by_name: string | null;
    scope_team_id: string | null;
    snapshot_version: DailyAllocationSnapshotVersion;
  }>;
  available_plant: Array<{
    id: string;
    plant_id: string;
    nickname: string | null;
  }>;
  available_teams: Array<{
    id: string;
    name: string;
  }>;
}

export interface DailyAllocationIssuedVisit {
  published_visit_id: string;
  sequence_no: number;
  job_code: string;
  site_address: string;
  customer_name: string | null;
  title: string | null;
  starts_at: string;
  ends_at: string;
  instructions: DailyLabourInstructions;
}

export interface DailyAllocationIssuedItem {
  publication_id: string;
  revision_no: number;
  published_at: string;
  work_date: string;
  snapshot_version: DailyAllocationSnapshotVersion;
  unallocated: boolean;
  availability: DailyAllocationAvailability;
  job_code: string | null;
  site_address: string | null;
  customer_name: string | null;
  title: string | null;
  instructions: DailyLabourInstructions;
  absence: DailyAllocationAbsenceSnapshot | null;
  visits: DailyAllocationIssuedVisit[];
}

export interface DailyAllocationIssuedPayload {
  current: DailyAllocationIssuedItem | null;
  history: DailyAllocationIssuedItem[];
}

export interface LoadMyAllocationQuery {
  workDate?: string;
  itemId?: string;
  publicationId?: string;
  revisionNo?: number;
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
  owner_team_id?: string | null;
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
    snapshot_version: DailyAllocationSnapshotVersion;
    profile_name: string;
    availability: DailyAllocationAvailability;
    job_code: string | null;
    customer_name: string | null;
    title: string | null;
    site_address: string | null;
    starts_at: string | null;
    ends_at: string | null;
    sequence_no: number | null;
    published_visit_id: string | null;
    instructions: DailyLabourInstructions;
  }>;
  plant: DailyPlantReconciliationRow[];
}

export type DailyAllocationConflictKind = 'pending_absence' | 'off_shift';
export type DailyAllocationConflictSeverity = 'hard' | 'warning';
export type DailyAllocationBoardConflictCode =
  | 'employee_absent'
  | 'employee_half_day'
  | 'pending_absence'
  | 'off_shift'
  | 'employee_overlap'
  | 'plant_overlap'
  | 'plant_job';

export interface DailyAllocationPlanDay {
  id: string;
  work_date: string;
  team_id: string;
  plan_version: number;
  converted_at: string;
  converted_by: string | null;
  updated_at: string;
}

export interface DailyAllocationVisit {
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
}

export interface DailyAllocationLabourAssignment {
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
}

export interface DailyAllocationPlantAssignment {
  id: string;
  visit_id: string;
  plan_day_id: string;
  work_date: string;
  plant_kind: DailyPlantKind;
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
}

export interface DailyAllocationConflictOverride {
  id: string;
  plan_day_id: string;
  visit_id: string | null;
  profile_id: string | null;
  plant_id: string | null;
  conflict_kind: DailyAllocationConflictKind;
  evidence: string;
  confirmed_by: string;
  confirmed_at: string;
}

export interface DailyAllocationLegacyUntimedAllocations {
  labour: DailyLabourDraft[];
  plant: DailyPlantDraft[];
}

export interface DailyAllocationPublicationMeta {
  id: string;
  work_date: string;
  revision_no: number;
  published_at: string;
  published_by: string;
  published_by_name: string | null;
  scope_team_id: string | null;
  snapshot_version: DailyAllocationSnapshotVersion;
  plan_day_id: string | null;
  published_plan_version: number | null;
  confirm_unallocated: boolean;
}

export interface DailyAllocationJobProjection {
  source_type: JobCatalogueSourceType;
  source_id: string;
  job_code: string;
  customer_name: string | null;
  title: string | null;
  site_address: string | null;
  source_href: string | null;
}

export interface DailyAllocationEmployeeDayAvailability {
  work_date: string;
  availability: DailyAllocationAvailability;
  blocking_absence: DailyAllocationAbsenceSnapshot | null;
  pending_absence: DailyAllocationAbsenceSnapshot | null;
  am_working: boolean;
  pm_working: boolean;
}

export interface DailyAllocationEmployeeResource {
  profile_id: string;
  full_name: string;
  employee_id: string | null;
  team_id: string | null;
  team_name: string | null;
  days: DailyAllocationEmployeeDayAvailability[];
}

export interface DailyAllocationPlantResource {
  id: string;
  plant_id: string;
  nickname: string | null;
}

export interface DailyAllocationBoardConflict {
  code: DailyAllocationBoardConflictCode;
  severity: DailyAllocationConflictSeverity;
  work_date: string;
  visit_id: string | null;
  profile_id: string | null;
  plant_assignment_id: string | null;
  override_id: string | null;
  message: string;
}

export interface DailyAllocationRangeBoardPayload {
  start_date: string;
  end_date: string;
  dates: string[];
  context: DailyAllocationContext;
  plan_days: DailyAllocationPlanDay[];
  visits: DailyAllocationVisit[];
  labour_assignments: DailyAllocationLabourAssignment[];
  plant_assignments: DailyAllocationPlantAssignment[];
  overrides: DailyAllocationConflictOverride[];
  conflicts: DailyAllocationBoardConflict[];
  legacy: DailyAllocationLegacyUntimedAllocations;
  jobs: DailyAllocationJobProjection[];
  resources: {
    employees: DailyAllocationEmployeeResource[];
    plant: DailyAllocationPlantResource[];
    teams: Array<{ id: string; name: string }>;
  };
  publications: DailyAllocationPublicationMeta[];
}

export interface DailyAllocationConvertInput {
  work_date: string;
  team_id?: string | null;
}

export interface DailyAllocationConvertResult {
  plan_day_id: string;
  plan_version: number;
  team_id: string;
  work_date: string;
}

export interface DailyAllocationVisitUpsertInput {
  visit_id?: string | null;
  plan_day_id: string;
  expected_plan_version: number;
  expected_row_version?: number | null;
  job_source_type: JobCatalogueSourceType;
  job_source_id: string;
  job_code: string;
  starts_at: string;
  ends_at: string;
  meeting_point?: string | null;
  meet_person?: string | null;
  notes?: string | null;
}

export interface DailyAllocationVisitMutationResult {
  visit_id: string;
  visit: DailyAllocationVisit;
  plan_day_id: string;
  plan_version: number;
}

export interface DailyAllocationVisitMoveInput {
  visit_id: string;
  target_plan_day_id: string;
  expected_source_plan_version: number;
  expected_target_plan_version: number;
  expected_row_version: number;
  starts_at: string;
  ends_at: string;
}

export interface DailyAllocationVisitMoveResult extends DailyAllocationVisitMutationResult {
  source_plan_day_id: string;
  source_plan_version: number;
  target_plan_day_id: string;
  target_plan_version: number;
}

export interface DailyAllocationV2Runtime {
  board_enabled: boolean;
  writes_enabled: boolean;
}

export interface DailyAllocationVisitDeleteInput {
  visit_id: string;
  expected_plan_version: number;
  expected_row_version: number;
}

export interface DailyAllocationLabourAssignInput {
  visit_id: string;
  profile_id: string;
  expected_plan_version: number;
  meeting_point?: string | null;
  meet_person?: string | null;
  notes?: string | null;
  override_id?: string | null;
}

export interface DailyAllocationPlantAssignInput {
  visit_id: string;
  expected_plan_version: number;
  plant_kind: DailyPlantKind;
  plant_id?: string | null;
  hired_serial?: string | null;
  hired_description?: string | null;
  hired_company?: string | null;
  notes?: string | null;
}

export interface DailyAllocationAssignmentDeleteInput {
  assignment_id: string;
  expected_plan_version: number;
}

export interface DailyAllocationOverrideInput {
  plan_day_id: string;
  expected_plan_version: number;
  conflict_kind: DailyAllocationConflictKind;
  evidence: string;
  visit_id?: string | null;
  profile_id: string;
}

export interface DailyAllocationPublishV1Input {
  snapshot_version?: 1;
  work_date: string;
  idempotency_key: string;
}

export interface DailyAllocationPublishV2Input {
  snapshot_version: 2;
  plan_day_id: string;
  expected_plan_version: number;
  idempotency_key: string;
  confirm_unallocated?: boolean;
}

export type DailyAllocationPublishInput = DailyAllocationPublishV1Input | DailyAllocationPublishV2Input;

