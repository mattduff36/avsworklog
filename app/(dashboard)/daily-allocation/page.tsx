'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { addDays, format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { DailyAllocationBetaBadge } from '@/components/daily-allocation/DailyAllocationBetaBadge';
import { fetchDailyAllocationRuntime } from '@/lib/client/daily-allocation';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useModuleAccessLevel } from '@/lib/hooks/useModuleAccessLevel';
import { getDailyAllocationWeekRange } from '@/lib/utils/daily-allocation-timeline';

function tomorrowIso() {
  return format(addDays(new Date(), 1), 'yyyy-MM-dd');
}

const dailyAllocationBetaBadge = <DailyAllocationBetaBadge />;

function DailyAllocationLoading() {
  return (
    <AppPageLoadingShell
      title="Daily Allocation"
      titleMeta={dailyAllocationBetaBadge}
      message="Loading daily allocation..."
    />
  );
}

const LegacyDailyAllocationManager = dynamic(
  () => import('@/components/daily-allocation/LegacyDailyAllocationManager').then((mod) => ({
    default: mod.LegacyDailyAllocationManager,
  })),
  { ssr: false, loading: () => <DailyAllocationLoading /> },
);

const ProgressiveAllocationManager = dynamic(
  () => import('./ProgressiveAllocationManager').then((mod) => ({
    default: mod.ProgressiveAllocationManager,
  })),
  { ssr: false, loading: () => <DailyAllocationLoading /> },
);

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
    return <DailyAllocationLoading />;
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
    return <DailyAllocationLoading />;
  }

  if (runtimeQuery.data?.board_enabled !== true) {
    return <LegacyDailyAllocationManager />;
  }

  return (
    <ProgressiveAllocationManager
      startDate={week.start}
      endDate={week.end}
      selectedDate={selectedDate}
      onSelectedDateChange={setSelectedDate}
    />
  );
}
