'use client';

import { format, parseISO } from 'date-fns';
import type { ReactNode } from 'react';
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
import type { DailyAllocationRangeBoardPayload, DailyAllocationVisit } from '@/types/daily-allocation';

interface WeeklyGridProps {
  board: DailyAllocationRangeBoardPayload;
  dates: string[];
  rows: DailyAllocationJobRow[];
  selectedVisitId: string | null;
  labourNames: (visitId: string) => string[];
  plantLabels: (visitId: string) => string[];
  onAddVisit: (jobKey: string, date: string) => void;
  onSelectVisit: (visit: DailyAllocationVisit) => void;
  onEditVisit: (visit: DailyAllocationVisit) => void;
  onDeleteVisit: (visit: DailyAllocationVisit) => void;
  onAssignVisit: (visit: DailyAllocationVisit) => void;
}

function WeekCell({
  jobKey,
  date,
  children,
}: {
  jobKey: string;
  date: string;
  children: ReactNode;
}) {
  const { ref, isDropTarget } = useDroppable({
    id: `week:${jobKey}:${date}`,
    type: DAILY_ALLOCATION_DND.weekCell,
    accept: [DAILY_ALLOCATION_DND.job, DAILY_ALLOCATION_DND.visit],
    data: {
      target: { surface: 'week-cell', workDate: date, jobKey },
    },
  });

  return (
    <div
      ref={ref}
      data-testid={`daily-allocation-week-cell-${jobKey}-${date}`}
      className={cn(
        'min-h-36 space-y-2 border-l border-t border-slate-800 bg-slate-950/50 p-2',
        isDropTarget && 'bg-[hsl(var(--daily-allocation-primary)/0.12)]'
      )}
    >
      {children}
    </div>
  );
}

export function WeeklyGrid({
  board,
  dates,
  rows,
  selectedVisitId,
  labourNames,
  plantLabels,
  onAddVisit,
  onSelectVisit,
  onEditVisit,
  onDeleteVisit,
  onAssignVisit,
}: WeeklyGridProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700" data-testid="daily-allocation-weekly-board">
      <div
        className="grid min-w-[64rem]"
        style={{ gridTemplateColumns: `240px repeat(${dates.length}, minmax(8rem, 1fr))` }}
      >
        <div className="sticky left-0 z-10 border-b border-r border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold uppercase text-slate-400">
          Job
        </div>
        {dates.map((date) => (
          <div key={date} className="border-b border-slate-700 bg-slate-900 px-2 py-2 text-center">
            <p className="text-xs font-semibold text-slate-100">{format(parseISO(date), 'EEE')}</p>
            <p className="text-[11px] text-slate-400">{format(parseISO(date), 'd MMM')}</p>
          </div>
        ))}
        {rows.length === 0 ? (
          <div className="col-span-full p-6 text-sm text-slate-400">
            No catalogue jobs on this board yet. Use Add visit or drag a job from Resources.
          </div>
        ) : rows.map((row) => (
          <div key={row.key} className="contents">
            <div className="sticky left-0 z-10 space-y-1 border-t border-r border-slate-700 bg-slate-900 p-3">
              <p className="truncate text-sm font-semibold text-slate-50">{row.job.job_code}</p>
              <p className="truncate text-xs text-slate-300">{row.job.title || row.job.customer_name || 'Catalogue job'}</p>
            </div>
            {dates.map((date) => {
              const dayVisits = row.visits.filter((visit) => visit.work_date === date);
              return (
                <WeekCell key={`${row.key}:${date}`} jobKey={row.key} date={date}>
                  {dayVisits.map((visit) => (
                    <VisitCard
                      key={visit.id}
                      visit={visit}
                      title={row.job.title || row.job.job_code}
                      labour={visitLabour(board, visit.id)}
                      plant={visitPlant(board, visit.id)}
                      labourNames={labourNames(visit.id)}
                      plantLabels={plantLabels(visit.id)}
                      conflicts={visitConflicts(board, visit.id)}
                      selected={selectedVisitId === visit.id}
                      compact
                      style={{ position: 'relative', width: '100%', height: 'auto' }}
                      onSelect={() => onSelectVisit(visit)}
                      onEdit={() => onEditVisit(visit)}
                      onDelete={() => onDeleteVisit(visit)}
                      onAssign={() => onAssignVisit(visit)}
                    />
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={cn(boardControlStyles.ghost, 'h-8 w-full justify-start text-xs')}
                    onClick={() => onAddVisit(row.key, date)}
                  >
                    + Add timed visit
                  </Button>
                </WeekCell>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
