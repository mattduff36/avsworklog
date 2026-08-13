import type {
  DailyAllocationConflictOverride,
  DailyAllocationLabourAssignment,
  DailyAllocationPlanDay,
  DailyAllocationPlantAssignment,
  DailyAllocationPublicationMeta,
  DailyAllocationRangeBoardPayload,
  DailyAllocationVisit,
} from '@/types/daily-allocation';
import type { DailyAllocationBoardView } from '@/lib/config/daily-allocation-view-preference';
import { getDailyAllocationWeekRange } from '@/lib/utils/daily-allocation-timeline';

export function snapshotDailyAllocationBoard(
  board: DailyAllocationRangeBoardPayload | undefined
): DailyAllocationRangeBoardPayload | undefined {
  if (!board) return undefined;
  return structuredClone(board);
}

function sortByStartsAt<T extends { starts_at: string; id: string }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    left.starts_at.localeCompare(right.starts_at) || left.id.localeCompare(right.id)
  );
}

function bumpPlanDayVersion(
  planDays: DailyAllocationPlanDay[],
  planDayId: string
): DailyAllocationPlanDay[] {
  return planDays.map((planDay) =>
    planDay.id === planDayId
      ? { ...planDay, plan_version: planDay.plan_version + 1 }
      : planDay
  );
}

export function patchBoardPlanVersion(
  board: DailyAllocationRangeBoardPayload,
  planDayId: string,
  planVersion: number
): DailyAllocationRangeBoardPayload {
  return {
    ...board,
    plan_days: board.plan_days.map((planDay) =>
      planDay.id === planDayId
        ? { ...planDay, plan_version: planVersion }
        : planDay
    ),
  };
}

export function patchBoardWithPlanDay(
  board: DailyAllocationRangeBoardPayload,
  planDay: DailyAllocationPlanDay,
  replaceId?: string
): DailyAllocationRangeBoardPayload {
  const planDays = board.plan_days.filter(
    (item) => item.id !== planDay.id && item.id !== replaceId
  );
  return {
    ...board,
    plan_days: [...planDays, planDay].sort((left, right) =>
      left.work_date.localeCompare(right.work_date) || left.id.localeCompare(right.id)
    ),
  };
}

function syncAssignmentsToVisit<T extends DailyAllocationLabourAssignment | DailyAllocationPlantAssignment>(
  assignments: T[],
  visit: DailyAllocationVisit,
  replaceVisitId?: string
): T[] {
  return assignments.map((assignment) => {
    if (assignment.visit_id !== visit.id && assignment.visit_id !== replaceVisitId) {
      return assignment;
    }
    return {
      ...assignment,
      visit_id: visit.id,
      plan_day_id: visit.plan_day_id,
      work_date: visit.work_date,
      starts_at: visit.starts_at,
      ends_at: visit.ends_at,
    };
  });
}

export function patchBoardWithVisit(
  board: DailyAllocationRangeBoardPayload,
  visit: DailyAllocationVisit,
  replaceId?: string
): DailyAllocationRangeBoardPayload {
  const visits = board.visits.filter((item) => item.id !== visit.id && item.id !== replaceId);
  return {
    ...board,
    visits: sortByStartsAt([...visits, visit]),
    labour_assignments: syncAssignmentsToVisit(board.labour_assignments, visit, replaceId),
    plant_assignments: syncAssignmentsToVisit(board.plant_assignments, visit, replaceId),
    overrides: board.overrides.map((override) =>
      replaceId && override.visit_id === replaceId
        ? { ...override, visit_id: visit.id }
        : override
    ),
    plan_days: replaceId
      ? board.plan_days
      : bumpPlanDayVersion(board.plan_days, visit.plan_day_id),
  };
}

export function patchBoardRemoveVisit(
  board: DailyAllocationRangeBoardPayload,
  visitId: string
): DailyAllocationRangeBoardPayload {
  const removed = board.visits.find((visit) => visit.id === visitId);
  return {
    ...board,
    visits: board.visits.filter((visit) => visit.id !== visitId),
    labour_assignments: board.labour_assignments.filter(
      (assignment) => assignment.visit_id !== visitId
    ),
    plant_assignments: board.plant_assignments.filter(
      (assignment) => assignment.visit_id !== visitId
    ),
    overrides: board.overrides.filter((override) => override.visit_id !== visitId),
    plan_days: removed
      ? bumpPlanDayVersion(board.plan_days, removed.plan_day_id)
      : board.plan_days,
  };
}

export function patchBoardWithLabourAssignment(
  board: DailyAllocationRangeBoardPayload,
  assignment: DailyAllocationLabourAssignment,
  replaceId?: string
): DailyAllocationRangeBoardPayload {
  const labour = board.labour_assignments.filter(
    (item) => item.id !== assignment.id && item.id !== replaceId
  );
  return {
    ...board,
    labour_assignments: sortByStartsAt([...labour, assignment]),
    plan_days: replaceId
      ? board.plan_days
      : bumpPlanDayVersion(board.plan_days, assignment.plan_day_id),
  };
}

export function patchBoardRemoveLabourAssignment(
  board: DailyAllocationRangeBoardPayload,
  assignmentId: string
): DailyAllocationRangeBoardPayload {
  const removed = board.labour_assignments.find((item) => item.id === assignmentId);
  return {
    ...board,
    labour_assignments: board.labour_assignments.filter((item) => item.id !== assignmentId),
    plan_days: removed
      ? bumpPlanDayVersion(board.plan_days, removed.plan_day_id)
      : board.plan_days,
  };
}

