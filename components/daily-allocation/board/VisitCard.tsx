'use client';

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/react';
import { Button } from '@/components/ui/button';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import { DAILY_ALLOCATION_DND } from '@/components/daily-allocation/board/board-dnd';
import { cn } from '@/lib/utils/cn';
import {
  formatDailyAllocationVisitTime,
} from '@/lib/utils/daily-allocation-timeline';
import type {
  DailyAllocationBoardConflict,
  DailyAllocationLabourAssignment,
  DailyAllocationPlantAssignment,
  DailyAllocationVisit,
} from '@/types/daily-allocation';

export interface VisitCardProps {
  visit: DailyAllocationVisit;
  title?: string | null;
  labour: DailyAllocationLabourAssignment[];
  plant: DailyAllocationPlantAssignment[];
  labourNames: string[];
  plantLabels: string[];
  conflicts: DailyAllocationBoardConflict[];
  selected?: boolean;
  compact?: boolean;
  style?: CSSProperties;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAssign: () => void;
  onResizePointerDown?: (edge: 'start' | 'end', event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function VisitCard({
  visit,
  title,
  labour,
  plant,
  labourNames,
  plantLabels,
  conflicts,
  selected,
  compact,
  style,
  onSelect,
  onEdit,
  onDelete,
  onAssign,
  onResizePointerDown,
}: VisitCardProps) {
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: `visit-drop:${visit.id}`,
    type: DAILY_ALLOCATION_DND.visit,
    accept: [DAILY_ALLOCATION_DND.employee, DAILY_ALLOCATION_DND.plant],
    data: {
      target: { surface: 'visit', visitId: visit.id, workDate: visit.work_date },
    },
  });
  const { ref: dragRef, handleRef, isDragging } = useDraggable({
    id: `visit:${visit.id}`,
    type: DAILY_ALLOCATION_DND.visit,
    data: { source: { kind: 'visit', visit } },
  });
  const hard = conflicts.filter((conflict) => conflict.severity === 'hard');
  const warnings = conflicts.filter((conflict) => conflict.severity === 'warning');
  const timeLabel = `${formatDailyAllocationVisitTime(visit.starts_at)}–${formatDailyAllocationVisitTime(visit.ends_at)}`;
  const resources = [...labourNames, ...plantLabels];

  return (
    <article
      ref={(node) => {
        dropRef(node);
        dragRef(node);
      }}
      style={style}
      data-testid={`daily-allocation-visit-${visit.id}`}
      className={cn(
        'absolute overflow-hidden rounded-md border bg-sky-950/80 text-sky-50 shadow-sm motion-reduce:transition-none',
        selected || isDropTarget
          ? 'border-[hsl(var(--daily-allocation-primary))] ring-2 ring-[hsl(var(--daily-allocation-primary))]'
          : hard.length > 0
            ? 'border-red-500'
            : warnings.length > 0
              ? 'border-amber-400'
              : 'border-sky-700/70',
        isDragging && 'opacity-60',
        compact && 'static'
      )}
    >
      <button
        type="button"
        className="flex w-full min-h-11 items-start gap-1 px-2 py-1.5 text-left"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${selected ? 'Selected' : 'Select'} ${visit.job_code} ${timeLabel}`}
      >
        <span
          ref={handleRef}
          data-testid={`daily-allocation-visit-drag-handle-${visit.id}`}
          className="mt-0.5 inline-flex min-h-11 min-w-8 touch-none items-center justify-center text-sky-200"
          style={{ touchAction: 'none' }}
          aria-hidden="true"
        >
          <span className="block h-4 w-1.5 rounded-full bg-sky-400/80" />
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block truncate text-[11px] font-semibold tabular-nums">{timeLabel}</span>
          <span className="block truncate text-xs font-medium">{title || visit.job_code}</span>
          <span className="block truncate text-[11px] text-sky-100/80">{visit.site_address}</span>
          {resources.length > 0 ? (
            <span className="block truncate text-[11px] text-sky-100/70">{resources.join(' · ')}</span>
          ) : (
            <span className="block text-[11px] text-amber-200">No resources assigned</span>
          )}
          {hard.concat(warnings).map((conflict) => (
            <span key={`${conflict.code}:${conflict.message}`} className="flex items-start gap-1 text-[11px] text-amber-200">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {conflict.message}
            </span>
          ))}
        </span>
      </button>
      <div className="flex items-center justify-end gap-1 px-1 pb-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn(boardControlStyles.ghost, 'h-8 min-w-8 px-2')}
          aria-label={`Assign resources to ${visit.job_code}`}
          onClick={onAssign}
        >
          Assign
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn(boardControlStyles.ghost, 'h-8 w-8')}
          aria-label={`Edit visit ${visit.job_code}`}
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn(boardControlStyles.ghost, 'h-8 w-8')}
          aria-label={`Delete visit ${visit.job_code}`}
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {onResizePointerDown ? (
        <>
          <button
            type="button"
            aria-label={`Resize start of ${visit.job_code}`}
            className="absolute inset-y-1 left-0 w-2 cursor-ew-resize rounded-l-md bg-transparent hover:bg-white/20"
            onPointerDown={(event) => onResizePointerDown('start', event)}
          />
          <button
            type="button"
            aria-label={`Resize end of ${visit.job_code}`}
            className="absolute inset-y-1 right-0 w-2 cursor-ew-resize rounded-r-md bg-transparent hover:bg-white/20"
            onPointerDown={(event) => onResizePointerDown('end', event)}
          />
        </>
      ) : null}
      <span className="sr-only">
        {labour.length} labour and {plant.length} plant assignments.
      </span>
    </article>
  );
}
