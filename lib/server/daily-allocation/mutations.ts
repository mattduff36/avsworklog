import { z } from 'zod';
import { canEffectiveRoleUseModuleLevel, getEffectiveModuleAccessLevel } from '@/lib/utils/rbac';
import { normalizeHiredPlantSerial } from '@/lib/utils/job-catalogue';
import {
  isDailyAllocationTrustedInterval,
} from '@/lib/utils/daily-allocation-timeline';
import {
  DailyAllocationError,
  blankToNull,
  callDailyAllocationRpc,
  fromUntyped,
  isWorkDate,
  mapPostgresError,
  parseWithSchema,
  requireDailyAllocationManagerMutation,
  requireDailyAllocationMutation,
} from '@/lib/server/daily-allocation/auth';
import { mapLabourDraft, mapPlantDraft } from '@/lib/server/daily-allocation/legacy-adapter';
import type {
  DailyAllocationAssignmentDeleteInput,
  DailyAllocationConvertInput,
  DailyAllocationConvertResult,
  DailyAllocationLabourAssignInput,
  DailyLabourDraft,
  DailyLabourDraftInput,
  DailyAllocationOverrideInput,
  DailyAllocationPlantAssignInput,
  DailyPlantDraft,
  DailyPlantDraftInput,
  DailyAllocationVisitDeleteInput,
  DailyAllocationVisitMoveInput,
  DailyAllocationVisitMoveResult,
  DailyAllocationVisitMutationResult,
  DailyAllocationVisitUpsertInput,
  DailyAllocationVisit,
} from '@/types/daily-allocation';

const workDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A valid work date is required.');
const uuidSchema = z.string().uuid('Invalid ID format');
const optionalUuidSchema = z.string().uuid('Invalid ID format').nullable().optional();
const jobSourceSchema = z.enum(['live_quote', 'legacy_quote', 'project_number']);
const plantKindSchema = z.enum(['registered', 'hired']);
const conflictKindSchema = z.enum(['pending_absence', 'off_shift']);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const versionSchema = z.number().int().positive();

export const convertPlanDaySchema = z.object({
  work_date: workDateSchema,
  team_id: z.string().trim().min(1).nullable().optional(),
});

export const visitUpsertSchema = z.object({
  visit_id: optionalUuidSchema,
  plan_day_id: uuidSchema,
  expected_plan_version: versionSchema,
  expected_row_version: z.number().int().nonnegative().optional(),
  job_source_type: jobSourceSchema,
  job_source_id: uuidSchema,
  job_code: z.string().trim().min(1, 'A catalogue job is required.'),
  starts_at: isoDateTimeSchema,
  ends_at: isoDateTimeSchema,
  meeting_point: z.string().trim().max(500).nullable().optional(),
  meet_person: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (new Date(value.ends_at) <= new Date(value.starts_at)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Visit end time must be after its start time.',
      path: ['ends_at'],
    });
  }
  if (!isDailyAllocationTrustedInterval(value.starts_at, value.ends_at)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Visit times must land on 30-minute London boundaries, stay on one day, and last at least 30 minutes.',
      path: ['starts_at'],
    });
  }
});

export const visitMoveSchema = z.object({
  visit_id: uuidSchema,
  target_plan_day_id: uuidSchema,
  expected_source_plan_version: versionSchema,
  expected_target_plan_version: versionSchema,
  expected_row_version: versionSchema,
  starts_at: isoDateTimeSchema,
  ends_at: isoDateTimeSchema,
}).superRefine((value, ctx) => {
  if (!isDailyAllocationTrustedInterval(value.starts_at, value.ends_at)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Visit times must land on 30-minute London boundaries, stay on one day, and last at least 30 minutes.',
      path: ['starts_at'],
    });
  }
});

export const visitDeleteSchema = z.object({
  visit_id: uuidSchema.optional(),
  expected_plan_version: versionSchema,
  expected_row_version: versionSchema,
});

export const labourAssignSchema = z.object({
  visit_id: uuidSchema,
  profile_id: uuidSchema,
  expected_plan_version: versionSchema,
  meeting_point: z.string().trim().max(500).nullable().optional(),
  meet_person: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  override_id: optionalUuidSchema,
});

