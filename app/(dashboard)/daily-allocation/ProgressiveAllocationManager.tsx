'use client';

import { DailyAllocationBoardStateProvider } from '@/components/daily-allocation/board/hooks/use-daily-allocation-board';
import { DailyAllocationManagerBoard } from '@/components/daily-allocation/board/DailyAllocationManagerBoard';
import { DailyAllocationUnsupportedWidthMessage } from '@/components/daily-allocation/board/DailyAllocationViewportFit';

export function ProgressiveAllocationManager({
  startDate,
  endDate,
  selectedDate,
  onSelectedDateChange,
}: {
  startDate: string;
  endDate: string;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
}) {
  return (
    <>
      <div className="md:hidden">
        <DailyAllocationUnsupportedWidthMessage />
      </div>
      <div className="hidden min-h-0 md:flex md:flex-1 md:flex-col">
        <DailyAllocationBoardStateProvider
          startDate={startDate}
          endDate={endDate}
          selectedDate={selectedDate}
        >
          <DailyAllocationManagerBoard onSelectedDateChange={onSelectedDateChange} />
        </DailyAllocationBoardStateProvider>
      </div>
    </>
  );
}
