'use client';

import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DailyTimeline } from '@/components/daily-allocation/board/DailyTimeline';
import { WeeklyGrid } from '@/components/daily-allocation/board/WeeklyGrid';
import { VisitCard } from '@/components/daily-allocation/board/VisitCard';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import type { DailyAllocationJobRow } from '@/components/daily-allocation/board/board-model';
import {
  visitConflicts,
  visitLabour,
  visitPlant,
} from '@/components/daily-allocation/board/board-model';
import { cn } from '@/lib/utils/cn';
import type { DailyAllocationBoardView } from '@/lib/config/daily-allocation-view-preference';
import type { DailyAllocationRangeBoardPayload, DailyAllocationVisit } from '@/types/daily-allocation';

interface JobsPanelProps {
  board: DailyAllocationRangeBoardPayload;
  view: DailyAllocationBoardView;
  selectedDate: string;
  dates: string[];
  rows: DailyAllocationJobRow[];
  jobSearch: string;
  onJobSearchChange: (value: string) => void;
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

export function JobsPanel({
  board,
  view,
  selectedDate,
  dates,
  rows,
  jobSearch,
  onJobSearchChange,
  selectedVisitId,
  labourNames,
  plantLabels,
  onAddVisit,
  onSelectVisit,
  onEditVisit,
  onDeleteVisit,
  onAssignVisit,
  onResizeVisit,
}: JobsPanelProps) {
  const mobileVisits = view === 'daily'
    ? board.visits.filter((visit) => visit.work_date === selectedDate)
    : board.visits;

  return (
    <section className="min-w-0 space-y-3" data-testid="daily-allocation-jobs-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-100" data-testid="daily-allocation-view-heading">
            {view === 'daily' ? 'Daily job board' : 'Weekly job board'}
          </h2>
          <p className="text-xs text-slate-400">
            Drag from the grip handle onto a timed visit, or select the visit and use Assign resources.
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
          <Input
            value={jobSearch}
            onChange={(event) => onJobSearchChange(event.target.value)}
            placeholder="Search jobs"
            aria-label="Search jobs"
            className="h-9 w-56 border-slate-600 bg-slate-950 pl-8 text-slate-100"
          />
        </div>
      </div>

      <div className="hidden min-w-0 lg:block">
        {view === 'daily' ? (
          <DailyTimeline
            board={board}
            date={selectedDate}
            rows={rows}
            selectedVisitId={selectedVisitId}
            labourNames={labourNames}
            plantLabels={plantLabels}
            onAddVisit={onAddVisit}
            onSelectVisit={onSelectVisit}
            onEditVisit={onEditVisit}
            onDeleteVisit={onDeleteVisit}
            onAssignVisit={onAssignVisit}
            onResizeVisit={onResizeVisit}
          />
        ) : (
          <WeeklyGrid
            board={board}
            dates={dates}
            rows={rows}
            selectedVisitId={selectedVisitId}
            labourNames={labourNames}
            plantLabels={plantLabels}
            onAddVisit={onAddVisit}
            onSelectVisit={onSelectVisit}
            onEditVisit={onEditVisit}
            onDeleteVisit={onDeleteVisit}
            onAssignVisit={onAssignVisit}
          />
        )}
      </div>

      <div className="space-y-3 lg:hidden" data-testid="daily-allocation-mobile-board">
        {mobileVisits.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 p-4">
            <p className="text-sm text-slate-300">No timed visits on this date yet.</p>
            <Button
              type="button"
              className={cn(boardControlStyles.outline, 'mt-3 min-h-11')}
              onClick={() => onAddVisit('', selectedDate)}
            >
              Add visit
            </Button>
          </div>
        ) : mobileVisits.map((visit) => (
          <VisitCard
            key={visit.id}
            visit={visit}
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
      </div>
    </section>
  );
}
