'use client';

import type { ReactNode } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Minimize2, MoveHorizontal, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import {
  formatDailyAllocationDate,
  getDailyAllocationWeekRange,
} from '@/lib/utils/daily-allocation-timeline';
import { cn } from '@/lib/utils/cn';

interface BoardToolbarProps {
  selectedDate: string;
  view: DailyAllocationBoardView;
  onDateChange: (date: string) => void;
  onViewChange: (view: DailyAllocationBoardView) => void;
  primary?: DailyAllocationBoardPrimary;
  onPrimaryChange?: (primary: DailyAllocationBoardPrimary) => void;
  onPublish: () => void;
  publishDisabled?: boolean;
  publishDisabledReason?: string;
  publishing?: boolean;
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
  onTimelineModeChange?: (mode: DailyAllocationTimelineMode) => void;
  latestPublicationLabel?: string;
  onOpenHistory?: () => void;
  onAddVisit?: () => void;
  onAssign?: () => void;
  assignDisabled?: boolean;
  assignLabel?: string;
}

export function BoardToolbar({
  selectedDate,
  view,
  onDateChange,
  onViewChange,
  primary = DAILY_ALLOCATION_BOARD_PRIMARIES.job,
  onPrimaryChange,
  onPublish,
  publishDisabled,
  publishDisabledReason,
  publishing,
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
  onTimelineModeChange,
  latestPublicationLabel,
  onOpenHistory,
  onAddVisit,
  onAssign,
  assignDisabled,
  assignLabel = 'Assign resources',
}: BoardToolbarProps) {
  const selected = parseISO(selectedDate);
  const week = getDailyAllocationWeekRange(selectedDate);
  const periodLabel =
    view === DAILY_ALLOCATION_BOARD_VIEWS.daily
      ? format(selected, 'EEEE, d MMMM yyyy')
      : `${format(parseISO(week.start), 'd MMM')} – ${format(parseISO(week.end), 'd MMM yyyy')}`;
  const periodName = view === DAILY_ALLOCATION_BOARD_VIEWS.daily ? 'day' : 'week';

  function move(amount: number) {
    const days = view === DAILY_ALLOCATION_BOARD_VIEWS.daily ? amount : amount * 7;
    onDateChange(formatDailyAllocationDate(addDays(selected, days)));
  }

  function handleViewChange(value: string) {
    if (value === DAILY_ALLOCATION_BOARD_VIEWS.daily || value === DAILY_ALLOCATION_BOARD_VIEWS.weekly) {
      onViewChange(value);
    }
  }

  function handlePrimaryChange(value: string) {
    if (
      value === DAILY_ALLOCATION_BOARD_PRIMARIES.job
      || value === DAILY_ALLOCATION_BOARD_PRIMARIES.employee
      || value === DAILY_ALLOCATION_BOARD_PRIMARIES.plant
    ) {
      onPrimaryChange?.(value);
    }
  }

  const feedback = [
    isLoading ? 'Loading board' : null,
    !isLoading && isFetching ? 'Refreshing' : null,
    isStale ? 'Board may be stale' : null,
    statusMessage,
  ].filter(Boolean).join('. ');

  return (
    <div
      className="flex w-full min-w-0 flex-nowrap items-center gap-2 overflow-x-auto sm:gap-3"
      data-testid="daily-allocation-toolbar"
    >
      {title ? (
        <div className="flex shrink-0 items-center gap-2">
          <h1
            className="whitespace-nowrap text-sm font-semibold text-slate-100"
            data-testid="daily-allocation-view-heading"
          >
            {title}
          </h1>
          {titleMeta}
        </div>
      ) : null}

      <Tabs value={view} onValueChange={handleViewChange} className="shrink-0">
        <TabsList aria-label="Allocation date range" className="grid h-9 w-[8.5rem] grid-cols-2 gap-0 p-1">
          <TabsTrigger value={DAILY_ALLOCATION_BOARD_VIEWS.daily} className="px-3">
            Daily
          </TabsTrigger>
          <TabsTrigger value={DAILY_ALLOCATION_BOARD_VIEWS.weekly} className="px-3">
            Weekly
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs value={primary} onValueChange={handlePrimaryChange} className="shrink-0">
        <TabsList
          aria-label="Board primary resource"
          className="grid h-9 w-[13rem] grid-cols-3 gap-0 p-1"
          data-testid="daily-allocation-primary-tabs"
        >
          <TabsTrigger value={DAILY_ALLOCATION_BOARD_PRIMARIES.job} aria-label="Primary Jobs">
            Jobs
          </TabsTrigger>
          <TabsTrigger value={DAILY_ALLOCATION_BOARD_PRIMARIES.employee} aria-label="Primary Employees">
            Employees
          </TabsTrigger>
          <TabsTrigger value={DAILY_ALLOCATION_BOARD_PRIMARIES.plant} aria-label="Primary Plant">
            Plant
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          className={boardControlStyles.outline}
          size="sm"
          onClick={() => move(-1)}
          aria-label={`Previous ${periodName}`}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          className={boardControlStyles.outline}
          size="sm"
          onClick={() => onDateChange(formatDailyAllocationDate(new Date()))}
        >
          Today
        </Button>
        <p
          aria-live="polite"
          className="min-w-44 whitespace-nowrap text-center text-sm font-semibold text-slate-100"
          data-testid="daily-allocation-period-label"
        >
          {periodLabel}
        </p>
        <Button
          variant="outline"
          className={boardControlStyles.outline}
          size="sm"
          onClick={() => move(1)}
          aria-label={`Next ${periodName}`}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <Input
        type="date"
        aria-label="Selected date"
        value={selectedDate}
        onChange={(event) => onDateChange(event.target.value)}
        className="date-input-compact h-8 shrink-0 border-slate-500 bg-slate-900 text-slate-100"
      />
      {teams.length > 1 ? (
        <select
          aria-label="Active team"
          data-testid="daily-allocation-team-selector"
          value={activeTeamId || ''}
          onChange={(event) => onTeamChange?.(event.target.value)}
          className="h-8 w-auto max-w-44 shrink-0 rounded-md border border-slate-500 bg-slate-900 px-2 text-sm text-slate-100"
        >
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      ) : null}

      {onJobSearchChange ? (
        <div className="relative w-36 max-w-72 shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
          <Input
            value={jobSearch || ''}
            onChange={(event) => onJobSearchChange(event.target.value)}
            placeholder="Search jobs"
            aria-label="Search jobs"
            className="h-9 border-slate-600 bg-slate-950 pl-8 text-slate-100"
          />
        </div>
      ) : null}

      {view === DAILY_ALLOCATION_BOARD_VIEWS.daily && onTimelineModeChange ? (
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Daily timeline display mode">
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
            onClick={() => onTimelineModeChange('fit')}
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
            onClick={() => onTimelineModeChange('scroll')}
          >
            <MoveHorizontal className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Scroll
          </Button>
        </div>
      ) : null}

      {onAddVisit ? (
        <Button
          type="button"
          className={cn(boardControlStyles.outline, 'min-h-9 shrink-0')}
          onClick={onAddVisit}
        >
          Add visit
        </Button>
      ) : null}
      {onAssign ? (
        <Button
          type="button"
          className={cn(boardControlStyles.outline, 'min-h-9 shrink-0')}
          disabled={assignDisabled}
          onClick={onAssign}
        >
          {assignLabel}
        </Button>
      ) : null}

      {latestPublicationLabel ? (
        <p className="max-w-52 shrink-0 truncate whitespace-nowrap text-xs text-slate-300" title={latestPublicationLabel}>
          {latestPublicationLabel}
        </p>
      ) : null}
      {onOpenHistory ? (
        <Button
          type="button"
          variant="ghost"
          className={cn(boardControlStyles.ghost, 'min-h-9 shrink-0')}
          onClick={onOpenHistory}
        >
          Publication history
        </Button>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <p
          className="whitespace-nowrap text-xs text-slate-300"
          aria-live="polite"
          data-testid="daily-allocation-board-status"
        >
          {feedback || 'Board ready'}
        </p>
        {publishDisabled && publishDisabledReason ? (
          <p
            id="daily-allocation-publish-reason"
            className="max-w-48 truncate text-xs text-slate-400"
            data-testid="daily-allocation-publish-reason"
            title={publishDisabledReason}
          >
            {publishDisabledReason}
          </p>
        ) : null}
        <Button
          className={cn(boardControlStyles.primary, 'min-h-9')}
          onClick={onPublish}
          disabled={publishDisabled || publishing}
          aria-describedby={publishDisabled && publishDisabledReason ? 'daily-allocation-publish-reason' : undefined}
          data-testid="daily-allocation-publish"
        >
          {publishing ? 'Publishing…' : 'Publish'}
        </Button>
      </div>
    </div>
  );
}
