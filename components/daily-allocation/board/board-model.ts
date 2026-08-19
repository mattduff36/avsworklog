import type {
  DailyAllocationBoardConflict,
  DailyAllocationConflictKind,
  DailyAllocationEmployeeResource,
  DailyAllocationJobProjection,
  DailyAllocationLabourAssignment,
  DailyAllocationPlantAssignment,
  DailyAllocationPlanDay,
  DailyAllocationRangeBoardPayload,
  DailyAllocationVisit,
} from '@/types/daily-allocation';
import { jobResourceKey } from '@/components/daily-allocation/board/board-dnd';
import { dailyAllocationIntervalsOverlap, getDailyAllocationTimeMinutes } from '@/lib/utils/daily-allocation-timeline';

export const DAILY_ALLOCATION_MIDDAY_MINUTES = 12 * 60;

export interface DailyAllocationJobRow {
  key: string;
  job: DailyAllocationJobProjection;
  visits: DailyAllocationVisit[];
}

export function buildJobRows(
  board: DailyAllocationRangeBoardPayload,
  options?: { workDate?: string }
): DailyAllocationJobRow[] {
  const visits = options?.workDate
    ? board.visits.filter((visit) => visit.work_date === options.workDate)
    : board.visits;
  const catalogueByKey = new Map(board.jobs.map((job) => [jobResourceKey(job), job]));
  const jobs = new Map<string, DailyAllocationJobProjection>();

  for (const visit of visits) {
    const key = `${visit.job_source_type}:${visit.job_source_id}`;
    if (jobs.has(key)) continue;
    jobs.set(key, catalogueByKey.get(key) || {
      source_type: visit.job_source_type,
      source_id: visit.job_source_id,
      job_code: visit.job_code,
      customer_name: null,
      title: null,
      site_address: visit.site_address,
      source_href: null,
    });
  }

  return [...jobs.values()]
    .sort((left, right) => left.job_code.localeCompare(right.job_code))
    .map((job) => {
      const key = jobResourceKey(job);
      return {
        key,
        job,
        visits: visits.filter(
          (visit) => `${visit.job_source_type}:${visit.job_source_id}` === key
        ),
      };
    });
}

export function planDayForDate(
  board: DailyAllocationRangeBoardPayload,
  workDate: string
): DailyAllocationPlanDay | undefined {
  return board.plan_days.find((planDay) => planDay.work_date === workDate);
}

export function isDateConverted(
  board: DailyAllocationRangeBoardPayload,
  workDate: string
): boolean {
  return Boolean(planDayForDate(board, workDate));
}

export function visitLabour(
  board: DailyAllocationRangeBoardPayload,
  visitId: string
): DailyAllocationLabourAssignment[] {
  return board.labour_assignments.filter((row) => row.visit_id === visitId);
}

export function visitPlant(
  board: DailyAllocationRangeBoardPayload,
  visitId: string
): DailyAllocationPlantAssignment[] {
  return board.plant_assignments.filter((row) => row.visit_id === visitId);
}

export function visitConflicts(
  board: DailyAllocationRangeBoardPayload,
  visitId: string
): DailyAllocationBoardConflict[] {
  return board.conflicts.filter((conflict) => conflict.visit_id === visitId);
}

export function employeeLabel(employee: DailyAllocationEmployeeResource): string {
  return [employee.full_name, employee.employee_id].filter(Boolean).join(' · ');
}

export function employeeDay(
  employee: DailyAllocationEmployeeResource,
  workDate: string
) {
  return employee.days.find((day) => day.work_date === workDate) || null;
}

export function latestPublicationForDate(
  board: DailyAllocationRangeBoardPayload,
  workDate: string
) {
  return [...board.publications]
    .filter((publication) => publication.work_date === workDate)
    .sort((left, right) => right.revision_no - left.revision_no)[0] || null;
}

export function publicationsForDate(
  board: DailyAllocationRangeBoardPayload,
  workDate: string
) {
  return [...board.publications]
    .filter((publication) => publication.work_date === workDate)
    .sort((left, right) => right.revision_no - left.revision_no);
}

export function resolveDailyAllocationActiveTeamId(
  board: DailyAllocationRangeBoardPayload,
  selectedTeamId: string | null
): string | null {
  const teams = board.resources.teams;
  if (selectedTeamId && teams.some((team) => team.id === selectedTeamId)) {
    return selectedTeamId;
  }
  return board.context.team_id || teams[0]?.id || null;
}