export const plantAssignSchema = z.object({
  visit_id: uuidSchema,
  expected_plan_version: versionSchema,
  plant_kind: plantKindSchema,
  plant_id: optionalUuidSchema,
  hired_serial: z.string().trim().max(120).nullable().optional(),
  hired_description: z.string().trim().max(500).nullable().optional(),
  hired_company: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.plant_kind === 'registered' && !value.plant_id) {
    ctx.addIssue({ code: 'custom', message: 'Choose a registered plant asset.', path: ['plant_id'] });
  }
  if (value.plant_kind === 'hired') {
    if (!blankToNull(value.hired_serial) || !blankToNull(value.hired_description) || !blankToNull(value.hired_company)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Hired plant needs a serial or ID, description, and hire company.',
        path: ['hired_serial'],
      });
    }
  }
});

export const assignmentDeleteSchema = z.object({
  assignment_id: uuidSchema.optional(),
  expected_plan_version: versionSchema,
});

export const conflictOverrideSchema = z.object({
  plan_day_id: uuidSchema,
  expected_plan_version: versionSchema,
  conflict_kind: conflictKindSchema,
  evidence: z.string().trim().min(1, 'Override evidence is required.').max(2000),
  visit_id: optionalUuidSchema,
  profile_id: uuidSchema,
});

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

type ConvertedPlanDayRow = {
  id: string;
  work_date: string;
  team_id: string;
  plan_version: number;
};

export async function convertDailyAllocationPlanDay(
  input: DailyAllocationConvertInput
): Promise<DailyAllocationConvertResult> {
  const { supabase, effectiveRole } = await requireDailyAllocationManagerMutation();
  const parsed = parseWithSchema(convertPlanDaySchema, input, 'Invalid convert request.');
  if (!isWorkDate(parsed.work_date)) {
    throw new DailyAllocationError('A valid work date is required.', 400, 'VALIDATION');
  }
  const teamId = blankToNull(parsed.team_id) || effectiveRole.team_id;
  if (!teamId) {
    throw new DailyAllocationError('A team is required to convert this date.', 400, 'VALIDATION');
  }
  const planDayId = await callDailyAllocationRpc<string>(supabase, 'convert_daily_allocation_plan_day_v2', {
    p_work_date: parsed.work_date,
    p_team_id: teamId,
  });
  const { data: planDay, error } = await fromUntyped<ConvertedPlanDayRow>(
    supabase,
    'daily_allocation_plan_days'
  )
    .select('id, work_date, team_id, plan_version')
    .eq('id', planDayId)
    .maybeSingle();
  if (error) {
    throw mapPostgresError(error) || new DailyAllocationError(
      'Unable to complete daily allocation request.',
      500
    );
  }
  if (!planDay) {
    throw new DailyAllocationError('Plan day not found.', 404, 'NOT_FOUND');
  }
  if (
    planDay.id !== planDayId
    || planDay.work_date !== parsed.work_date
    || planDay.team_id !== teamId
    || !Number.isInteger(planDay.plan_version)
    || planDay.plan_version < 1
  ) {
    throw new DailyAllocationError(
      'This plan was updated by someone else. Reload and try again.',
      409,
      'STALE_PLAN_VERSION'
    );
  }
  return {
    plan_day_id: planDay.id,
    plan_version: planDay.plan_version,
    team_id: planDay.team_id,
    work_date: planDay.work_date,
  };
}

type VisitMutationRpcRow = {
  visit_id: string;
  plan_day_id: string;
  plan_version: number;
  visit: DailyAllocationVisit;
  source_plan_day_id?: string;
  source_plan_version?: number;
  target_plan_day_id?: string;
  target_plan_version?: number;
};

