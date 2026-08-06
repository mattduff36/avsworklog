'use client';

import { Suspense, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BookOpen, Calculator, FileSliders, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { PanelLoader } from '@/components/ui/panel-loader';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import {
  SensitiveModuleGate,
  SensitiveModuleSessionManager,
  useSensitiveModuleAccess,
} from '@/components/security/SensitiveModuleGate';
import { TimesheetTypeExceptionsCard } from './components/TimesheetTypeExceptionsCard';
import { PayrollRulesSettingsCard } from './components/PayrollRulesSettingsCard';

const SETTINGS_HELPER_TEXT_CLASS = 'text-sm leading-relaxed text-slate-400';

const RoleManagement = dynamic(
  () => import('@/components/admin/RoleManagement').then((module) => ({ default: module.RoleManagement })),
  { ssr: false, loading: () => <PanelLoader message="Loading permission management..." className="py-12" /> }
);

const PermissionsGuide = dynamic(
  () => import('@/components/admin/PermissionsGuide').then((module) => ({ default: module.PermissionsGuide })),
  { ssr: false, loading: () => <PanelLoader message="Loading permission guide..." className="py-12" /> }
);

type AdminSettingsTab = 'permissions' | 'permission-guide' | 'timesheets';

function isAdminSettingsTab(value: string | null): value is AdminSettingsTab {
  return value === 'permissions' || value === 'permission-guide' || value === 'timesheets';
}

function AdminSettingsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasPermission: canAccessSettings, loading: permissionLoading } = usePermissionCheck('admin-settings', false);
  const sensitiveAccess = useSensitiveModuleAccess('admin-settings', { enabled: canAccessSettings });
  const tabParam = searchParams.get('tab');
  const settingsTab: AdminSettingsTab = isAdminSettingsTab(tabParam) ? tabParam : 'permissions';

  useEffect(() => {
    if (!permissionLoading && !canAccessSettings) {
      router.push('/dashboard');
    }
  }, [canAccessSettings, permissionLoading, router]);

  useEffect(() => {
    if (!permissionLoading && canAccessSettings && !isAdminSettingsTab(tabParam)) {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set('tab', 'permissions');
      const nextQuery = nextParams.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    }
  }, [canAccessSettings, pathname, permissionLoading, router, searchParams, tabParam]);

  function handleSettingsTabChange(nextTab: AdminSettingsTab) {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('tab', nextTab);

    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }

  if (permissionLoading || sensitiveAccess.loading) {
    return (
      <AppPageLoadingShell
        title="Admin Settings"
        description="Configure admin-only tools, overrides, and system-level controls."
        icon={<SlidersHorizontal className="h-6 w-6" />}
        message="Loading admin settings..."
      />
    );
  }

  if (!canAccessSettings) {
    return null;
  }

  if (!sensitiveAccess.canAccess) {
    return (
      <AppPageShell width="wide">
        <SensitiveModuleGate moduleLabel="Admin Settings" access={sensitiveAccess} />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell width="wide">
      <SensitiveModuleSessionManager moduleLabel="Admin Settings" access={sensitiveAccess} />
      <div className="bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-start gap-3">
          <div className="shrink-0 p-3 bg-avs-yellow/20 rounded-lg">
            <SlidersHorizontal className="h-6 w-6 text-avs-yellow" />
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-white mb-2">Admin Settings</h1>
            <p className="text-muted-foreground">
              Configure admin-only tools, overrides, and system-level controls.
            </p>
          </div>
        </div>
      </div>

      <Tabs
        value={settingsTab}
        onValueChange={(value) => {
          if (isAdminSettingsTab(value)) handleSettingsTabChange(value);
        }}
      >
        <TabsList className="grid w-full max-w-2xl grid-cols-3">
          <TabsTrigger value="permissions" className="gap-2">
            <ShieldCheck className="h-4 w-4" />
            Permissions
          </TabsTrigger>
          <TabsTrigger value="permission-guide" className="gap-2">
            <BookOpen className="h-4 w-4" />
            Permission Guide
          </TabsTrigger>
          <TabsTrigger value="timesheets">Timesheets</TabsTrigger>
        </TabsList>

        <TabsContent value="permissions" className="space-y-6">
          <RoleManagement />
        </TabsContent>

        <TabsContent value="permission-guide" className="space-y-6">
          <PermissionsGuide />
        </TabsContent>

        <TabsContent value="timesheets" className="space-y-6">
          <Card className="overflow-hidden border-avs-yellow/25 bg-slate-900/80">
            <CardHeader className="border-b border-border bg-gradient-to-r from-avs-yellow/10 via-transparent to-transparent">
              <CardTitle className="text-white">Timesheet configuration</CardTitle>
              <CardDescription className={SETTINGS_HELPER_TEXT_CLASS}>
                Start with payroll rules and rollout assignments. Use timesheet overrides only when an
                individual needs a different form from their team default.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 pt-5 md:grid-cols-2">
              <a
                href="#payroll-rules"
                className="group rounded-lg border border-border bg-background/70 p-4 transition-colors hover:border-[hsl(var(--avs-yellow)/0.5)] hover:bg-[hsl(var(--avs-yellow)/0.05)]"
              >
                <div className="flex items-start gap-3">
                  <Calculator className="mt-0.5 h-5 w-5 shrink-0 text-avs-yellow" />
                  <div>
                    <p className="font-semibold text-foreground group-hover:text-[hsl(var(--avs-yellow))]">
                      Payroll rules and rollout
                    </p>
                    <p className={SETTINGS_HELPER_TEXT_CLASS}>
                      Configure drafts, test calculations, assign teams, and activate from a confirmed Sunday.
                    </p>
                  </div>
                </div>
              </a>
              <a
                href="#timesheet-overrides"
                className="group rounded-lg border border-border bg-background/70 p-4 transition-colors hover:border-sky-500/50 hover:bg-sky-500/5"
              >
                <div className="flex items-start gap-3">
                  <FileSliders className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" />
                  <div>
                    <p className="font-semibold text-foreground group-hover:text-sky-300">
                      Individual timesheet overrides
                    </p>
                    <p className={SETTINGS_HELPER_TEXT_CLASS}>
                      Change which timesheet form a specific employee uses without changing their team.
                    </p>
                  </div>
                </div>
              </a>
            </CardContent>
          </Card>
          <PayrollRulesSettingsCard />
          <TimesheetTypeExceptionsCard />
        </TabsContent>
      </Tabs>
    </AppPageShell>
  );
}

export default function AdminSettingsPage() {
  return (
    <Suspense
      fallback={(
        <AppPageLoadingShell
          title="Admin Settings"
          description="Configure admin-only tools, overrides, and system-level controls."
          icon={<SlidersHorizontal className="h-6 w-6" />}
          message="Loading admin settings..."
        />
      )}
    >
      <AdminSettingsContent />
    </Suspense>
  );
}
