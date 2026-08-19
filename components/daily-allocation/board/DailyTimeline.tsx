'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/react';
import { Button } from '@/components/ui/button';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import { DAILY_ALLOCATION_DND } from '@/components/daily-allocation/board/board-dnd';
import type { DailyAllocationJobRow } from '@/components/daily-allocation/board/board-model';
import {
  visitConflicts,
  visitLabour,
  visitPlant,
} from '@/components/daily-allocation/board/board-model';
import { VisitCard } from '@/components/daily-allocation/board/VisitCard';
import { cn } from '@/lib/utils/cn';
import {
  DAILY_ALLOCATION_DEFAULT_END_HOUR,
  DAILY_ALLOCATION_DEFAULT_START_HOUR,
  DAILY_ALLOCATION_MIN_DURATION_MINUTES,
  DAILY_ALLOCATION_SNAP_MINUTES,
  assignDailyAllocationLanes,
  getDailyAllocationTimeMinutes,
  getDailyAllocationTimelineRange,
  toDailyAllocationLondonIsoFromMinutes,
} from '@/lib/utils/daily-allocation-timeline';
import type { DailyAllocationRangeBoardPayload, DailyAllocationVisit } from '@/types/daily-allocation';
import {
  DAILY_TIMELINE_HOUR_WIDTH,
  DAILY_TIMELINE_JOB_COLUMN_WIDTH,
  dailyTimelineFitsContainer,
  dailyTimelineHourWidth,
} from '@/components/daily-allocation/board/daily-timeline-layout';

export { DAILY_TIMELINE_HOUR_WIDTH, DAILY_TIMELINE_JOB_COLUMN_WIDTH };

const LANE_HEIGHT = 112;
const ROW_MIN_HEIGHT = 144;

interface DailyTimelineProps {
  board: DailyAllocationRangeBoardPayload;
  date: string;
  rows: DailyAllocationJobRow[];
  selectedVisitId: string | null;
  labourNames: (visitId: string) => string[];
  plantLabels: (visitId: string) => string[];
  onAddVisit: (jobKey: string, date: string) => void;
  onSelectVisit: (visit: DailyAllocationVisit) => void;
  onEditVisit: (visit: DailyAllocationVisit) => void;
  onDeleteVisit: (visit: DailyAllocationVisit) => void;
  onAssignVisit: (visit: DailyAllocationVisit) => void;
  onResizeVisit: (visit: DailyAllocationVisit, startsAt: string, endsAt: string) => void;
}

