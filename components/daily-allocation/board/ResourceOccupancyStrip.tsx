'use client';

import { cn } from '@/lib/utils/cn';
import {
  DAILY_ALLOCATION_OCCUPANCY_END_MINUTES,
  DAILY_ALLOCATION_OCCUPANCY_START_MINUTES,
  type DailyAllocationOccupancySegment,
  type DailyAllocationOccupancyState,
} from '@/components/daily-allocation/board/daily-allocation-occupancy';

const stateClass: Record<DailyAllocationOccupancyState, string> = {
  available: 'bg-emerald-400',
  booked: 'bg-rose-500',
  unavailable: 'bg-amber-400',
};

const duration = DAILY_ALLOCATION_OCCUPANCY_END_MINUTES - DAILY_ALLOCATION_OCCUPANCY_START_MINUTES;

export function ResourceOccupancyStrip({
  segments,
  label,
}: {
  segments: DailyAllocationOccupancySegment[];
  label: string;
}) {
  return (
    <span
      className="pointer-events-none absolute inset-x-1 bottom-0 h-1 overflow-hidden rounded-full bg-slate-950/70"
      role="img"
      aria-label={label}
    >
      {segments.map((segment) => (
        <span
          key={`${segment.startMinutes}:${segment.endMinutes}:${segment.state}`}
          data-occupancy-state={segment.state}
          className={cn('absolute inset-y-0', stateClass[segment.state])}
          style={{
            left: `${((segment.startMinutes - DAILY_ALLOCATION_OCCUPANCY_START_MINUTES) / duration) * 100}%`,
            width: `${((segment.endMinutes - segment.startMinutes) / duration) * 100}%`,
          }}
        />
      ))}
    </span>
  );
}

export function ResourceOccupancyLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
      {([
        ['available', 'Available'],
        ['booked', 'Booked'],
        ['unavailable', 'Absent / off-shift'],
      ] as const).map(([state, label]) => (
        <span key={state} className="flex items-center gap-1">
          <span className={cn('h-1.5 w-1.5 rounded-full', stateClass[state])} aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
  );
}
