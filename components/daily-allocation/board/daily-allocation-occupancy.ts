import { getDailyAllocationTimeMinutes } from '@/lib/utils/daily-allocation-timeline';
import type {
  DailyAllocationEmployeeDayAvailability,
  DailyAllocationLabourAssignment,
  DailyAllocationPlantAssignment,
} from '@/types/daily-allocation';

export const DAILY_ALLOCATION_OCCUPANCY_START_MINUTES = 5 * 60;
export const DAILY_ALLOCATION_OCCUPANCY_END_MINUTES = 20 * 60;
const MIDDAY_MINUTES = 12 * 60;

export type DailyAllocationOccupancyState = 'available' | 'booked' | 'unavailable';

export interface DailyAllocationOccupancySegment {
  startMinutes: number;
  endMinutes: number;
  state: DailyAllocationOccupancyState;
}

function mergeAdjacent(
  segments: DailyAllocationOccupancySegment[]
): DailyAllocationOccupancySegment[] {
  const merged: DailyAllocationOccupancySegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (previous && previous.state === segment.state && previous.endMinutes === segment.startMinutes) {
      previous.endMinutes = segment.endMinutes;
    } else if (segment.endMinutes > segment.startMinutes) {
      merged.push({ ...segment });
    }
  }
  return merged;
}

function overlay(
  segments: DailyAllocationOccupancySegment[],
  startMinutes: number,
  endMinutes: number,
  state: DailyAllocationOccupancyState
): DailyAllocationOccupancySegment[] {
  const start = Math.max(DAILY_ALLOCATION_OCCUPANCY_START_MINUTES, startMinutes);
  const end = Math.min(DAILY_ALLOCATION_OCCUPANCY_END_MINUTES, endMinutes);
  if (end <= start) return segments;
  const next: DailyAllocationOccupancySegment[] = [];
  for (const segment of segments) {
    if (segment.endMinutes <= start || segment.startMinutes >= end) {
      next.push(segment);
      continue;
    }
    if (segment.startMinutes < start) {
      next.push({ ...segment, endMinutes: start });
    }
    next.push({
      startMinutes: Math.max(segment.startMinutes, start),
      endMinutes: Math.min(segment.endMinutes, end),
      state,
    });
    if (segment.endMinutes > end) {
      next.push({ ...segment, startMinutes: end });
    }
  }
  return mergeAdjacent(next);
}

function availableDay(): DailyAllocationOccupancySegment[] {
  return [{
    startMinutes: DAILY_ALLOCATION_OCCUPANCY_START_MINUTES,
    endMinutes: DAILY_ALLOCATION_OCCUPANCY_END_MINUTES,
    state: 'available',
  }];
}

function overlayAssignments<T extends { starts_at: string; ends_at: string }>(
  segments: DailyAllocationOccupancySegment[],
  assignments: T[]
): DailyAllocationOccupancySegment[] {
  return assignments.reduce(
    (current, assignment) => overlay(
      current,
      getDailyAllocationTimeMinutes(assignment.starts_at),
      getDailyAllocationTimeMinutes(assignment.ends_at),
      'booked'
    ),
    segments
  );
}

export function buildDailyAllocationEmployeeOccupancy(input: {
  day: DailyAllocationEmployeeDayAvailability | null;
  assignments: DailyAllocationLabourAssignment[];
}): DailyAllocationOccupancySegment[] {
  let segments = availableDay();
  if (input.day?.availability === 'full_day_absence') {
    segments = overlay(
      segments,
      DAILY_ALLOCATION_OCCUPANCY_START_MINUTES,
      DAILY_ALLOCATION_OCCUPANCY_END_MINUTES,
      'unavailable'
    );
  } else {
    if (input.day && !input.day.am_working) {
      segments = overlay(segments, DAILY_ALLOCATION_OCCUPANCY_START_MINUTES, MIDDAY_MINUTES, 'unavailable');
    }
    if (input.day && !input.day.pm_working) {
      segments = overlay(segments, MIDDAY_MINUTES, DAILY_ALLOCATION_OCCUPANCY_END_MINUTES, 'unavailable');
    }
  }
  return overlayAssignments(segments, input.assignments);
}

export function buildDailyAllocationPlantOccupancy(
  assignments: DailyAllocationPlantAssignment[]
): DailyAllocationOccupancySegment[] {
  return overlayAssignments(availableDay(), assignments);
}

export function formatDailyAllocationOccupancySummary(
  segments: DailyAllocationOccupancySegment[]
): string {
  const clock = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const booked = segments.filter((segment) => segment.state === 'booked');
  if (booked.length > 0) {
    return `Booked ${booked.map((segment) => `${clock(segment.startMinutes)}–${clock(segment.endMinutes)}`).join(', ')}`;
  }
  const unavailable = segments.filter((segment) => segment.state === 'unavailable');
  if (unavailable.length > 0) {
    return `Unavailable ${unavailable.map((segment) => `${clock(segment.startMinutes)}–${clock(segment.endMinutes)}`).join(', ')}`;
  }
  return 'Available 05:00–20:00';
}