function TimelineHeader({
  startHour,
  endHour,
  hourWidth,
  fill,
}: {
  startHour: number;
  endHour: number;
  hourWidth: number;
  fill: boolean;
}) {
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  return (
    <div
      className={cn('sticky top-0 z-10 flex border-b border-slate-700 bg-slate-950', fill && 'w-full')}
      data-testid="daily-allocation-daily-timeline-header"
    >
      <div
        className="shrink-0 border-r border-slate-700 px-3 py-2 text-xs font-semibold uppercase text-slate-400"
        style={{ width: DAILY_TIMELINE_JOB_COLUMN_WIDTH }}
      >
        Job
      </div>
      <div
        className={cn('relative flex min-w-0', fill && 'flex-1')}
        style={fill ? undefined : { width: hours.length * hourWidth }}
      >
        {hours.map((hour) => (
          <div
            key={hour}
            className={cn(
              'border-l border-slate-800 px-1 py-2 text-[11px] tabular-nums text-slate-400',
              fill && 'min-w-0 flex-1'
            )}
            style={fill ? undefined : { width: hourWidth }}
          >
            {String(hour).padStart(2, '0')}:00
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineCell({
  jobKey,
  date,
  width,
  height,
  hourWidth,
  startHour,
  endHour,
  fill,
  children,
}: {
  jobKey: string;
  date: string;
  width: number;
  height: number;
  hourWidth: number;
  startHour: number;
  endHour: number;
  fill: boolean;
  children: ReactNode;
}) {
  const { ref, isDropTarget } = useDroppable({
    id: `timeline:${jobKey}:${date}`,
    type: DAILY_ALLOCATION_DND.timeline,
    accept: [DAILY_ALLOCATION_DND.job, DAILY_ALLOCATION_DND.visit],
    data: {
      target: { surface: 'timeline', workDate: date, jobKey },
      hourWidth,
      startHour,
      endHour,
    },
  });

  return (
    <div
      ref={ref}
      data-testid={`daily-allocation-timeline-${jobKey}-${date}`}
      data-timeline-start={`${String(startHour).padStart(2, '0')}:00`}
      data-timeline-end={`${String(endHour).padStart(2, '0')}:00`}
      className={cn(
        'relative border-l border-slate-800 bg-slate-950/60',
        fill && 'min-w-0 flex-1',
        isDropTarget && 'bg-[hsl(var(--daily-allocation-primary)/0.12)]'
      )}
      style={{
        width: fill ? undefined : width,
        height,
        backgroundImage: 'linear-gradient(to right, rgb(51 65 85) 1px, transparent 1px)',
        backgroundSize: `${hourWidth}px 100%`,
      }}
    >
      {children}
    </div>
  );
}

export function DailyTimeline({
  board,
  date,
  rows,
  selectedVisitId,
  labourNames,
  plantLabels,
  onAddVisit,
  onSelectVisit,
  onEditVisit,
  onDeleteVisit,
  onAssignVisit,
  onResizeVisit,
}: DailyTimelineProps) {
  const visits = board.visits.filter((visit) => visit.work_date === date);
  const range = useMemo(
    () => getDailyAllocationTimelineRange(visits, date),
    [date, visits]
  );
  const startHour = range.startHour || DAILY_ALLOCATION_DEFAULT_START_HOUR;
  const endHour = range.endHour || DAILY_ALLOCATION_DEFAULT_END_HOUR;
  const hourCount = Math.max(1, endHour - startHour);
  const boardRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const fill = dailyTimelineFitsContainer(containerWidth, hourCount);
  const hourWidth = dailyTimelineHourWidth(containerWidth, hourCount);
  const timelineWidth = hourCount * hourWidth;
  const [draftTimes, setDraftTimes] = useState<Record<string, { starts_at: string; ends_at: string }>>({});

  useEffect(() => {
    const board = boardRef.current;
    if (!board || typeof ResizeObserver === 'undefined') return;

    const updateContainerWidth = () => {
      setContainerWidth(board.clientWidth);
    };
    updateContainerWidth();
    const observer = new ResizeObserver(updateContainerWidth);
    observer.observe(board);
    return () => observer.disconnect();
  }, []);

  function displayedVisit(visit: DailyAllocationVisit): DailyAllocationVisit {
    const draft = draftTimes[visit.id];
    return draft ? { ...visit, ...draft } : visit;
  }

  function handleResizePointerDown(
    visit: DailyAllocationVisit,
    edge: 'start' | 'end',
    event: ReactPointerEvent<HTMLButtonElement>
  ) {
    event.preventDefault();
    event.stopPropagation();
    const originX = event.clientX;
    const startMinutes = getDailyAllocationTimeMinutes(visit.starts_at);
    const endMinutes = getDailyAllocationTimeMinutes(visit.ends_at);
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    target.setPointerCapture(pointerId);
    let nextStartsAt = visit.starts_at;
    let nextEndsAt = visit.ends_at;

    function snap(minutes: number) {
      return Math.round(minutes / DAILY_ALLOCATION_SNAP_MINUTES) * DAILY_ALLOCATION_SNAP_MINUTES;
    }

    function onMove(moveEvent: PointerEvent) {
      const deltaHours = (moveEvent.clientX - originX) / hourWidth;
      const deltaMinutes = snap(deltaHours * 60);
      const rangeStart = startHour * 60;
      const rangeEnd = endHour * 60;
      if (edge === 'start') {
        const nextStart = Math.min(
          Math.max(startMinutes + deltaMinutes, rangeStart),
          endMinutes - DAILY_ALLOCATION_MIN_DURATION_MINUTES
        );
        nextStartsAt = toDailyAllocationLondonIsoFromMinutes(date, nextStart);
        nextEndsAt = visit.ends_at;
      } else {
        const nextEnd = Math.max(
          Math.min(endMinutes + deltaMinutes, rangeEnd),
          startMinutes + DAILY_ALLOCATION_MIN_DURATION_MINUTES
        );
        nextStartsAt = visit.starts_at;
        nextEndsAt = toDailyAllocationLondonIsoFromMinutes(date, nextEnd);
      }
      setDraftTimes((current) => ({
        ...current,
        [visit.id]: { starts_at: nextStartsAt, ends_at: nextEndsAt },
      }));
    }

    let finished = false;

    function finish(commit: boolean) {
      if (finished) return;
      finished = true;
      if (target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      setDraftTimes((current) => {
        const next = { ...current };
        delete next[visit.id];
        return next;
      });
      if (commit && (nextStartsAt !== visit.starts_at || nextEndsAt !== visit.ends_at)) {
        onResizeVisit(visit, nextStartsAt, nextEndsAt);
      }
    }

    function onUp() {
      finish(true);
    }

    function onCancel() {
      finish(false);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  return (
    <div
      ref={boardRef}
      className={cn(
        'w-full min-w-0 rounded-lg border border-slate-700',
        fill ? 'overflow-x-hidden' : 'overflow-x-auto'
      )}
      data-testid="daily-allocation-daily-board"
      data-timeline-layout={fill ? 'fit' : 'scroll'}
    >
      <TimelineHeader startHour={startHour} endHour={endHour} hourWidth={hourWidth} fill={fill} />
      {rows.length === 0 ? (
        <div className={cn('flex border-t border-slate-800', fill && 'w-full')}>
          <div
            className="shrink-0 space-y-1 border-r border-slate-700 bg-slate-900 p-3"
            style={{ width: DAILY_TIMELINE_JOB_COLUMN_WIDTH }}
          >
            <p className="text-sm font-semibold text-slate-50">No timed visits</p>
            <p className="text-xs text-slate-400">
              Drag a job from Resources or use Add visit.
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(boardControlStyles.ghost, 'h-8 px-2 text-xs')}
              onClick={() => onAddVisit('', date)}
            >
              + Add timed visit
            </Button>
          </div>
          <TimelineCell
            jobKey=""
            date={date}
            width={timelineWidth}
            height={ROW_MIN_HEIGHT}
            hourWidth={hourWidth}
            startHour={startHour}
            endHour={endHour}
            fill={fill}
          >
            {null}
          </TimelineCell>
        </div>
      ) : rows.map((row) => {
        const dayVisits = row.visits.filter((visit) => visit.work_date === date);
        const { placements, laneCount } = assignDailyAllocationLanes(dayVisits);
        const height = Math.max(ROW_MIN_HEIGHT, laneCount * LANE_HEIGHT + 16);
        return (
          <div key={row.key} className={cn('flex border-t border-slate-800', fill && 'w-full')}>
            <div
              className="shrink-0 space-y-1 border-r border-slate-700 bg-slate-900 p-3"
              style={{ width: DAILY_TIMELINE_JOB_COLUMN_WIDTH }}
            >
              <p className="truncate text-sm font-semibold text-slate-50">{row.job.job_code}</p>
              <p className="truncate text-xs text-slate-300">{row.job.title || row.job.customer_name || 'Catalogue job'}</p>
              <p className="truncate text-[11px] text-slate-400">{row.job.site_address}</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn(boardControlStyles.ghost, 'h-8 px-2 text-xs')}
                onClick={() => onAddVisit(row.key, date)}
              >
                + Add timed visit
              </Button>
            </div>
            <TimelineCell
              jobKey={row.key}
              date={date}
              width={timelineWidth}
              height={height}
              hourWidth={hourWidth}
              startHour={startHour}
              endHour={endHour}
              fill={fill}
            >
              {placements.map(({ item: visit, lane }) => {
                const shown = displayedVisit(visit);
                const startMinutes = Math.max(startHour * 60, getDailyAllocationTimeMinutes(shown.starts_at));
                const endMinutes = Math.min(endHour * 60, getDailyAllocationTimeMinutes(shown.ends_at));
                const left = ((startMinutes - startHour * 60) / 60) * hourWidth + 4;
                const width = Math.max(
                  48,
                  ((Math.max(endMinutes, startMinutes + 30) - startMinutes) / 60) * hourWidth - 8
                );
                return (
                  <VisitCard
                    key={visit.id}
                    visit={shown}
                    title={row.job.title || row.job.job_code}
                    labour={visitLabour(board, visit.id)}
                    plant={visitPlant(board, visit.id)}
                    labourNames={labourNames(visit.id)}
                    plantLabels={plantLabels(visit.id)}
                    conflicts={visitConflicts(board, visit.id)}
                    selected={selectedVisitId === visit.id}
                    style={{ left, width, top: 8 + lane * LANE_HEIGHT, height: LANE_HEIGHT - 12 }}
                    onSelect={() => onSelectVisit(visit)}
                    onEdit={() => onEditVisit(visit)}
                    onDelete={() => onDeleteVisit(visit)}
                    onAssign={() => onAssignVisit(visit)}
                    onResizePointerDown={(edge, event) => handleResizePointerDown(visit, edge, event)}
                  />
                );
              })}
            </TimelineCell>
          </div>
        );
      })}
    </div>
  );
}
