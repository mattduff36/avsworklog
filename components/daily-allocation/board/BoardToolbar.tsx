'use client';

import type { ReactNode } from 'react';
import { Minimize2, MoveHorizontal, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BoardDateRangeControls } from '@/components/daily-allocation/board/BoardDateRangeControls';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import type { DailyAllocationTimelineMode } from '@/components/daily-allocation/board/JobsPanel';
import {
  DAILY_ALLOCATION_BOARD_VIEWS,
  type DailyAllocationBoardView,
} from '@/lib/config/daily-allocation-view-preference';
import {
  DAILY_ALLOCATION_BOARD_PRIMARIES,
  type DailyAllocationBoardPrimary,
} from '@/lib/config/daily-allocation-primary-preference';
import { cn } from '@/lib/utils/cn';

interface BoardToolbarProps {
  selectedDate: string;
  view: DailyAllocationBoardView;
  onDateChange: (date: string) => void;
  onViewChange: (view: DailyAllocationBoardView) => void;
  primary?: DailyAllocationBoardPrimary;
  onPrimaryChange?: (primary: DailyAllocationBoardPrimary) => void;
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  statusMessage?: string;
  teams?: Array<{ id: string; name: string }>;
  activeTeamId?: string | null;
  onTeamChange?: (teamId: string) => void;
  title?: string;
  titleMeta?: ReactNode;
  jobSearch?: string;
  onJobSearchChange?: (value: string) => void;
  timelineMode?: DailyAllocationTimelineMode;
  timelineFitEligible?: boolean;
  onTimelineModeChange?: (mode: DailyAllocationTimelineMode) => void;
  onAddVisit?: () => void;
  onAssign?: () => void;
  assignDisabled?: boolean;
  assignLabel?: string;
  legacyReview?: {
    labourCount: number;
    plantCount: number;
    onReview: () => void;
  } | null;
}

export function BoardToolbar({
  selectedDate,
  view,
  onDateChange,
  onViewChange,
  primary = DAILY_ALLOCATION_BOARD_PRIMARIES.job,
  onPrimaryChange,
  isLoading,
  isFetching,
  isStale,
  statusMessage,
  teams = [],
  activeTeamId,
  onTeamChange,
  title,
  titleMeta,
  jobSearch,
  onJobSearchChange,
  timelineMode = 'fit',
  timelineFitEligible = true,
  onTimelineModeChange,
  onAddVisit,
  onAssign,
  assignDisabled,
  assignLabel = 'Assign resources',
  legacyReview,
}: BoardToolbarProps) {
  const effectiveTimelineMode =
    timelineMode === 'fit' && timelineFitEligible ? 'fit' : 'scroll';
  const feedback = [
    isLoading ? 'Loading board' : null,
    !isLoading && isFetching ? 'Refreshing' : null,
    isStale ? 'Board may be stale' : null,
    statusMessage,
  ].filter(Boolean).join('. ');

  return (
    <div className="flex flex-col gap-3" data-testid="daily-allocation-toolbar">
      <div
        className="flex flex-nowrap items-center gap-3 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        data-testid="daily-allocation-board-title-row"
      >
        {title ? (
          <div className="flex shrink-0 items-center gap-2">
            <h2
              className="shrink-0 whitespace-nowrap text-2xl font-semibold leading-none tracking-tight text-foreground"
              data-testid="daily-allocation-view-heading"
            >
              {title}
            </h2>
            {titleMeta}
          </div>
        ) : null}

        <BoardDateRangeControls
          selectedDate={selectedDate}
          view={view}
          onDateChange={onDateChange}
          onViewChange={onViewChange}
          primary={primary}
          onPrimaryChange={onPrimaryChange}
        />

        {teams.length > 1 ? (
          <select
            aria-label="Active team"
            data-testid="daily-allocation-team-selector"
            value={activeTeamId || ''}
            onChange={(event) => onTeamChange?.(event.target.value)}
            className="h-9 w-auto max-w-44 shrink-0 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        ) : null}

        {onJobSearchChange ? (
          <div className="relative ml-auto w-40 max-w-72 shrink-0 overflow-hidden">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={jobSearch || ''}
              onChange={(event) => onJobSearchChange(event.target.value)}
              placeholder="Search jobs"
              aria-label="Search jobs"
              className="h-9 overflow-hidden py-0 pl-9 leading-none"
            />
          </div>
        ) : null}
      </div>

      <div
        className="flex min-h-7 flex-wrap items-center justify-between gap-3"
        data-testid="daily-allocation-board-instruction-row"
      >
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground xl:hidden">
            Drag from the grip handle onto a visit, or select a visit and tap a resource.
          </p>
          <p className="hidden text-sm text-muted-foreground xl:block">
            Drag from the grip handle onto a timed visit, or select the visit and tap a resource.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {legacyReview ? (
            <div
              className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-400/10 px-2 py-1"
              data-testid="daily-allocation-legacy-conversion"
            >
              <p className="max-w-64 truncate text-xs font-semibold text-amber-100">
                Untimed legacy drafts need review
              </p>
              <p className="sr-only">
                {legacyReview.labourCount} labour and {legacyReview.plantCount} plant drafts must each be mapped or given an explicit disposition.
              </p>
              <Button
                type="button"
                size="sm"
                className={cn(boardControlStyles.warning, 'h-7 px-2')}
                onClick={legacyReview.onReview}
              >
                Review and convert
              </Button>
            </div>
          ) : null}

          {view === DAILY_ALLOCATION_BOARD_VIEWS.daily && onTimelineModeChange ? (
            <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Daily timeline display mode">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  'h-7 w-7 p-0',
                  effectiveTimelineMode === 'fit' ? boardControlStyles.primary : boardControlStyles.ghost
                )}
                aria-label="Fit timeline to width"
                aria-pressed={effectiveTimelineMode === 'fit'}
                disabled={!timelineFitEligible}
                title="Shrink to fit width"
                onClick={() => onTimelineModeChange('fit')}
              >
                <Minimize2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  'h-7 w-7 p-0',
                  effectiveTimelineMode === 'scroll' ? boardControlStyles.primary : boardControlStyles.ghost
                )}
                aria-label="Use scrollable timeline"
                aria-pressed={effectiveTimelineMode === 'scroll'}
                title="Scroll"
                onClick={() => onTimelineModeChange('scroll')}
              >
                <MoveHorizontal className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : null}

          {onAddVisit ? (
            <Button
              type="button"
              size="sm"
              className={cn(boardControlStyles.outline, 'h-8 shrink-0')}
              onClick={onAddVisit}
            >
              Add visit
            </Button>
          ) : null}
          {onAssign ? (
            <Button
              type="button"
              size="sm"
              className={cn(boardControlStyles.outline, 'h-8 shrink-0')}
              disabled={assignDisabled}
              onClick={onAssign}
            >
              {assignLabel}
            </Button>
          ) : null}

          <p
            className={cn(
              'truncate text-xs text-muted-foreground',
              feedback ? 'max-w-52' : 'sr-only'
            )}
            aria-live="polite"
            data-testid="daily-allocation-board-status"
          >
            {feedback || 'Board ready'}
          </p>
        </div>
      </div>
    </div>
  );
}
