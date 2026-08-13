'use client';

import { useState } from 'react';
import { addDays, format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { DailyAllocationBetaBadge } from '@/components/daily-allocation/DailyAllocationBetaBadge';
import { LegacyDailyAllocationManager } from '@/components/daily-allocation/LegacyDailyAllocationManager';
import { DailyAllocationBoardStateProvider } from '@/components/daily-allocation/board/hooks/use-daily-allocation-board';
import { DailyAllocationManagerBoard } from '@/components/daily-allocation/board/DailyAllocationManagerBoard';
import { fetchDailyAllocationRuntime } from '@/lib/client/daily-allocation';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useModuleAccessLevel } from '@/lib/hooks/useModuleAccessLevel';
import { getDailyAllocationWeekRange } from '@/lib/utils/daily-allocation-timeline';

function tomorrowIso() {
  return format(addDays(new Date(), 1), 'yyyy-MM-dd');
}

const dailyAllocationBetaBadge = <DailyAllocationBetaBadge />;

export default function DailyAllocationBoardPage() {
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('daily-allocation');
  const { canUseLevel, isLoading: levelLoading } = useModuleAccessLevel('daily-allocation');
  const [selectedDate, setSelectedDate] = useState(tomorrowIso);
  const week = getDailyAllocationWeekRange(selectedDate);
  const canManage = canUseLevel(4);
  const runtimeQuery = useQuery({
    queryKey: ['daily-allocation-runtime'],
    queryFn: fetchDailyAllocationRuntime,
    enabled: hasPermission && canManage && !permissionLoading && !levelLoading,
    retry: false,
  });

  if (permissionLoading || levelLoading) {
    return (
      <AppPageLoadingShell
        title="Daily Allocation"
        titleMeta={dailyAllocationBetaBadge}
        message="Loading daily allocation..."
      />
    );
  }

  if (!hasPermission) {
    return (
      <AppPageShell>
        <AppPageHeader
          title="Daily Allocation"
          titleMeta={dailyAllocationBetaBadge}
          description="This module is not enabled for your team. During deployment it remains unavailable until post-deploy activation is complete."
        />
      </AppPageShell>
    );
  }

  if (!canManage) {
    return (
      <AppPageShell>
        <AppPageHeader
          title="Daily Allocation"
          titleMeta={dailyAllocationBetaBadge}
          description="Level 4 manager access is required to plan this board."
        />
      </AppPageShell>
    );
  }

  if (runtimeQuery.isLoading) {
    return (
      <AppPageLoadingShell
        title="Daily Allocation"
        titleMeta={dailyAllocationBetaBadge}
        message="Loading daily allocation..."
      />
    );
  }

  if (runtimeQuery.data?.board_enabled !== true) {
    return <LegacyDailyAllocationManager />;
  }

  return (
    <DailyAllocationBoardStateProvider
      startDate={week.start}
      endDate={week.end}
      selectedDate={selectedDate}
    >
      <DailyAllocationManagerBoard onSelectedDateChange={setSelectedDate} />
    </DailyAllocationBoardStateProvider>
  );
}
