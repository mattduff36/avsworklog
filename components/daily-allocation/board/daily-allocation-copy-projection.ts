import { isOptimisticEntityId } from '@/components/daily-allocation/board/daily-allocation-optimistic-ledger';
import {
  getDailyAllocationTimeMinutes,
  toDailyAllocationLondonIsoFromMinutes,
} from '@/lib/utils/daily-allocation-timeline';
import type {
  DailyAllocationLabourAssignment,
  DailyAllocationPlanDay,
  DailyAllocationPlantAssignment,
  DailyAllocationRangeBoardPayload,
  DailyAllocationVisit,
} from '@/types/daily-allocation';

export interface DailyAllocationCopyProjectionResult {
  source_date: string;
  target_date: string;
  additions: Array<{ label: string; detail: string }>;
}

const VISIT_ADDITION = 'Visit';
const LABOUR_ADDITION = 'Employee included with the copied visit';
const PLANT_ADDITION = 'Plant included with the copied visit';

export interface CopiedAllocationProjection {
  planDay: DailyAllocationPlanDay | null;
  sourceVisits: DailyAllocationVisit[];
  visits: DailyAllocationVisit[];
  labour: DailyAllocationLabourAssignment[];
  plant: DailyAllocationPlantAssignment[];
}

function shiftClock(value: string, targetDate: string): string {
  return toDailyAllocationLondonIsoFromMinutes(targetDate, getDailyAllocationTimeMinutes(value));
}

function additionCount(
  additions: DailyAllocationCopyProjectionResult['additions'],
  jobCode: string,
  detail: string
): number {
  return additions.filter((item) => item.label === jobCode && item.detail === detail).length;
}

export function buildCopiedAllocationProjection(input: {
  board: DailyAllocationRangeBoardPayload;
  result: DailyAllocationCopyProjectionResult;
  createId: () => string;
  now?: string;
}): CopiedAllocationProjection {
  const now = input.now || new Date().toISOString();
  const sourceVisits = input.board.visits.filter((visit) => visit.work_date === input.result.source_date);
  const used = new Set<string>();
  const chosen: DailyAllocationVisit[] = [];
  for (const addition of input.result.additions) {
    if (addition.detail !== VISIT_ADDITION) continue;
    const match = sourceVisits.find((visit) => visit.job_code === addition.label && !used.has(visit.id));
    if (!match) continue;
    used.add(match.id);
    chosen.push(match);
  }
  const duplicateJobCodes = new Set(
    chosen
      .map((visit) => visit.job_code)
      .filter((jobCode, index, codes) => codes.indexOf(jobCode) !== index)
  );
  const existingPlan = input.board.plan_days.find((planDay) => (
    planDay.work_date === input.result.target_date
    && chosen.some((visit) => visit.owner_team_id === planDay.team_id)
  ));
  const planDayId = existingPlan?.id || (chosen.length > 0 ? input.createId() : '');
  const planDay = !existingPlan && chosen[0]
    ? {
        id: planDayId,
        work_date: input.result.target_date,
        team_id: chosen[0].owner_team_id,
        plan_version: 1,
        converted_at: now,
        converted_by: input.board.context.user_id,
        updated_at: now,
      }
    : null;

  const visits: DailyAllocationVisit[] = [];
  const labour: DailyAllocationLabourAssignment[] = [];
  const plant: DailyAllocationPlantAssignment[] = [];
  for (const source of chosen) {
    const visitId = input.createId();
    visits.push({
      ...source,
      id: visitId,
      plan_day_id: planDayId,
      work_date: input.result.target_date,
      starts_at: shiftClock(source.starts_at, input.result.target_date),
      ends_at: shiftClock(source.ends_at, input.result.target_date),
      row_version: 1,
      updated_at: now,
    });
    if (duplicateJobCodes.has(source.job_code)) continue;
    const sourceLabour = input.board.labour_assignments.filter((assignment) => assignment.visit_id === source.id);
    if (additionCount(input.result.additions, source.job_code, LABOUR_ADDITION) === sourceLabour.length) {
      for (const assignment of sourceLabour) {
        labour.push({
          ...assignment,
          id: input.createId(),
          visit_id: visitId,
          plan_day_id: planDayId,
          work_date: input.result.target_date,
          starts_at: shiftClock(assignment.starts_at, input.result.target_date),
          ends_at: shiftClock(assignment.ends_at, input.result.target_date),
          row_version: 1,
          updated_at: now,
        });
      }
    }
    const sourcePlant = input.board.plant_assignments.filter((assignment) => assignment.visit_id === source.id);
    if (additionCount(input.result.additions, source.job_code, PLANT_ADDITION) === sourcePlant.length) {
      for (const assignment of sourcePlant) {
        plant.push({
          ...assignment,
          id: input.createId(),
          visit_id: visitId,
          plan_day_id: planDayId,
          work_date: input.result.target_date,
          starts_at: shiftClock(assignment.starts_at, input.result.target_date),
          ends_at: shiftClock(assignment.ends_at, input.result.target_date),
          row_version: 1,
          updated_at: now,
        });
      }
    }
  }

  return { planDay, sourceVisits: chosen, visits, labour, plant };
}

export function applyCopiedAllocationProjection(
  board: DailyAllocationRangeBoardPayload,
  projection: CopiedAllocationProjection
): DailyAllocationRangeBoardPayload {
  const visitIds = new Set(projection.visits.map((visit) => visit.id));
  const labourIds = new Set(projection.labour.map((assignment) => assignment.id));
  const plantIds = new Set(projection.plant.map((assignment) => assignment.id));
  return {
    ...board,
    plan_days: projection.planDay
      ? [...board.plan_days.filter((planDay) => planDay.id !== projection.planDay?.id), projection.planDay]
      : board.plan_days,
    visits: [...board.visits.filter((visit) => !visitIds.has(visit.id)), ...projection.visits],
    labour_assignments: [
      ...board.labour_assignments.filter((assignment) => !labourIds.has(assignment.id)),
      ...projection.labour,
    ],
    plant_assignments: [
      ...board.plant_assignments.filter((assignment) => !plantIds.has(assignment.id)),
      ...projection.plant,
    ],
  };
}

export function copiedAllocationProjectionProven(
  board: DailyAllocationRangeBoardPayload | undefined,
  result: DailyAllocationCopyProjectionResult,
  sourceVisits: DailyAllocationVisit[]
): boolean {
  if (!board || sourceVisits.length === 0) return sourceVisits.length === 0;
  return sourceVisits.every((source) => board.visits.some((visit) => (
    visit.work_date === result.target_date
    && visit.job_source_type === source.job_source_type
    && visit.job_source_id === source.job_source_id
    && !isOptimisticEntityId(visit.id)
  )));
}
