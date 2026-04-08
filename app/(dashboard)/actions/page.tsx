'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArchiveX } from 'lucide-react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageLoader } from '@/components/ui/page-loader';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';

export default function ActionsPage() {
  const router = useRouter();
  const { hasPermission: canViewActions, loading: actionsPermissionLoading } = usePermissionCheck('actions', false);

  useEffect(() => {
    if (!actionsPermissionLoading && !canViewActions) {
      router.replace('/dashboard');
    }
  }, [actionsPermissionLoading, canViewActions, router]);

  if (actionsPermissionLoading) {
    return <PageLoader message="Loading actions..." />;
  }

  if (!canViewActions) {
    return <PageLoader message="Redirecting..." />;
  }

  return (
    <AppPageShell width="narrow">
      <AppPageHeader
        title="Actions"
        description="Legacy module status"
        icon={<ArchiveX className="h-5 w-5" />}
        iconContainerClassName="bg-amber-500/10 text-amber-500"
      />

      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/20">
              <ArchiveX className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <CardTitle className="text-foreground">Module retired</CardTitle>
              <CardDescription className="text-muted-foreground">
                This page is retained for administrative continuity only.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
          <p>
            The legacy Actions module has been retired. The operational workflows that were previously
            surfaced here are now managed within their dedicated areas of the application, including
            Workshop Tasks, Maintenance, Suggestions, Error Reports, notifications, and dashboard badges.
          </p>
          <p>
            This area remains in place so existing permissions and navigation can be preserved while the
            module is reserved for future development and repurposing.
          </p>
          <p className="text-foreground font-medium">
            No live action management functions are available on this page.
          </p>
        </CardContent>
      </Card>
    </AppPageShell>
  );
}