export function patchBoardWithPlantAssignment(
  board: DailyAllocationRangeBoardPayload,
  assignment: DailyAllocationPlantAssignment,
  replaceId?: string
): DailyAllocationRangeBoardPayload {
  const plant = board.plant_assignments.filter(
    (item) => item.id !== assignment.id && item.id !== replaceId
  );
  return {
    ...board,
    plant_assignments: sortByStartsAt([...plant, assignment]),
    plan_days: replaceId
      ? board.plan_days
      : bumpPlanDayVersion(board.plan_days, assignment.plan_day_id),
  };
}

export function patchBoardRemovePlantAssignment(
  board: DailyAllocationRangeBoardPayload,
  assignmentId: string
): DailyAllocationRangeBoardPayload {
  const removed = board.plant_assignments.find((item) => item.id === assignmentId);
  return {
    ...board,
    plant_assignments: board.plant_assignments.filter((item) => item.id !== assignmentId),
    plan_days: removed
      ? bumpPlanDayVersion(board.plan_days, removed.plan_day_id)
      : board.plan_days,
  };
}

export function patchBoardWithOverride(
  board: DailyAllocationRangeBoardPayload,
  override: DailyAllocationConflictOverride,
  replaceId?: string
): DailyAllocationRangeBoardPayload {
  const overrides = board.overrides.filter(
    (item) => item.id !== override.id && item.id !== replaceId
  );
  return {
    ...board,
    overrides: [...overrides, override],
    plan_days: replaceId
      ? board.plan_days
      : bumpPlanDayVersion(board.plan_days, override.plan_day_id),
  };
}

export function patchBoardWithPublication(
  board: DailyAllocationRangeBoardPayload,
  publication: DailyAllocationPublicationMeta,
  replaceId?: string
): DailyAllocationRangeBoardPayload {
  const publications = board.publications.filter(
    (item) => item.id !== publication.id && item.id !== replaceId
  );
  return {
    ...board,
    publications: [...publications, publication].sort((left, right) =>
      left.published_at.localeCompare(right.published_at)
      || left.revision_no - right.revision_no
    ),
  };
}

function datesForView(
  board: DailyAllocationRangeBoardPayload,
  view: DailyAllocationBoardView,
  selectedDate: string
): string[] {
  if (view === 'daily') return [selectedDate];
  const week = getDailyAllocationWeekRange(selectedDate);
  const weekDates = board.dates.filter((date) => date >= week.start && date <= week.end);
  return weekDates.length > 0 ? weekDates : board.dates;
}

export function filterDailyAllocationBoardToDates(
  board: DailyAllocationRangeBoardPayload,
  dates: readonly string[]
): DailyAllocationRangeBoardPayload {
  const dateSet = new Set(dates);
  const planDayIds = new Set(
    board.plan_days.filter((planDay) => dateSet.has(planDay.work_date)).map((planDay) => planDay.id)
  );
  const visitIds = new Set(
    board.visits.filter((visit) => dateSet.has(visit.work_date)).map((visit) => visit.id)
  );

  return {
    ...board,
    start_date: dates[0] ?? board.start_date,
    end_date: dates[dates.length - 1] ?? board.end_date,
    dates: board.dates.filter((date) => dateSet.has(date)),
    plan_days: board.plan_days.filter((planDay) => dateSet.has(planDay.work_date)),
    visits: board.visits.filter((visit) => dateSet.has(visit.work_date)),
    labour_assignments: board.labour_assignments.filter((assignment) =>
      dateSet.has(assignment.work_date)
    ),
    plant_assignments: board.plant_assignments.filter((assignment) =>
      dateSet.has(assignment.work_date)
    ),
    overrides: board.overrides.filter((override) => {
      if (override.visit_id) return visitIds.has(override.visit_id);
      return planDayIds.has(override.plan_day_id);
    }),
    conflicts: board.conflicts.filter((conflict) => dateSet.has(conflict.work_date)),
    publications: board.publications.filter((publication) => dateSet.has(publication.work_date)),
    legacy: {
      labour: board.legacy.labour.filter((draft) => dateSet.has(draft.work_date)),
      plant: board.legacy.plant.filter((draft) => dateSet.has(draft.work_date)),
    },
  };
}

export function projectDailyAllocationBoardView(
  board: DailyAllocationRangeBoardPayload,
  view: DailyAllocationBoardView,
  selectedDate: string
): DailyAllocationRangeBoardPayload {
  return filterDailyAllocationBoardToDates(board, datesForView(board, view, selectedDate));
}

export function collectDailyAllocationEntityIds(
  board: DailyAllocationRangeBoardPayload
): {
  planDays: string[];
  visits: string[];
  labour: string[];
  plant: string[];
  overrides: string[];
  publications: string[];
} {
  return {
    planDays: board.plan_days.map((item) => item.id),
    visits: board.visits.map((item) => item.id),
    labour: board.labour_assignments.map((item) => item.id),
    plant: board.plant_assignments.map((item) => item.id),
    overrides: board.overrides.map((item) => item.id),
    publications: board.publications.map((item) => item.id),
  };
}