function mapVisitMutationResult(row: VisitMutationRpcRow): DailyAllocationVisitMutationResult {
  return {
    visit_id: row.visit.id,
    visit: {
      id: row.visit.id,
      plan_day_id: row.visit.plan_day_id,
      work_date: String(row.visit.work_date),
      owner_team_id: row.visit.owner_team_id,
      job_source_type: row.visit.job_source_type,
      job_source_id: row.visit.job_source_id,
      job_code: row.visit.job_code,
      site_address: row.visit.site_address,
      starts_at: row.visit.starts_at,
      ends_at: row.visit.ends_at,
      meeting_point: row.visit.meeting_point ?? null,
      meet_person: row.visit.meet_person ?? null,
      notes: row.visit.notes ?? null,
      row_version: row.visit.row_version,
      updated_at: row.visit.updated_at,
    },
    plan_day_id: row.plan_day_id,
    plan_version: row.plan_version,
  };
}

export async function upsertDailyAllocationVisit(
  input: DailyAllocationVisitUpsertInput
): Promise<DailyAllocationVisitMutationResult> {
  const { supabase } = await requireDailyAllocationManagerMutation();
  const parsed = parseWithSchema(visitUpsertSchema, input, 'Invalid visit.');
  const result = await callDailyAllocationRpc<VisitMutationRpcRow>(supabase, 'upsert_daily_allocation_visit_v2', {
    p_visit_id: parsed.visit_id || null,
    p_plan_day_id: parsed.plan_day_id,
    p_expected_plan_version: parsed.expected_plan_version,
    p_expected_row_version: parsed.expected_row_version ?? 1,
    p_job_source_type: parsed.job_source_type,
    p_job_source_id: parsed.job_source_id,
    p_job_code: parsed.job_code,
    p_starts_at: parsed.starts_at,
    p_ends_at: parsed.ends_at,
    p_meeting_point: blankToNull(parsed.meeting_point),
    p_meet_person: blankToNull(parsed.meet_person),
    p_notes: blankToNull(parsed.notes),
  });
  return mapVisitMutationResult(result);
}

export async function moveDailyAllocationVisit(
  input: DailyAllocationVisitMoveInput
): Promise<DailyAllocationVisitMoveResult> {
  const { supabase } = await requireDailyAllocationManagerMutation();
  const parsed = parseWithSchema(visitMoveSchema, input, 'Invalid visit move.');
  const result = await callDailyAllocationRpc<VisitMutationRpcRow>(supabase, 'move_daily_allocation_visit_v2', {
    p_visit_id: parsed.visit_id,
    p_target_plan_day_id: parsed.target_plan_day_id,
    p_expected_source_plan_version: parsed.expected_source_plan_version,
    p_expected_target_plan_version: parsed.expected_target_plan_version,
    p_expected_row_version: parsed.expected_row_version,
    p_starts_at: parsed.starts_at,
    p_ends_at: parsed.ends_at,
  });
  const mapped = mapVisitMutationResult(result);
  if (!result.source_plan_day_id || result.source_plan_version == null
    || !result.target_plan_day_id || result.target_plan_version == null) {
    throw new DailyAllocationError(
      'This plan was updated by someone else. Reload and try again.',
      409,
      'STALE_PLAN_VERSION'
    );
  }
  return {
    ...mapped,
    source_plan_day_id: result.source_plan_day_id,
    source_plan_version: result.source_plan_version,
    target_plan_day_id: result.target_plan_day_id,
    target_plan_version: result.target_plan_version,
  };
}

export async function deleteDailyAllocationVisit(input: DailyAllocationVisitDeleteInput): Promise<{ visit_id: string }> {
  const { supabase } = await requireDailyAllocationManagerMutation();
  const parsed = parseWithSchema(visitDeleteSchema, input, 'Invalid visit delete.');
  if (!parsed.visit_id) {
    throw new DailyAllocationError('A visit id is required.', 400, 'VALIDATION');
  }
  const visitId = await callDailyAllocationRpc<string>(supabase, 'delete_daily_allocation_visit_v2', {
    p_visit_id: parsed.visit_id,
    p_expected_plan_version: parsed.expected_plan_version,
    p_expected_row_version: parsed.expected_row_version,
  });
  return { visit_id: visitId };
}

