'use client';

import { addDays, format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { boardControlStyles } from '@/components/daily-allocation/board/board-control-styles';
import {
  DAILY_ALLOCATION_BOARD_PRIMARIES,
  type DailyAllocationBoardPrimary,
} from '@/lib/config/daily-allocation-primary-preference';
import {
  DAILY_ALLOCATION_BOARD_VIEWS,
  type DailyAllocationBoardView,
} from '@/lib/config/daily-allocation-view-preference';
import {
  formatDailyAllocationDate,
  getDailyAllocationWeekRange,
} from '@/lib/utils/daily-allocation-timeline';

interface BoardDateRangeControlsProps {
  selectedDate: string;
  view: DailyAllocationBoardView;
  onDateChange: (date: string) => void;
  onViewChange: (view: DailyAllocationBoardView) => void;
  primary: DailyAllocationBoardPrimary;
  onPrimaryChange?: (primary: DailyAllocationBoardPrimary) => void;
}

export function BoardDateRangeControls({
  selectedDate,
  view,
  onDateChange,
  onViewChange,
  primary,
  onPrimaryChange,
}: BoardDateRangeControlsProps) {
  const selected = parseISO(selectedDate);
  const week = getDailyAllocationWeekRange(selectedDate);
  const periodLabel =
    view === DAILY_ALLOCATION_BOARD_VIEWS.daily
      ? format(selected, 'EEE d MMM yyyy')
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

  return (
    <div className="flex shrink-0 flex-nowrap items-center gap-2">
      <Tabs value={view} onValueChange={handleViewChange}>
        <TabsList aria-label="Allocation date range" className="grid h-9 grid-cols-2">
          <TabsTrigger value={DAILY_ALLOCATION_BOARD_VIEWS.daily} className="px-3">
            Daily
          </TabsTrigger>
          <TabsTrigger value={DAILY_ALLOCATION_BOARD_VIEWS.weekly} className="px-3">
            Weekly
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs value={primary} onValueChange={handlePrimaryChange}>
        <TabsList
          aria-label="Board primary resource"
          className="grid h-9 grid-cols-3"
          data-testid="daily-allocation-primary-tabs"
        >
          <TabsTrigger
            value={DAILY_ALLOCATION_BOARD_PRIMARIES.job}
            className="px-3"
            aria-label="Primary Jobs"
          >
            Jobs
          </TabsTrigger>
          <TabsTrigger
            value={DAILY_ALLOCATION_BOARD_PRIMARIES.employee}
            className="px-3"
            aria-label="Primary Employees"
          >
            Employees
          </TabsTrigger>
          <TabsTrigger
            value={DAILY_ALLOCATION_BOARD_PRIMARIES.plant}
            className="px-3"
            aria-label="Primary Plant"
          >
            Plant
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-nowrap items-center gap-2">
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
        <div className="relative w-fit whitespace-nowrap text-center text-sm font-semibold text-foreground">
          <span aria-live="polite" data-testid="daily-allocation-period-label">
            {periodLabel}
          </span>
          <Input
            type="date"
            aria-label="Selected date"
            value={selectedDate}
            onChange={(event) => onDateChange(event.target.value)}
            className="date-input-compact date-input-overlay absolute inset-0 cursor-pointer opacity-0"
          />
        </div>
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
    </div>
  );
}
