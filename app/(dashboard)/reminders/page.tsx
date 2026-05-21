'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import type { ReminderWithAction } from '@/types/reminders';

interface RemindersResponse {
  success: boolean;
  reminders?: ReminderWithAction[];
  error?: string;
}

function getLatestInspectionLabel(reminder: ReminderWithAction): string {
  const value = reminder.action.metadata?.last_submitted_inspection_date;
  return typeof value === 'string' ? value : 'Never submitted';
}

function getOverdueLabel(reminder: ReminderWithAction): string {
  const value = reminder.action.metadata?.days_overdue;
  return typeof value === 'number' ? `${value} days overdue` : 'No submitted check on record';
}

export default function RemindersPage() {
  const router = useRouter();
  const { hasPermission: canViewReminders, loading: permissionLoading } = usePermissionCheck('reminders', false);
  const [reminders, setReminders] = useState<ReminderWithAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const loadReminders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/reminders?status=pending', { cache: 'no-store' });
      const payload = (await response.json()) as RemindersResponse;
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load reminders');
      }

      setReminders(payload.reminders || []);
    } catch (error) {
      console.error(error);
      setReminders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!permissionLoading && !canViewReminders) {
      router.replace('/dashboard');
    }
  }, [permissionLoading, canViewReminders, router]);

  useEffect(() => {
    if (!permissionLoading && canViewReminders) {
      void loadReminders();
    }
  }, [permissionLoading, canViewReminders, loadReminders]);

  const handleActioned = useCallback(async (reminderId: string) => {
    setActioningId(reminderId);
    try {
      const response = await fetch(`/api/reminders/${reminderId}/actioned`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to action reminder');
      }

      setReminders((current) => current.filter((reminder) => reminder.id !== reminderId));
    } catch (error) {
      console.error(error);
    } finally {
      setActioningId(null);
    }
  }, []);

  if (permissionLoading) {
    return <PageLoader message="Loading reminders..." />;
  }

  if (!canViewReminders) {
    return <PageLoader message="Redirecting..." />;
  }

  return (
    <AppPageShell width="medium">
      <AppPageHeader
        title="Reminders"
        description="Assigned reminders stay here until you confirm they have been actioned."
        icon={<BellRing className="h-5 w-5" />}
        iconContainerClassName="bg-reminders-soft text-reminders"
      />

      {loading ? (
        <Card className="border-border">
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-reminders" />
          </CardContent>
        </Card>
      ) : reminders.length === 0 ? (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-foreground">No pending reminders</CardTitle>
            <CardDescription className="text-muted-foreground">
              Once all assigned reminders are actioned, this module tile disappears from the dashboard.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-4">
          {reminders.map((reminder) => (
            <Card key={reminder.id} className="border-border">
              <CardHeader className="space-y-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-xl text-foreground">
                        {reminder.action.asset_label || reminder.action.title}
                      </CardTitle>
                      <Badge variant="warning">{getOverdueLabel(reminder)}</Badge>
                    </div>
                    <CardDescription className="text-sm text-muted-foreground">
                      {reminder.action.description}
                    </CardDescription>
                  </div>

                  <Button
                    type="button"
                    onClick={() => void handleActioned(reminder.id)}
                    disabled={actioningId === reminder.id}
                    className="gap-2"
                  >
                    {actioningId === reminder.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Actioned
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Latest submitted check</p>
                    <p className="mt-2 text-sm font-medium text-foreground">{getLatestInspectionLabel(reminder)}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Reminder assigned</p>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      {new Date(reminder.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                {reminder.action.asset_route ? (
                  <Link
                    href={reminder.action.asset_route}
                    className="inline-flex items-center gap-2 text-sm font-medium text-reminders hover:underline"
                  >
                    Open asset history
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppPageShell>
  );
}
