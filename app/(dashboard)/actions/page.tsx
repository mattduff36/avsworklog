'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BellRing, ClipboardList, Settings } from 'lucide-react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { PageLoader } from '@/components/ui/page-loader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import {
  getReminderOverviewTab,
  isValidReminderOverviewTabId,
  REMINDER_OVERVIEW_TABS,
} from '@/lib/config/reminder-workflows';
import { getReminderAssignmentFilterValue, isReminderActionActive } from '@/lib/utils/reminder-action-filters';
import type { ReminderActionWithAsset } from '@/types/reminders';
import { ActionsOverviewPanel } from './components/ActionsOverviewPanel';
import { ActionsSettingsTab } from './components/ActionsSettingsTab';
import { ActionsSummaryCards, type ActionsSummaryStats } from './components/ActionsSummaryCards';

const EMPTY_SUMMARY: ActionsSummaryStats = {
  openActions: 0,
  pendingReminders: 0,
  unassigned: 0,
};

const tabTriggerClassName = 'gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900';

function buildSummaryStats(actions: ReminderActionWithAsset[]): ActionsSummaryStats {
  return actions.filter(isReminderActionActive).reduce(
    (stats, action) => {
      stats.openActions += 1;
      stats.pendingReminders += action.reminders_count.pending;
      if (getReminderAssignmentFilterValue(action) === 'unassigned') {
        stats.unassigned += 1;
      }
      return stats;
    },
    { ...EMPTY_SUMMARY },
  );
}

function ActionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isManager, isAdmin, loading: authLoading } = useAuth();
  const { hasPermission: canViewActions, loading: actionsPermissionLoading } = usePermissionCheck('actions', false);

  const canManage = isManager || isAdmin;
  const [refreshToken, setRefreshToken] = useState(0);
  const [summaryRefreshToken, setSummaryRefreshToken] = useState(0);
  const [summary, setSummary] = useState<ActionsSummaryStats>(EMPTY_SUMMARY);
  const requestedTab = searchParams.get('tab') || 'vans';
  const pageTab: 'overview' | 'settings' = requestedTab === 'settings' && canManage ? 'settings' : 'overview';
  const overviewTab = isValidReminderOverviewTabId(requestedTab) ? requestedTab : REMINDER_OVERVIEW_TABS[0]?.id || 'vans';

  const activeOverviewTab = useMemo(
    () => getReminderOverviewTab(overviewTab) || REMINDER_OVERVIEW_TABS[0],
    [overviewTab],
  );

  useEffect(() => {
    if (!actionsPermissionLoading && !canViewActions) {
      router.replace('/dashboard');
    }
  }, [actionsPermissionLoading, canViewActions, router]);

  useEffect(() => {
    if (authLoading || actionsPermissionLoading || !canViewActions) {
      return;
    }

    if (requestedTab === 'settings') {
      if (!canManage) {
        router.replace('/actions?tab=vans', { scroll: false });
      }
      return;
    }

    if (isValidReminderOverviewTabId(requestedTab)) {
      return;
    }

    router.replace('/actions?tab=vans', { scroll: false });
  }, [authLoading, actionsPermissionLoading, canManage, canViewActions, requestedTab, router]);

  const loadSummary = useCallback(async () => {
    if (authLoading || actionsPermissionLoading || !canViewActions) {
      return;
    }

    try {
      const searchParams = new URLSearchParams({ status: 'open' });
      const response = await fetch(`/api/actions?${searchParams.toString()}`, {
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load actions summary');
      }

      setSummary(buildSummaryStats((payload.actions || []) as ReminderActionWithAsset[]));
    } catch (error) {
      console.error(error);
      setSummary(EMPTY_SUMMARY);
    }
  }, [authLoading, actionsPermissionLoading, canViewActions]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary, refreshToken, summaryRefreshToken]);

  function handlePageTabChange(value: string) {
    if (value === 'settings') {
      router.push('/actions?tab=settings', { scroll: false });
      return;
    }

    router.push(`/actions?tab=${overviewTab}`, { scroll: false });
  }

  function handleOverviewTabChange(value: string) {
    router.push(`/actions?tab=${value}`, { scroll: false });
  }

  function handleSettingsSaved() {
    setRefreshToken((current) => current + 1);
    setSummaryRefreshToken((current) => current + 1);
  }

  function handleActionsChanged() {
    setSummaryRefreshToken((current) => current + 1);
  }

  if (actionsPermissionLoading || authLoading) {
    return <PageLoader message="Loading actions..." />;
  }

  if (!canViewActions) {
    return <PageLoader message="Redirecting..." />;
  }

  return (
    <AppPageShell width="wide">
      <AppPageHeader
        title="Actions"
        description="Generated actions that managers and admins can assign as employee reminders."
        icon={<BellRing className="h-5 w-5" />}
      />

      <ActionsSummaryCards summary={summary} />

      <Tabs value={pageTab} onValueChange={handlePageTabChange}>
        {canManage ? (
          <TabsList>
            <TabsTrigger value="overview" className={tabTriggerClassName}>
              <ClipboardList className="h-4 w-4" />
              Daily Checks
            </TabsTrigger>
            <TabsTrigger value="settings" className={tabTriggerClassName}>
              <Settings className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>
        ) : null}

        {pageTab === 'overview' ? (
          <div className="mt-3 flex justify-end">
            <Tabs value={overviewTab} onValueChange={handleOverviewTabChange}>
              <TabsList>
                {REMINDER_OVERVIEW_TABS.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <TabsTrigger key={tab.id} value={tab.id} className={tabTriggerClassName}>
                      <Icon className="h-4 w-4" />
                      {tab.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </div>
        ) : null}

        <TabsContent value="overview" className="mt-0 space-y-6">
          {activeOverviewTab ? (
            <ActionsOverviewPanel
              key={activeOverviewTab.id}
              tab={activeOverviewTab}
              refreshToken={refreshToken}
              onActionsChanged={handleActionsChanged}
            />
          ) : null}
        </TabsContent>

        {canManage ? (
          <TabsContent value="settings" className="mt-0 space-y-6">
            <ActionsSettingsTab onSaved={handleSettingsSaved} />
          </TabsContent>
        ) : null}
      </Tabs>
    </AppPageShell>
  );
}

export default function ActionsPage() {
  return (
    <Suspense fallback={<PageLoader message="Loading actions..." />}>
      <ActionsContent />
    </Suspense>
  );
}
