import type { InspectionStatus } from '@/types/inspection';

export const VAN_INSPECTION_DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export interface VanInspectionDayRow {
  inspection_id: string;
  day_of_week: number | null;
}

export interface VanInspectionOverlapCandidate {
  id: string;
  status: 'draft' | 'submitted';
  days: number[];
  updated_at?: string | null;
  created_at?: string | null;
}

export interface VanInspectionOverlapConflict {
  id: string;
  status: 'draft' | 'submitted';
  overlappingDays: number[];
  inspectionDays: number[];
  conflictCount: number;
}

function normalizeDays(days: number[]): number[] {
  return Array.from(
    new Set(
      days.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    )
  ).sort((left, right) => left - right);
}

export function getStartedVanInspectionDays(
  checkboxStates: Record<string, InspectionStatus | undefined>
): number[] {
  const days: number[] = [];

  Object.entries(checkboxStates).forEach(([key, status]) => {
    if (!status) return;
    const [dayValue] = key.split('-');
    const day = Number(dayValue);
    if (Number.isInteger(day)) {
      days.push(day);
    }
  });

  return normalizeDays(days);
}

export function getInspectionDaysFromRows(rows: VanInspectionDayRow[]): Map<string, number[]> {
  const daysByInspection = new Map<string, number[]>();

  rows.forEach((row) => {
    if (!row.inspection_id || row.day_of_week === null) return;
    const existing = daysByInspection.get(row.inspection_id) || [];
    existing.push(row.day_of_week);
    daysByInspection.set(row.inspection_id, existing);
  });

  for (const [inspectionId, days] of daysByInspection.entries()) {
    daysByInspection.set(inspectionId, normalizeDays(days));
  }

  return daysByInspection;
}

export function findVanInspectionOverlap(
  currentDays: number[],
  candidates: VanInspectionOverlapCandidate[]
): VanInspectionOverlapConflict | null {
  const normalizedCurrentDays = normalizeDays(currentDays);
  if (normalizedCurrentDays.length === 0) return null;

  const currentDaySet = new Set(normalizedCurrentDays);
  const overlapping = candidates
    .map((candidate) => {
      const inspectionDays = normalizeDays(candidate.days);
      const overlappingDays = inspectionDays.filter((day) => currentDaySet.has(day));

      return {
        ...candidate,
        inspectionDays,
        overlappingDays,
      };
    })
    .filter((candidate) => candidate.overlappingDays.length > 0)
    .sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === 'submitted' ? -1 : 1;
      }

      const leftUpdated = new Date(left.updated_at || left.created_at || 0).getTime();
      const rightUpdated = new Date(right.updated_at || right.created_at || 0).getTime();
      return rightUpdated - leftUpdated;
    });

  if (overlapping.length === 0) return null;

  const first = overlapping[0];
  return {
    id: first.id,
    status: first.status,
    overlappingDays: first.overlappingDays,
    inspectionDays: first.inspectionDays,
    conflictCount: overlapping.length,
  };
}

export function formatVanInspectionDayList(days: number[]): string {
  return normalizeDays(days)
    .map((day) => VAN_INSPECTION_DAY_NAMES[day - 1] || `Day ${day}`)
    .join(', ');
}
