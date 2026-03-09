'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bug, Car, Clock, Database, History, Loader2, RefreshCw, Send, ShieldAlert, Users } from 'lucide-react';
import { toast } from 'sonner';
import { AuditLogDebugPanel } from './components/AuditLogDebugPanel';
import { DVLASyncDebugPanel } from './components/DVLASyncDebugPanel';
import { ErrorLogsDebugPanel } from './components/ErrorLogsDebugPanel';
import { NotificationSettingsDebugPanel } from './components/NotificationSettingsDebugPanel';
import { TestFleetDebugPanel } from './components/TestFleetDebugPanel';
import { DebugInfo } from './types';

export default function DebugPage() {
  const { profile } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  const [userEmail, setUserEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  useEffect(() => {
    async function checkAccess() {
      const {
        data: { user: authUser },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !authUser) {
        router.push('/login');
        return;
      }

      setUserEmail(authUser.email || '');

      const { getViewAsRoleId } = await import('@/lib/utils/view-as-cookie');
      const viewAsRoleId = getViewAsRoleId();

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select(`
          id,
          role:roles (
            id,
            name,
            is_super_admin,
            is_manager_admin
          )
        `)
        .eq('id', authUser.id)
        .single();

      if (profileError || !profile) {
        console.error('Error fetching user profile:', profileError);
        toast.error('Access denied: Unable to verify permissions');
        router.push('/dashboard');
        return;
      }

      const isSupeAdmin = profile.role?.is_super_admin === true || authUser.email === 'admin@mpdee.co.uk';
      if (!isSupeAdmin) {
        toast.error('Access denied: SuperAdmin only');
        router.push('/dashboard');
        return;
      }

      if (viewAsRoleId) {
        toast.error('Debug console only available in Actual Role mode');
        router.push('/dashboard');
        return;
      }

      setLoading(false);
    }
    void checkAccess();
  }, [supabase, router]);

  useEffect(() => {
    if (userEmail === 'admin@mpdee.co.uk') {
      setDebugInfo({
        environment: process.env.NODE_ENV || 'development',
        buildTime: new Date().toISOString(),
        nodeVersion: typeof process !== 'undefined' ? process.version : 'N/A',
        nextVersion: '15.5.6',
      });
    }
  }, [userEmail]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (userEmail !== 'admin@mpdee.co.uk') {
    return null;
  }

  return (
    <div className="space-y-6 max-w-7xl">
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
            <CardTitle className="text-base md:text-2xl font-bold text-foreground truncate">{debugInfo?.environment}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
            <CardDescription className="text-xs md:text-sm text-muted-foreground flex items-center gap-1 md:gap-2">
              <Users className="h-3 md:h-4 w-3 md:w-4 text-green-500" />
              <span className="hidden md:inline">Logged In</span>
              <span className="md:hidden">User</span>
            </CardDescription>
            <CardTitle className="text-xs md:text-lg font-bold text-foreground truncate">{profile?.full_name}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
            <CardDescription className="text-xs md:text-sm text-muted-foreground flex items-center gap-1 md:gap-2">
              <ShieldAlert className="h-3 md:h-4 w-3 md:w-4 text-red-500" />
              <span className="hidden md:inline">Access</span>
              <span className="md:hidden">Role</span>
            </CardDescription>
            <CardTitle className="text-xs md:text-base font-bold text-red-600 dark:text-red-400">SuperAdmin</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2 md:pb-3 px-3 md:px-6 pt-3 md:pt-6">
            <CardDescription className="text-xs md:text-sm text-muted-foreground flex items-center gap-1 md:gap-2">
              <Clock className="h-3 md:h-4 w-3 md:w-4 text-purple-500" />
              <span className="hidden md:inline">Next.js</span>
              <span className="md:hidden">Ver</span>
            </CardDescription>
            <CardTitle className="text-base md:text-2xl font-bold text-foreground">{debugInfo?.nextVersion}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs defaultValue="errors" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5 gap-1 md:gap-0 h-auto md:h-10 p-1">
          <TabsTrigger value="errors" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <Bug className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">Error Log</span>
            <span className="md:hidden data-[state=active]:inline hidden">Errors</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <History className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">Audit Log</span>
            <span className="md:hidden data-[state=active]:inline hidden">Audit</span>
          </TabsTrigger>
          <TabsTrigger value="dvla" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <RefreshCw className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">DVLA Sync</span>
            <span className="md:hidden data-[state=active]:inline hidden">DVLA</span>
          </TabsTrigger>
          <TabsTrigger value="test-fleet" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <Car className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">Test Fleet</span>
            <span className="md:hidden data-[state=active]:inline hidden">Fleet</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center justify-center gap-1 md:gap-2 text-xs md:text-sm py-2 data-[state=active]:gap-2">
            <Send className="h-4 w-4 flex-shrink-0" />
            <span className="hidden md:inline">Notification Settings</span>
            <span className="md:hidden data-[state=active]:inline hidden">Notifs</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="errors">
          <ErrorLogsDebugPanel supabase={supabase} />
        </TabsContent>

        <TabsContent value="audit">
          <AuditLogDebugPanel supabase={supabase} />
        </TabsContent>

        <TabsContent value="dvla">
          <DVLASyncDebugPanel />
        </TabsContent>

        <TabsContent value="test-fleet">
          <TestFleetDebugPanel />
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationSettingsDebugPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
