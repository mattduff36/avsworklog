'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter, useSearchParams } from 'next/navigation';
import { useBrowserSupabaseClient } from '@/lib/hooks/useBrowserSupabaseClient';
import { AppPageShell } from '@/components/layout/AppPageShell';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bug, Car, History, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { canAccessDebugConsole } from '@/lib/utils/debug-access';

const AuditLogDebugPanel = dynamic(() => import('./components/AuditLogDebugPanel').then((mod) => ({ default: mod.AuditLogDebugPanel })));
const DVLASyncDebugPanel = dynamic(() => import('./components/DVLASyncDebugPanel').then((mod) => ({ default: mod.DVLASyncDebugPanel })));
const ErrorLogsDebugPanel = dynamic(() => import('./components/ErrorLogsDebugPanel').then((mod) => ({ default: mod.ErrorLogsDebugPanel })));
const NotificationSettingsDebugPanel = dynamic(() => import('./components/NotificationSettingsDebugPanel').then((mod) => ({ default: mod.NotificationSettingsDebugPanel })));
const TestFleetDebugPanel = dynamic(() => import('./components/TestFleetDebugPanel').then((mod) => ({ default: mod.TestFleetDebugPanel })));

type DebugTab = 'error-log' | 'audit-log' | 'dvla-sync' | 'test-fleet' | 'notification-settings';

const DEBUG_TAB_ALIASES: Record<string, DebugTab> = {
  errors: 'error-log',
  'error-log': 'error-log',
  audit: 'audit-log',
  'audit-log': 'audit-log',
  dvla: 'dvla-sync',
  'dvla-sync': 'dvla-sync',
  'test-fleet': 'test-fleet',
  notifications: 'notification-settings',
  'notification-settings': 'notification-settings',
};

const tabTriggerClassName = 'gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground';

export default function DebugPage() {
  const { profile, loading: authLoading, isActualSuperAdmin, isViewingAs } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useBrowserSupabaseClient();

  const canAccessDebugTools = canAccessDebugConsole({
    email: profile?.email,
    isActualSuperAdmin,
    isViewingAs,
  });

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!profile) {
      router.push('/login');
      return;
    }

    if (!canAccessDebugTools) {
      toast.error('Access denied: Debug tools access required');
      router.push('/dashboard');
      return;
    }
  }, [authLoading, canAccessDebugTools, profile, router]);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    const normalizedTab = requestedTab ? DEBUG_TAB_ALIASES[requestedTab] : 'error-log';

    if (!normalizedTab || requestedTab !== normalizedTab) {
      router.replace(`/debug?tab=${normalizedTab || 'error-log'}`, { scroll: false });
    }
  }, [searchParams, router]);

  const requestedTab = searchParams.get('tab');
  const activeTab = (requestedTab ? DEBUG_TAB_ALIASES[requestedTab] : 'error-log') || 'error-log';

  function handleTabChange(value: DebugTab) {
    router.replace(`/debug?tab=${value}`, { scroll: false });
  }

  if (authLoading || !supabase) {
    return <PageLoader message="Loading debug tools..." />;
  }

  if (!profile || !canAccessDebugTools) {
    return (
      <AppPageShell>
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-foreground">Access denied</CardTitle>
            <CardDescription>
              Super admin permission is required to access debug tools.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell width="wide">
      <div className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 p-6 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <Bug className="h-6 w-6 md:h-8 md:w-8" />
          <div>
            <h1 className="mb-1 text-2xl font-bold md:mb-2 md:text-3xl">SuperAdmin Debug Console</h1>
            <p className="text-sm text-red-50 md:text-base">Developer tools and operational diagnostics</p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as DebugTab)} className="space-y-6">
        <TabsList className="h-auto flex-wrap justify-start gap-0 p-1.5">
          <TabsTrigger value="error-log" className={tabTriggerClassName}>
            <Bug className="h-4 w-4 flex-shrink-0" />
            Error Log
          </TabsTrigger>
          <TabsTrigger value="audit-log" className={tabTriggerClassName}>
            <History className="h-4 w-4 flex-shrink-0" />
            Audit Log
          </TabsTrigger>
          <TabsTrigger value="dvla-sync" className={tabTriggerClassName}>
            <RefreshCw className="h-4 w-4 flex-shrink-0" />
            DVLA Sync
          </TabsTrigger>
          <TabsTrigger value="test-fleet" className={tabTriggerClassName}>
            <Car className="h-4 w-4 flex-shrink-0" />
            Test Fleet
          </TabsTrigger>
          <TabsTrigger value="notification-settings" className={tabTriggerClassName}>
            <Send className="h-4 w-4 flex-shrink-0" />
            Notification Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="error-log">
          <ErrorLogsDebugPanel />
        </TabsContent>

        <TabsContent value="audit-log">
          <AuditLogDebugPanel supabase={supabase} />
        </TabsContent>

        <TabsContent value="dvla-sync">
          <DVLASyncDebugPanel />
        </TabsContent>

        <TabsContent value="test-fleet">
          <TestFleetDebugPanel />
        </TabsContent>

        <TabsContent value="notification-settings">
          <NotificationSettingsDebugPanel />
        </TabsContent>

      </Tabs>
    </AppPageShell>
  );
}
