'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useDroppable } from '@dnd-kit/react';
import { Button } from '@/components/ui/button';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import { DAILY_ALLOCATION_DND, jobResourceKey } from '@/components/daily-allocation/board/board-dnd';
import type { DailyAllocationBoardRow } from '@/components/daily-allocation/board/daily-allocation-board-primary';
import { getDailyAllocationBoardAxisLabel, getDailyAllocationBoardRowTestId } from '@/components/daily-allocation/board/daily-allocation-board-primary';
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
import type { DailyAllocationBoardPrimary } from '@/lib/config/daily-allocation-primary-preference';
import type { DailyAllocationTimelineMode } from '@/components/daily-allocation/board/JobsPanel';
import {
  DAILY_TIMELINE_HOUR_WIDTH,
  DAILY_TIMELINE_JOB_COLUMN_WIDTH,
  dailyTimelineFitsContainer,
  dailyTimelineHourWidth,
} from '@/components/daily-allocation/board/daily-timeline-layout';
import { getDailyAllocationElementVisualScale } from '@/components/daily-allocation/board/daily-allocation-viewport-fit';

export { DAILY_TIMELINE_HOUR_WIDTH, DAILY_TIMELINE_JOB_COLUMN_WIDTH };

const LANE_HEIGHT = 112;
const ROW_MIN_HEIGHT = 144;
const PAN_THRESHOLD_PX = 4;

interface DailyTimelineProps {
  board: DailyAllocationRangeBoardPayload;
  date: string;
  rows: DailyAllocationBoardRow[];
  primary: DailyAllocationBoardPrimary;
  mode: DailyAllocationTimelineMode;
  selectedVisitId: string | null;
  labourNames: (visitId: string) => string[];
  plantLabels: (visitId: string) => string[];
  onAddVisit: (jobKey: string, date: string) => void;
  onSelectVisit: (visit: DailyAllocationVisit) => void;
  onMoveVisit: (visit: DailyAllocationVisit) => void;
  onEditVisit: (visit: DailyAllocationVisit) => void;
  onDeleteVisit: (visit: DailyAllocationVisit) => void;
  onAssignVisit: (visit: DailyAllocationVisit) => void;
  onResizeVisit: (visit: DailyAllocationVisit, startsAt: string, endsAt: string) => void;
  onPointerInteractionChange?: (active: boolean) => void;
}

