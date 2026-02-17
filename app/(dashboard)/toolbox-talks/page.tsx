'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, MessageSquare, Bell, BarChart3 } from 'lucide-react';
import { CreateToolboxTalkForm } from '@/components/messages/CreateToolboxTalkForm';
import { CreateReminderForm } from '@/components/messages/CreateReminderForm';
import { MessagesReportView } from '@/components/messages/MessagesReportView';

export default function ToolboxTalksPage() {
  const { isManager, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('create-toolbox-talk');

  // Redirect non-managers/admins
  if (!authLoading && !isManager && !isAdmin) {
    router.push('/dashboard');
    return null;
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-red-100 dark:bg-red-950 rounded-lg">
            <MessageSquare className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Toolbox Talks & Reminders
            </h1>
            <p className="text-muted-foreground">
              Send important safety messages and reminders to employees
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 bg-slate-800 p-0">
          <TabsTrigger value="create-toolbox-talk" data-tab="toolbox-talk" className="gap-2 data-[state=active]:bg-red-600 data-[state=active]:text-white">
            <MessageSquare className="h-4 w-4" />
            Create Toolbox Talk
          </TabsTrigger>
          <TabsTrigger value="create-reminder" data-tab="reminder" className="gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900">
            <Bell className="h-4 w-4" />
            Create Reminder
          </TabsTrigger>
          <TabsTrigger value="reports" data-tab="reports" className="gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900">
            <BarChart3 className="h-4 w-4" />
            Reports
          </TabsTrigger>
        </TabsList>

        {/* Create Toolbox Talk Tab */}
        <TabsContent value="create-toolbox-talk">
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">
                Create Toolbox Talk Message
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                High priority safety message that requires employee signature. Recipients cannot use the app until signed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateToolboxTalkForm onSuccess={() => {
                // Optionally switch to reports tab after creation
                // setActiveTab('reports');
              }} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Create Reminder Tab */}
        <TabsContent value="create-reminder">
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">
                Create Reminder Message
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Low priority informational message. Non-blocking - employees can dismiss after reading.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateReminderForm onSuccess={() => {
                // Optionally switch to reports tab after creation
              }} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports">
          <Card className="">
            <CardHeader>
              <CardTitle className="text-foreground">
                Message Reports
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                View all sent messages, recipient status, and compliance rates
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MessagesReportView />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

