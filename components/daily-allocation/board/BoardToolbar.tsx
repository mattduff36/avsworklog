'use client';

import { addDays, format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import {
  DAILY_ALLOCATION_BOARD_VIEWS,
  type DailyAllocationBoardView,
} from '@/lib/config/daily-allocation-view-preference';
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
  onPublish: () => void;
  publishDisabled?: boolean;
  publishing?: boolean;
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  statusMessage?: string;
  teams?: Array<{ id: string; name: string }>;
  activeTeamId?: string | null;
  onTeamChange?: (teamId: string) => void;
}

export function BoardToolbar({
  selectedDate,
  view,
  onDateChange,
  onViewChange,
  onPublish,
  publishDisabled,
  publishing,
  isLoading,
  isFetching,
  isStale,
  statusMessage,
  teams = [],
  activeTeamId,
  onTeamChange,
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

  const feedback = [
    isLoading ? 'Loading board' : null,
    !isLoading && isFetching ? 'Refreshing' : null,
    isStale ? 'Board may be stale' : null,
    statusMessage,
  ].filter(Boolean).join('. ');

  return (
    <div
      className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"
      data-testid="daily-allocation-toolbar"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={view} onValueChange={handleViewChange}>
          <TabsList aria-label="Allocation date range" className="grid h-9 grid-cols-2 gap-0 p-1">
            <TabsTrigger value={DAILY_ALLOCATION_BOARD_VIEWS.daily} className="px-3">
              Daily
            </TabsTrigger>
            <TabsTrigger value={DAILY_ALLOCATION_BOARD_VIEWS.weekly} className="px-3">
              Weekly
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
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
            className="min-w-44 text-center text-sm font-semibold text-slate-100"
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
          <Input
            type="date"
            aria-label="Selected date"
            value={selectedDate}
            onChange={(event) => onDateChange(event.target.value)}
            className="h-8 w-auto border-slate-500 bg-slate-900 text-slate-100"
          />
          {teams.length > 1 ? (
            <select
              aria-label="Active team"
              data-testid="daily-allocation-team-selector"
              value={activeTeamId || ''}
              onChange={(event) => onTeamChange?.(event.target.value)}
              className="h-8 max-w-44 rounded-md border border-slate-500 bg-slate-900 px-2 text-sm text-slate-100"
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p
          className="text-xs text-slate-300"
          aria-live="polite"
          data-testid="daily-allocation-board-status"
        >
          {feedback || 'Board ready'}
        </p>
        <Button
          className={cn(boardControlStyles.primary, 'min-h-9')}
          onClick={onPublish}
          disabled={publishDisabled || publishing}
          data-testid="daily-allocation-publish"
        >
          {publishing ? 'Publishing…' : 'Publish'}
        </Button>
      </div>
    </div>
  );
}
