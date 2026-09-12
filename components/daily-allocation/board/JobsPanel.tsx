'use client';

import { useState } from 'react';
import { Minimize2, MoveHorizontal, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DailyTimeline } from '@/components/daily-allocation/board/DailyTimeline';
import { WeeklyGrid } from '@/components/daily-allocation/board/WeeklyGrid';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import type { DailyAllocationBoardRow } from '@/components/daily-allocation/board/daily-allocation-board-primary';
import { cn } from '@/lib/utils/cn';
import type { DailyAllocationBoardView } from '@/lib/config/daily-allocation-view-preference';
import type { DailyAllocationBoardPrimary } from '@/lib/config/daily-allocation-primary-preference';
import type { DailyAllocationRangeBoardPayload, DailyAllocationVisit } from '@/types/daily-allocation';

export type DailyAllocationTimelineMode = 'fit' | 'scroll';

interface JobsPanelProps {
  board: DailyAllocationRangeBoardPayload;
  view: DailyAllocationBoardView;
  primary: DailyAllocationBoardPrimary;
  selectedDate: string;
  dates: string[];
  rows: DailyAllocationBoardRow[];
  jobSearch: string;
  onJobSearchChange: (value: string) => void;
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

export function JobsPanel({
  board,
  view,
  primary,
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
  onMoveVisit,
  onEditVisit,
  onDeleteVisit,
  onAssignVisit,
  onResizeVisit,
  onPointerInteractionChange,
}: JobsPanelProps) {
  const [timelineMode, setTimelineMode] = useState<DailyAllocationTimelineMode>('fit');
  const primaryLabel = primary === 'employee' ? 'employee' : primary;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col space-y-3" data-testid="daily-allocation-jobs-panel">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-100" data-testid="daily-allocation-view-heading">
            {view === 'daily' ? 'Daily' : 'Weekly'} {primaryLabel} board
          </h2>
          <p className="text-xs text-slate-400">
            Drag from the grip handle onto a timed visit, or select the visit and use Assign resources.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {view === 'daily' ? (
            <div className="flex items-center gap-1" role="group" aria-label="Daily timeline display mode">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  'h-9 px-2',
                  timelineMode === 'fit' ? boardControlStyles.primary : boardControlStyles.ghost
                )}
                aria-label="Fit timeline to width"
                aria-pressed={timelineMode === 'fit'}
                onClick={() => setTimelineMode('fit')}
              >
                <Minimize2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Fit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  'h-9 px-2',
                  timelineMode === 'scroll' ? boardControlStyles.primary : boardControlStyles.ghost
                )}
                aria-label="Use scrollable timeline"
                aria-pressed={timelineMode === 'scroll'}
                onClick={() => setTimelineMode('scroll')}
              >
                <MoveHorizontal className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Scroll
              </Button>
            </div>
          ) : null}
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
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {view === 'daily' ? (
          <DailyTimeline
            board={board}
            date={selectedDate}
            rows={rows}
            primary={primary}
            mode={timelineMode}
            selectedVisitId={selectedVisitId}
            labourNames={labourNames}
            plantLabels={plantLabels}
            onAddVisit={onAddVisit}
            onSelectVisit={onSelectVisit}
            onMoveVisit={onMoveVisit}
            onEditVisit={onEditVisit}
            onDeleteVisit={onDeleteVisit}
            onAssignVisit={onAssignVisit}
            onResizeVisit={onResizeVisit}
            onPointerInteractionChange={onPointerInteractionChange}
          />
        ) : (
          <WeeklyGrid
            board={board}
            dates={dates}
            rows={rows}
            primary={primary}
            selectedVisitId={selectedVisitId}
            labourNames={labourNames}
            plantLabels={plantLabels}
            onAddVisit={onAddVisit}
            onSelectVisit={onSelectVisit}
            onMoveVisit={onMoveVisit}
            onEditVisit={onEditVisit}
            onDeleteVisit={onDeleteVisit}
            onAssignVisit={onAssignVisit}
          />
        )}
      </div>
    </section>
  );
}
