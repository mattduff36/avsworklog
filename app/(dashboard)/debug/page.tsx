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
import { Bug, Car, Clock, Database, History, RefreshCw, Send, ShieldAlert, Users } from 'lucide-react';
import { toast } from 'sonner';
import { canAccessDebugConsole } from '@/lib/utils/debug-access';
import { DebugInfo } from './types';

const AuditLogDebugPanel = dynamic(() => import('./components/AuditLogDebugPanel').then((mod) => ({ default: mod.AuditLogDebugPanel })));
const DVLASyncDebugPanel = dynamic(() => import('./components/DVLASyncDebugPanel').then((mod) => ({ default: mod.DVLASyncDebugPanel })));
const ErrorLogsDebugPanel = dynamic(() => import('./components/ErrorLogsDebugPanel').then((mod) => ({ default: mod.ErrorLogsDebugPanel })));
const NotificationSettingsDebugPanel = dynamic(() => import('./components/NotificationSettingsDebugPanel').then((mod) => ({ default: mod.NotificationSettingsDebugPanel })));
const TestFleetDebugPanel = dynamic(() => import('./components/TestFleetDebugPanel').then((mod) => ({ default: mod.TestFleetDebugPanel })));
const UIModalStylesDebugPanel = dynamic(() => import('./components/UIModalStylesDebugPanel').then((mod) => ({ default: mod.UIModalStylesDebugPanel })));

type DebugTab = 'error-log' | 'audit-log' | 'dvla-sync' | 'test-fleet' | 'notification-settings' | 'modal-styles';

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
  'modal-styles': 'modal-styles',
};

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

  const debugInfo: DebugInfo = {
    environment: process.env.NODE_ENV || 'development',
    buildTime: new Date().toISOString(),
    nodeVersion: typeof process !== 'undefined' ? process.version : 'N/A',
    nextVersion: '15.5.6',
  };

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
      <div className="bg-gradient-to-r from-red-500 to-orange-500 rounded-lg p-6 text-white">
        <div className="flex items-center gap-3">
          <Bug className="h-6 md:h-8 w-6 md:w-8" />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold mb-1 md:mb-2">SuperAdmin Debug Console</h1>
            <p className="text-sm md:text-base text-red-100">Developer tools and system information</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 md:gap-4">
        <Card>
          <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
            <CardDescription className="text-xs md:text-sm text-muted-foreground flex items-center gap-1 md:gap-2">
              <Database className="h-3 md:h-4 w-3 md:w-4 text-blue-500" />
              <span className="hidden md:inline">Environment</span>
              <span className="md:hidden">Env</span>
            </CardDescription>
            <CardTitle className="text-base md:text-2xl font-bold text-foreground truncate">{debugInfo.environment}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
            <CardDescription className="text-xs md:text-sm text-muted-foreground flex items-center gap-1 md:gap-2">
              <Users className="h-3 md:h-4 w-3 md:w-4 text-green-500" />
              <span className="hidden md:inline">Logged In</span>
              <span className="md:hidden">User</span>
            </CardDescription>
            <CardTitle className="text-xs md:text-lg font-bold text-foreground truncate">{profile.full_name}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
            <CardDescription className="text-xs md:text-sm text-muted-foreground flex items-center gap-1 md:gap-2">
              <ShieldAlert className="h-3 md:h-4 w-3 md:w-4 text-red-500" />
              <span className="hidden md:inline">Access</span>
              <span className="md:hidden">Role</span>
            </CardDescription>
            <CardTitle className="text-xs md:text-base font-bold text-red-600 dark:text-red-400">Debug Access</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
            <CardDescription className="text-xs md:text-sm text-muted-foreground flex items-center gap-1 md:gap-2">
              <Clock className="h-3 md:h-4 w-3 md:w-4 text-purple-500" />
              <span className="hidden md:inline">Next.js</span>
              <span className="md:hidden">Ver</span>
            </CardDescription>
            <CardTitle className="text-base md:text-2xl font-bold text-foreground">{debugInfo.nextVersion}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => handleTabChange(value as DebugTab)} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 md:grid-cols-6 gap-1 md:gap-0 h-auto md:h-10 p-1">
          <TabsTrigger value="error-log" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <Bug className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">Error Log</span>
            <span className="md:hidden data-[state=active]:inline hidden">Errors</span>
          </TabsTrigger>
          <TabsTrigger value="audit-log" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <History className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">Audit Log</span>
            <span className="md:hidden data-[state=active]:inline hidden">Audit</span>
          </TabsTrigger>
          <TabsTrigger value="dvla-sync" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <RefreshCw className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">DVLA Sync</span>
            <span className="md:hidden data-[state=active]:inline hidden">DVLA</span>
          </TabsTrigger>
          <TabsTrigger value="test-fleet" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <Car className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">Test Fleet</span>
            <span className="md:hidden data-[state=active]:inline hidden">Fleet</span>
          </TabsTrigger>
          <TabsTrigger value="notification-settings" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <Send className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">Notification Settings</span>
            <span className="md:hidden data-[state=active]:inline hidden">Notifs</span>
          </TabsTrigger>
          <TabsTrigger value="modal-styles" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <span className="hidden md:inline">Modal Styles</span>
            <span className="md:hidden data-[state=active]:inline hidden">Modals</span>
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

        <TabsContent value="modal-styles">
          <UIModalStylesDebugPanel />
        </TabsContent>
      </Tabs>
    </AppPageShell>
  );
}