export async function assignDailyAllocationLabour(input: DailyAllocationLabourAssignInput): Promise<{ assignment_id: string }> {
  const { supabase } = await requireDailyAllocationManagerMutation();
  const parsed = parseWithSchema(labourAssignSchema, input, 'Invalid labour assignment.');
  const assignmentId = await callDailyAllocationRpc<string>(supabase, 'assign_daily_allocation_labour_v2', {
    p_visit_id: parsed.visit_id,
    p_profile_id: parsed.profile_id,
    p_expected_plan_version: parsed.expected_plan_version,
    p_meeting_point: blankToNull(parsed.meeting_point),
    p_meet_person: blankToNull(parsed.meet_person),
    p_notes: blankToNull(parsed.notes),
    p_override_id: parsed.override_id || null,
  });
  return { assignment_id: assignmentId };
}

export async function unassignDailyAllocationLabour(input: DailyAllocationAssignmentDeleteInput): Promise<{ assignment_id: string }> {
  const { supabase } = await requireDailyAllocationManagerMutation();
  const parsed = parseWithSchema(assignmentDeleteSchema, input, 'Invalid labour unassign.');
  if (!parsed.assignment_id) {
    throw new DailyAllocationError('An assignment id is required.', 400, 'VALIDATION');
  }
  const assignmentId = await callDailyAllocationRpc<string>(supabase, 'unassign_daily_allocation_labour_v2', {
    p_assignment_id: parsed.assignment_id,
    p_expected_plan_version: parsed.expected_plan_version,
  });
  return { assignment_id: assignmentId };
}

export async function assignDailyAllocationPlant(input: DailyAllocationPlantAssignInput): Promise<{ assignment_id: string }> {
  const { supabase } = await requireDailyAllocationManagerMutation();
  const parsed = parseWithSchema(plantAssignSchema, input, 'Invalid plant assignment.');
  const assignmentId = await callDailyAllocationRpc<string>(supabase, 'assign_daily_allocation_plant_v2', {
    p_visit_id: parsed.visit_id,
    p_expected_plan_version: parsed.expected_plan_version,
    p_plant_kind: parsed.plant_kind,
    p_plant_id: parsed.plant_kind === 'registered' ? parsed.plant_id || null : null,
    p_hired_serial: parsed.plant_kind === 'hired' ? blankToNull(parsed.hired_serial) : null,
    p_hired_description: parsed.plant_kind === 'hired' ? blankToNull(parsed.hired_description) : null,
    p_hired_company: parsed.plant_kind === 'hired' ? blankToNull(parsed.hired_company) : null,
    p_notes: blankToNull(parsed.notes),
  });
  return { assignment_id: assignmentId };
}

export async function unassignDailyAllocationPlant(input: DailyAllocationAssignmentDeleteInput): Promise<{ assignment_id: string }> {
  const { supabase } = await requireDailyAllocationManagerMutation();
  const parsed = parseWithSchema(assignmentDeleteSchema, input, 'Invalid plant unassign.');
  if (!parsed.assignment_id) {
    throw new DailyAllocationError('An assignment id is required.', 400, 'VALIDATION');
  }
  const assignmentId = await callDailyAllocationRpc<string>(supabase, 'unassign_daily_allocation_plant_v2', {
    p_assignment_id: parsed.assignment_id,
    p_expected_plan_version: parsed.expected_plan_version,
  });
  return { assignment_id: assignmentId };
}

export async function createDailyAllocationConflictOverride(
  input: DailyAllocationOverrideInput
): Promise<{ override_id: string }> {
  const { supabase } = await requireDailyAllocationManagerMutation();
  const parsed = parseWithSchema(conflictOverrideSchema, input, 'Invalid conflict override.');
  const overrideId = await callDailyAllocationRpc<string>(
    supabase,
    'create_daily_allocation_conflict_override_v2',
    {
      p_plan_day_id: parsed.plan_day_id,
      p_expected_plan_version: parsed.expected_plan_version,
      p_conflict_kind: parsed.conflict_kind,
      p_evidence: parsed.evidence,
      p_visit_id: parsed.visit_id || null,
      p_profile_id: parsed.profile_id,
    }
  );
  return { override_id: overrideId };
}
