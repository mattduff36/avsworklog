'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BellRing, CheckCircle2, ClipboardList, EyeOff, Settings } from 'lucide-react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import {
  FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY,
  getReminderOverviewTab,
  INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY,
  isReminderCategoryTabId,
  isReminderDailyCheckTabId,
  isValidReminderOverviewTabId,
  PLANT_LEGACY_MISSING_SITE_WORKFLOW_KEY,
  REMINDER_CATEGORY_TABS,
  REMINDER_DAILY_CHECK_TABS,
  type ReminderOverviewTabConfig,
} from '@/lib/config/reminder-workflows';
import { YardTransfersPanel } from './components/YardTransfersPanel';
import {
  buildActionsSummaryStats,
  EMPTY_ACTIONS_SUMMARY,
  type ActionsSummaryStats,
} from '@/lib/utils/actions-summary';
import type { ReminderActionWithAsset } from '@/types/reminders';
import { ActionedActionsPanel } from './components/ActionedActionsPanel';
import { ActionsOverviewPanel } from './components/ActionsOverviewPanel';
import { ActionsSettingsTab } from './components/ActionsSettingsTab';
import { ActionsSummaryCards } from './components/ActionsSummaryCards';
import { IgnoredActionsPanel } from './components/IgnoredActionsPanel';

const tabTriggerClassName = 'gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900';

const ACTIONS_ARCHIVE_TABS = [
  {
    id: 'ignored-reminders',
    label: 'Ignored',
    icon: EyeOff,
  },
  {
    id: 'actioned-reminders',
    label: 'Actioned',
    icon: CheckCircle2,
  },
] as const;

type ActionsArchiveTabId = (typeof ACTIONS_ARCHIVE_TABS)[number]['id'];
type ActionsDailyCheckTabId = string | ActionsArchiveTabId;
type ActionsPageTabId = 'overview' | 'settings' | (typeof REMINDER_CATEGORY_TABS)[number]['id'];

function isActionsArchiveTabId(value: string): value is ActionsArchiveTabId {
  return ACTIONS_ARCHIVE_TABS.some((tab) => tab.id === value);
}

function isValidActionsOverviewTabId(value: string): boolean {
  return isValidReminderOverviewTabId(value) || isActionsArchiveTabId(value);
}

function getActionsPageTab(requestedTab: string, canManage: boolean): ActionsPageTabId {
  if (requestedTab === 'settings' && canManage) return 'settings';
  if (isReminderCategoryTabId(requestedTab)) return requestedTab;
  return 'overview';
}

function getActionsDailyCheckTab(requestedTab: string): ActionsDailyCheckTabId {
  if (isReminderDailyCheckTabId(requestedTab) || isActionsArchiveTabId(requestedTab)) {
    return requestedTab;
  }

  return REMINDER_DAILY_CHECK_TABS[0]?.id || 'vans';
}

function ActionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isManager, isAdmin, loading: authLoading } = useAuth();
  const { hasPermission: canViewActions, loading: actionsPermissionLoading } = usePermissionCheck('actions', false);

  const canManage = isManager || isAdmin;
  const [refreshToken, setRefreshToken] = useState(0);
  const [summaryRefreshToken, setSummaryRefreshToken] = useState(0);
  const [summary, setSummary] = useState<ActionsSummaryStats>(EMPTY_ACTIONS_SUMMARY);
  const requestedTab = searchParams.get('tab') || 'vans';
  const pageTab = getActionsPageTab(requestedTab, canManage);
  const dailyCheckTab = getActionsDailyCheckTab(requestedTab);
  const lastDailyCheckTabRef = useRef<ActionsDailyCheckTabId>(dailyCheckTab);
  const activeDailyCheckTab = getReminderOverviewTab(dailyCheckTab);

  if (isReminderDailyCheckTabId(requestedTab) || isActionsArchiveTabId(requestedTab)) {
    lastDailyCheckTabRef.current = requestedTab;
  }

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

    if (isValidActionsOverviewTabId(requestedTab)) {
      return;
    }

    router.replace('/actions?tab=vans', { scroll: false });
  }, [authLoading, actionsPermissionLoading, canManage, canViewActions, requestedTab, router]);

  const loadSummary = useCallback(async () => {
    if (authLoading || actionsPermissionLoading || !canViewActions) {
      return;
    }

    try {
      const [fleetResponse, legacyResponse, yardResponse] = await Promise.all([
        fetch(`/api/actions?${new URLSearchParams({
          status: 'open',
          workflow: FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY,
          ensure_fresh: 'true',
        }).toString()}`, { cache: 'no-store' }),
        fetch(`/api/actions?${new URLSearchParams({
          status: 'open',
          workflow: PLANT_LEGACY_MISSING_SITE_WORKFLOW_KEY,
        }).toString()}`, { cache: 'no-store' }),
        fetch(`/api/actions?${new URLSearchParams({
          status: 'open',
          workflow: INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY,
        }).toString()}`, { cache: 'no-store' }),
      ]);
      const [fleetPayload, legacyPayload, yardPayload] = await Promise.all([
        fleetResponse.json(),
        legacyResponse.json(),
        yardResponse.json(),
      ]);
      if (!fleetResponse.ok) {
        throw new Error(fleetPayload.error || 'Failed to load actions summary');
      }
      if (!legacyResponse.ok) {
        throw new Error(legacyPayload.error || 'Failed to load actions summary');
      }
      if (!yardResponse.ok) {
        throw new Error(yardPayload.error || 'Failed to load actions summary');
      }

      setSummary(buildActionsSummaryStats([
        ...((fleetPayload.actions || []) as ReminderActionWithAsset[]),
        ...((legacyPayload.actions || []) as ReminderActionWithAsset[]),
        ...((yardPayload.actions || []) as ReminderActionWithAsset[]),
      ]));
    } catch (error) {
      console.error(error);
      setSummary(EMPTY_ACTIONS_SUMMARY);
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

    if (isReminderCategoryTabId(value)) {
      router.push(`/actions?tab=${value}`, { scroll: false });
      return;
    }

    router.push(`/actions?tab=${lastDailyCheckTabRef.current}`, { scroll: false });
  }

  function handleDailyCheckTabChange(value: string) {
    router.push(`/actions?tab=${value}`, { scroll: false });
  }

  function handleSettingsSaved() {
    setRefreshToken((current) => current + 1);
    setSummaryRefreshToken((current) => current + 1);
  }

  function handleActionsChanged() {
    setSummaryRefreshToken((current) => current + 1);
  }

  function renderDailyCheckContent() {
    if (dailyCheckTab === 'ignored-reminders') {
      return <IgnoredActionsPanel onRestored={handleSettingsSaved} />;
    }

    if (dailyCheckTab === 'actioned-reminders') {
      return <ActionedActionsPanel />;
    }

    if (!activeDailyCheckTab) return null;

    return (
      <ActionsOverviewPanel
        key={activeDailyCheckTab.id}
        tab={activeDailyCheckTab}
        refreshToken={refreshToken}
        onActionsChanged={handleActionsChanged}
      />
    );
  }

  function renderCategoryContent(tab: ReminderOverviewTabConfig) {
    if (tab.workflowKey === INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY) {
      return (
        <YardTransfersPanel
          refreshToken={refreshToken}
          onActionsChanged={handleActionsChanged}
        />
      );
    }

    return (
      <ActionsOverviewPanel
        key={tab.id}
        tab={tab}
        refreshToken={refreshToken}
        onActionsChanged={handleActionsChanged}
      />
    );
  }

  if (actionsPermissionLoading || authLoading) {
    return (
      <AppPageLoadingShell
        title="Actions"
        description="Generated actions that managers and admins can assign as employee reminders."
        icon={<BellRing className="h-5 w-5" />}
        message="Loading actions..."
        accent="brand"
        width="wide"
      />
    );
  }

  if (!canViewActions) {
    return (
      <AppPageLoadingShell
        title="Actions"
        description="Generated actions that managers and admins can assign as employee reminders."
        icon={<BellRing className="h-5 w-5" />}
        message="Redirecting..."
        accent="brand"
        width="wide"
      />
    );
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
        <TabsList>
          <TabsTrigger value="overview" className={tabTriggerClassName}>
            <ClipboardList className="h-4 w-4" />
            Daily Checks
          </TabsTrigger>
          {REMINDER_CATEGORY_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.id} value={tab.id} className={tabTriggerClassName}>
                <Icon className="h-4 w-4" />
                {tab.label}
              </TabsTrigger>
            );
          })}
          {canManage ? (
            <TabsTrigger value="settings" className={tabTriggerClassName}>
              <Settings className="h-4 w-4" />
              Settings
            </TabsTrigger>
          ) : null}
        </TabsList>

        {pageTab === 'overview' ? (
          <div className="mt-3 flex justify-end">
            <Tabs value={dailyCheckTab} onValueChange={handleDailyCheckTabChange}>
              <TabsList>
                {REMINDER_DAILY_CHECK_TABS.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <TabsTrigger key={tab.id} value={tab.id} className={tabTriggerClassName}>
                      <Icon className="h-4 w-4" />
                      {tab.label}
                    </TabsTrigger>
                  );
                })}
                {ACTIONS_ARCHIVE_TABS.map((tab, index) => {
                  const Icon = tab.icon;
                  return (
                    <TabsTrigger
                      key={tab.id}
                      value={tab.id}
                      className={`${tabTriggerClassName} ${index === 0 ? 'ml-3' : ''}`}
                    >
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
          {renderDailyCheckContent()}
        </TabsContent>

        {REMINDER_CATEGORY_TABS.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="mt-0 space-y-6">
            {renderCategoryContent(tab)}
          </TabsContent>
        ))}

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
    <Suspense
      fallback={(
        <AppPageLoadingShell
          title="Actions"
          description="Generated actions that managers and admins can assign as employee reminders."
          icon={<BellRing className="h-5 w-5" />}
          message="Loading actions..."
          accent="brand"
          width="wide"
        />
      )}
    >
      <ActionsContent />
    </Suspense>
  );
}