export function filterDailyAllocationBoardForTeam(
  board: DailyAllocationRangeBoardPayload,
  teamId: string
): DailyAllocationRangeBoardPayload {
  const planDays = board.plan_days.filter((planDay) => planDay.team_id === teamId);
  const planDayIds = new Set(planDays.map((planDay) => planDay.id));
  const visits = board.visits.filter((visit) => visit.owner_team_id === teamId);
  const visitIds = new Set(visits.map((visit) => visit.id));
  const employees = board.resources.employees.filter((employee) => employee.team_id === teamId);
  const employeeIds = new Set(employees.map((employee) => employee.profile_id));

  return {
    ...board,
    plan_days: planDays,
    visits,
    labour_assignments: board.labour_assignments.filter((assignment) =>
      visitIds.has(assignment.visit_id) || planDayIds.has(assignment.plan_day_id)
    ),
    plant_assignments: board.plant_assignments.filter((assignment) =>
      visitIds.has(assignment.visit_id) || planDayIds.has(assignment.plan_day_id)
    ),
    overrides: board.overrides.filter((override) =>
      planDayIds.has(override.plan_day_id)
      || (override.visit_id != null && visitIds.has(override.visit_id))
    ),
    conflicts: board.conflicts.filter((conflict) =>
      (conflict.visit_id != null && visitIds.has(conflict.visit_id))
      || (conflict.profile_id != null && employeeIds.has(conflict.profile_id))
    ),
    legacy: {
      labour: board.legacy.labour.filter((draft) => employeeIds.has(draft.profile_id)),
      plant: board.legacy.plant.filter((draft) => draft.owner_team_id === teamId),
    },
    resources: {
      ...board.resources,
      employees,
    },
    publications: board.publications.filter((publication) => publication.scope_team_id === teamId),
  };
}

export function visitOverlapsHalfDaySession(
  startMinutes: number,
  endMinutes: number,
  session: 'AM' | 'PM' | null | undefined
): boolean {
  if (session !== 'AM' && session !== 'PM') return false;
  const sessionStart = session === 'AM' ? 0 : DAILY_ALLOCATION_MIDDAY_MINUTES;
  const sessionEnd = session === 'AM' ? DAILY_ALLOCATION_MIDDAY_MINUTES : 24 * 60;
  return startMinutes < sessionEnd && endMinutes > sessionStart;
}

export function evaluateEmployeeAssignmentBlock(
  board: DailyAllocationRangeBoardPayload,
  visit: DailyAllocationVisit,
  profileId: string
): { hard: string } | { warning: DailyAllocationConflictKind } | null {
  const employee = board.resources.employees.find((item) => item.profile_id === profileId);
  const day = employee ? employeeDay(employee, visit.work_date) : null;
  if (day?.availability === 'full_day_absence') {
    return { hard: day.blocking_absence?.reason_name || 'This employee is absent for the full day.' };
  }
  if (day?.availability === 'half_day_absence') {
    const start = getDailyAllocationTimeMinutes(visit.starts_at);
    const end = getDailyAllocationTimeMinutes(visit.ends_at);
    if (visitOverlapsHalfDaySession(start, end, day.blocking_absence?.half_day_session)) {
      return {
        hard: day.blocking_absence?.half_day_session === 'PM'
          ? 'This visit overlaps an approved afternoon absence.'
          : 'This visit overlaps an approved morning absence.',
      };
    }
  }
  const overlap = board.labour_assignments.some((assignment) => (
    assignment.profile_id === profileId
    && assignment.visit_id !== visit.id
    && dailyAllocationIntervalsOverlap(assignment, visit)
  ));
  if (overlap) return { hard: 'This employee already has an overlapping visit.' };
  const hardConflict = board.conflicts.find((conflict) => (
    conflict.profile_id === profileId
    && conflict.work_date === visit.work_date
    && conflict.severity === 'hard'
  ));
  if (hardConflict) return { hard: hardConflict.message };
  if (day?.pending_absence) return { warning: 'pending_absence' };
  if (day && ((getDailyAllocationTimeMinutes(visit.starts_at) < DAILY_ALLOCATION_MIDDAY_MINUTES && !day.am_working)
    || (getDailyAllocationTimeMinutes(visit.ends_at) > DAILY_ALLOCATION_MIDDAY_MINUTES && !day.pm_working))) {
    return { warning: 'off_shift' };
  }
  return null;
}
