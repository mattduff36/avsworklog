'use client';

import { format, parseISO } from 'date-fns';
import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/react';
import { Button } from '@/components/ui/button';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import { DAILY_ALLOCATION_DND, jobResourceKey } from '@/components/daily-allocation/board/board-dnd';
import type { DailyAllocationBoardRow } from '@/components/daily-allocation/board/daily-allocation-board-primary';
import {
  getDailyAllocationBoardAxisLabel,
  getDailyAllocationBoardRowTestId,
} from '@/components/daily-allocation/board/daily-allocation-board-primary';
import {
  visitConflicts,
  visitLabour,
  visitPlant,
} from '@/components/daily-allocation/board/board-model';
import { VisitCard } from '@/components/daily-allocation/board/VisitCard';
import { cn } from '@/lib/utils/cn';
import type { DailyAllocationRangeBoardPayload, DailyAllocationVisit } from '@/types/daily-allocation';
import type { DailyAllocationBoardPrimary } from '@/lib/config/daily-allocation-primary-preference';

interface WeeklyGridProps {
  board: DailyAllocationRangeBoardPayload;
  dates: string[];
  rows: DailyAllocationBoardRow[];
  primary: DailyAllocationBoardPrimary;
  selectedVisitId: string | null;
  labourNames: (visitId: string) => string[];
  plantLabels: (visitId: string) => string[];
  onAddVisit: (jobKey: string, date: string) => void;
  onSelectVisit: (visit: DailyAllocationVisit) => void;
  onMoveVisit: (visit: DailyAllocationVisit) => void;
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
        'min-h-36 space-y-2 border-l border-t border-border bg-slate-950/50 p-2',
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
  primary,
  selectedVisitId,
  labourNames,
  plantLabels,
  onAddVisit,
  onSelectVisit,
  onMoveVisit,
  onEditVisit,
  onDeleteVisit,
  onAssignVisit,
}: WeeklyGridProps) {
  return (
    <div className="h-full min-h-0 overflow-auto rounded-lg border border-border" data-testid="daily-allocation-weekly-board">
      <div
        className="grid min-w-[64rem]"
        style={{ gridTemplateColumns: `240px repeat(${dates.length}, minmax(8rem, 1fr))` }}
      >
        <div className="sticky left-0 z-10 border-b border-r border-border bg-slate-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {getDailyAllocationBoardAxisLabel(primary)}
        </div>
        {dates.map((date) => (
          <div key={date} className="border-b border-border bg-slate-900 px-2 py-2 text-center">
            <p className="text-xs font-semibold text-foreground">{format(parseISO(date), 'EEE')}</p>
            <p className="text-[11px] text-muted-foreground">{format(parseISO(date), 'd MMM')}</p>
          </div>
        ))}
        {rows.length === 0 ? (
          <div className="contents">
            <div className="sticky left-0 z-10 space-y-1 border-t border-r border-border bg-slate-900 p-3">
              <p className="truncate font-semibold text-foreground">No timed visits</p>
              <p className="mt-1 truncate text-sm text-muted-foreground">Drag a job from Resources or use Add visit.</p>
            </div>
            {dates.map((date) => (
              <WeekCell key={`empty:${date}`} jobKey="" date={date}>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(boardControlStyles.ghost, 'h-8 w-full justify-start text-xs')}
                  onClick={() => onAddVisit('', date)}
                >
                  + Add timed visit
                </Button>
              </WeekCell>
            ))}
          </div>
        ) : rows.map((row) => (
          <div key={row.id} className="contents" data-testid={getDailyAllocationBoardRowTestId(row)}>
            <div className="sticky left-0 z-10 space-y-1 border-t border-r border-border bg-slate-900 p-3">
              <p className="truncate font-semibold text-foreground">{row.label}</p>
              <p className="mt-1 truncate text-sm text-muted-foreground">{row.subtitle || 'Allocation row'}</p>
            </div>
            {dates.map((date) => {
              const dayVisits = row.visitsByDate[date] || [];
              return (
                <WeekCell key={`${row.id}:${date}`} jobKey={row.id} date={date}>
                  {dayVisits.map((visit) => (
                    <VisitCard
                      key={visit.id}
                      visit={visit}
                      instanceId={`${row.id}:${date}:${visit.id}`}
                      title={row.job?.title || visit.job_code}
                      labour={visitLabour(board, visit.id)}
                      plant={visitPlant(board, visit.id)}
                      labourNames={labourNames(visit.id)}
                      plantLabels={plantLabels(visit.id)}
                      conflicts={visitConflicts(board, visit.id)}
                      selected={selectedVisitId === visit.id}
                      compact
                      style={{ position: 'relative', width: '100%', height: 'auto' }}
                      onSelect={() => onSelectVisit(visit)}
                      onMove={() => onMoveVisit(visit)}
                      onEdit={() => onEditVisit(visit)}
                      onDelete={() => onDeleteVisit(visit)}
                      onAssign={() => onAssignVisit(visit)}
                    />
                  ))}
                  {row.job ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className={cn(boardControlStyles.ghost, 'h-8 w-full justify-start text-xs')}
                      onClick={() => onAddVisit(jobResourceKey(row.job!), date)}
                    >
                      + Add timed visit
                    </Button>
                  ) : null}
                </WeekCell>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