function TimelineHeader({
  axisLabel,
  startHour,
  endHour,
  hourWidth,
  fill,
}: {
  axisLabel: string;
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
        {axisLabel}
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
  primary,
  mode,
  selectedVisitId,
  labourNames,
  plantLabels,
  onAddVisit,
  onSelectVisit,
  onMoveVisit,
  onEditVisit,
  onDeleteVisit,
  onAssignVisit,
  onResizeVisit,
  onPointerInteractionChange,
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
  const fitEligible = dailyTimelineFitsContainer(containerWidth, hourCount);
  const fill = mode === 'fit' && fitEligible;
  const hourWidth = fill
    ? dailyTimelineHourWidth(containerWidth, hourCount)
    : DAILY_TIMELINE_HOUR_WIDTH;
  const timelineWidth = hourCount * hourWidth;
  const [draftTimes, setDraftTimes] = useState<Record<string, { starts_at: string; ends_at: string }>>({});
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef<{
    pointerId: number;
    originX: number;
    originScrollLeft: number;
    moved: boolean;
  } | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

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

  useEffect(() => {
    function recoverPointerInteraction(event: Event) {
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      panRef.current = null;
      setIsPanning(false);
      resizeCleanupRef.current?.();
      resizeCleanupRef.current = null;
      onPointerInteractionChange?.(false);
    }
    window.addEventListener('pointercancel', recoverPointerInteraction);
    window.addEventListener('blur', recoverPointerInteraction);
    window.addEventListener('keydown', recoverPointerInteraction);
    return () => {
      window.removeEventListener('pointercancel', recoverPointerInteraction);
      window.removeEventListener('blur', recoverPointerInteraction);
      window.removeEventListener('keydown', recoverPointerInteraction);
      resizeCleanupRef.current?.();
    };
  }, [onPointerInteractionChange]);

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
    onPointerInteractionChange?.(true);
    const originX = event.clientX;
    const startMinutes = getDailyAllocationTimeMinutes(visit.starts_at);
    const endMinutes = getDailyAllocationTimeMinutes(visit.ends_at);
    const pointerId = event.pointerId;
    const target = event.currentTarget;
    const visualHourWidth = hourWidth * getDailyAllocationElementVisualScale(boardRef.current || target);
    target.setPointerCapture(pointerId);
    let nextStartsAt = visit.starts_at;
    let nextEndsAt = visit.ends_at;

    function snap(minutes: number) {
      return Math.round(minutes / DAILY_ALLOCATION_SNAP_MINUTES) * DAILY_ALLOCATION_SNAP_MINUTES;
    }

    function onMove(moveEvent: PointerEvent) {
      const deltaHours = (moveEvent.clientX - originX) / visualHourWidth;
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
      onPointerInteractionChange?.(false);
      resizeCleanupRef.current = null;
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
    resizeCleanupRef.current = () => finish(false);
  }

  function resizeByKeyboard(
    visit: DailyAllocationVisit,
    edge: 'start' | 'end',
    event: ReactKeyboardEvent<HTMLButtonElement>
  ) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const delta = event.key === 'ArrowLeft' ? -DAILY_ALLOCATION_SNAP_MINUTES : DAILY_ALLOCATION_SNAP_MINUTES;
    const start = getDailyAllocationTimeMinutes(visit.starts_at);
    const end = getDailyAllocationTimeMinutes(visit.ends_at);
    const rangeStart = startHour * 60;
    const rangeEnd = endHour * 60;
    const nextStart = edge === 'start'
      ? Math.min(Math.max(start + delta, rangeStart), end - DAILY_ALLOCATION_MIN_DURATION_MINUTES)
      : start;
    const nextEnd = edge === 'end'
      ? Math.max(Math.min(end + delta, rangeEnd), start + DAILY_ALLOCATION_MIN_DURATION_MINUTES)
      : end;
    if (nextStart === start && nextEnd === end) return;
    onPointerInteractionChange?.(true);
    onResizeVisit(
      visit,
      toDailyAllocationLondonIsoFromMinutes(date, nextStart),
      toDailyAllocationLondonIsoFromMinutes(date, nextEnd)
    );
    queueMicrotask(() => onPointerInteractionChange?.(false));
  }

  function isPanBlocked(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(
      target.closest('button, a, input, textarea, select, [role="button"], [data-daily-allocation-visit-card]')
    );
  }

  function handlePanPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (mode !== 'scroll' || event.pointerType === 'touch' || event.button !== 0 || isPanBlocked(event.target)) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originScrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
    onPointerInteractionChange?.(true);
  }

  function handlePanPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const delta = event.clientX - pan.originX;
    if (!pan.moved && Math.abs(delta) < PAN_THRESHOLD_PX) return;
    pan.moved = true;
    setIsPanning(true);
    event.currentTarget.scrollLeft = pan.originScrollLeft
      - delta / getDailyAllocationElementVisualScale(event.currentTarget);
  }

  function finishPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onPointerInteractionChange?.(false);
  }

  return (
    <div
      ref={boardRef}
      className={cn(
        'w-full min-w-0 rounded-lg border border-slate-700',
        fill ? 'overflow-x-hidden' : 'overflow-x-auto',
        mode === 'scroll' && 'cursor-grab select-none',
        isPanning && 'cursor-grabbing'
      )}
      data-testid="daily-allocation-daily-board"
      data-timeline-layout={fill ? 'fit' : 'scroll'}
      data-fit-eligible={String(fitEligible)}
      onPointerDown={handlePanPointerDown}
      onPointerMove={handlePanPointerMove}
      onPointerUp={finishPan}
      onPointerCancel={finishPan}
      onLostPointerCapture={finishPan}
    >
      <TimelineHeader
        axisLabel={getDailyAllocationBoardAxisLabel(primary)}
        startHour={startHour}
        endHour={endHour}
        hourWidth={hourWidth}
        fill={fill}
      />
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
        const dayVisits = row.visitsByDate[date] || [];
        const { placements, laneCount } = assignDailyAllocationLanes(dayVisits);
        const height = Math.max(ROW_MIN_HEIGHT, laneCount * LANE_HEIGHT + 16);
        return (
          <div
            key={row.id}
            className={cn('flex border-t border-slate-800', fill && 'w-full')}
            data-testid={getDailyAllocationBoardRowTestId(row)}
          >
            <div
              className="shrink-0 space-y-1 border-r border-slate-700 bg-slate-900 p-3"
              style={{ width: DAILY_TIMELINE_JOB_COLUMN_WIDTH }}
            >
              <p className="truncate text-sm font-semibold text-slate-50">{row.label}</p>
              <p className="truncate text-xs text-slate-300">{row.subtitle || 'Allocation row'}</p>
              {row.job?.site_address ? (
                <p className="truncate text-[11px] text-slate-400">{row.job.site_address}</p>
              ) : null}
              {row.job ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(boardControlStyles.ghost, 'h-8 px-2 text-xs')}
                  onClick={() => onAddVisit(jobResourceKey(row.job!), date)}
                >
                  + Add timed visit
                </Button>
              ) : null}
            </div>
            <TimelineCell
              jobKey={row.id}
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
                    instanceId={`${row.id}:${date}:${visit.id}`}
                    title={row.job?.title || visit.job_code}
                    labour={visitLabour(board, visit.id)}
                    plant={visitPlant(board, visit.id)}
                    labourNames={labourNames(visit.id)}
                    plantLabels={plantLabels(visit.id)}
                    conflicts={visitConflicts(board, visit.id)}
                    selected={selectedVisitId === visit.id}
                    style={{ left, width, top: 8 + lane * LANE_HEIGHT, height: LANE_HEIGHT - 12 }}
                    onSelect={() => onSelectVisit(visit)}
                    onMove={() => onMoveVisit(visit)}
                    onEdit={() => onEditVisit(visit)}
                    onDelete={() => onDeleteVisit(visit)}
                    onAssign={() => onAssignVisit(visit)}
                    onResizePointerDown={(edge, event) => handleResizePointerDown(visit, edge, event)}
                    onResizeKeyDown={(edge, event) => resizeByKeyboard(visit, edge, event)}
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
