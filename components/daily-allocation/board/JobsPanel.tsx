'use client';

import { DailyTimeline } from '@/components/daily-allocation/board/DailyTimeline';
import { WeeklyGrid } from '@/components/daily-allocation/board/WeeklyGrid';
import type { DailyAllocationBoardRow } from '@/components/daily-allocation/board/daily-allocation-board-primary';
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
  timelineMode: DailyAllocationTimelineMode;
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
  onFitEligibleChange?: (eligible: boolean) => void;
}

export function JobsPanel({
  board,
  view,
  primary,
  selectedDate,
  dates,
  rows,
  timelineMode,
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
  onFitEligibleChange,
}: JobsPanelProps) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-testid="daily-allocation-jobs-panel">
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
            onFitEligibleChange={onFitEligibleChange}
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
