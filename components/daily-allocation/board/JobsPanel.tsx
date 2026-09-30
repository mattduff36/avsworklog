'use client';

import { SessionBoard } from '@/components/daily-allocation/board/SessionBoard';
import type { DailyAllocationBoardRow } from '@/components/daily-allocation/board/daily-allocation-board-primary';
import type { DailyAllocationBoardView } from '@/lib/config/daily-allocation-view-preference';
import type { DailyAllocationSession } from '@/lib/utils/daily-allocation-sessions';
import type { DailyAllocationRangeBoardPayload, DailyAllocationVisit } from '@/types/daily-allocation';

export type DailyAllocationTimelineMode = 'fit' | 'scroll';

interface JobsPanelProps {
  board: DailyAllocationRangeBoardPayload;
  view: DailyAllocationBoardView;
  selectedDate: string;
  dates: string[];
  rows: DailyAllocationBoardRow[];
  selectedVisitId: string | null;
  labourNames: (visitId: string) => string[];
  plantLabels: (visitId: string) => string[];
  onSelectVisit: (visit: DailyAllocationVisit) => void;
  onEditVisit: (visit: DailyAllocationVisit) => void;
  onDeleteVisit: (visit: DailyAllocationVisit) => void;
  onAssignVisit: (visit: DailyAllocationVisit) => void;
  onMoveVisit: (visit: DailyAllocationVisit) => void;
  onSetSession: (
    visit: DailyAllocationVisit,
    session: DailyAllocationSession,
    profileId?: string | null,
  ) => void;
  onReviewCustom?: () => void;
  persistenceLabel?: (visitId: string) => string | null;
}

export function JobsPanel({
  board,
  view,
  selectedDate,
  dates,
  rows,
  selectedVisitId,
  labourNames,
  plantLabels,
  onSelectVisit,
  onEditVisit,
  onDeleteVisit,
  onAssignVisit,
  onMoveVisit,
  onSetSession,
  onReviewCustom,
  persistenceLabel,
}: JobsPanelProps) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-testid="daily-allocation-jobs-panel">
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <SessionBoard
          board={board}
          view={view}
          date={selectedDate}
          dates={dates}
          rows={rows}
          selectedVisitId={selectedVisitId}
          labourNames={labourNames}
          plantLabels={plantLabels}
          persistenceLabel={persistenceLabel}
          onSelectVisit={onSelectVisit}
          onEditVisit={onEditVisit}
          onDeleteVisit={onDeleteVisit}
          onAssignVisit={onAssignVisit}
          onMoveVisit={onMoveVisit}
          onSetSession={onSetSession}
          onReviewCustom={onReviewCustom}
        />
      </div>
    </section>
  );
}
