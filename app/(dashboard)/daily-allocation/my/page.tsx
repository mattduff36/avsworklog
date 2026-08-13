'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DailyAllocationBetaBadge } from '@/components/daily-allocation/DailyAllocationBetaBadge';
import { Badge } from '@/components/ui/badge';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useModuleAccessLevel } from '@/lib/hooks/useModuleAccessLevel';
import type { DailyAllocationIssuedItem } from '@/types/daily-allocation';
import { toast } from 'sonner';

const dailyAllocationBetaBadge = <DailyAllocationBetaBadge />;

export default function MyDailyAllocationPage() {
  return (
    <Suspense fallback={<AppPageLoadingShell title="My Allocation" titleMeta={dailyAllocationBetaBadge} message="Loading your allocation..." />}>
      <MyDailyAllocationContent />
    </Suspense>
  );
}

function MyDailyAllocationContent() {
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('daily-allocation');
  const { canUseLevel, isLoading: levelLoading } = useModuleAccessLevel('daily-allocation');
  const searchParams = useSearchParams();
  const itemId = searchParams.get('item');

  return (
    <MyDailyAllocationBody
      key={itemId || 'latest'}
      hasPermission={hasPermission && canUseLevel(2)}
      permissionLoading={permissionLoading || levelLoading}
      itemId={itemId}
    />
  );
}

function MyDailyAllocationBody({
  hasPermission,
  permissionLoading,
  itemId,
}: {
  hasPermission: boolean;
  permissionLoading: boolean;
  itemId: string | null;
}) {
  const [current, setCurrent] = useState<DailyAllocationIssuedItem | null>(null);
  const [history, setHistory] = useState<DailyAllocationIssuedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hasPermission || permissionLoading) return;
    let mounted = true;
    const query = itemId ? `?item=${encodeURIComponent(itemId)}` : '';
    fetch(`/api/daily-allocation/me${query}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as {
          current?: DailyAllocationIssuedItem | null;
          history?: DailyAllocationIssuedItem[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || 'Unable to load your allocation.');
        if (!mounted) return;
        setCurrent(payload.current || null);
        setHistory(payload.history || []);
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : 'Unable to load your allocation.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [hasPermission, itemId, permissionLoading]);

  if (permissionLoading) {
    return (
      <AppPageLoadingShell
        title="My Allocation"
        titleMeta={dailyAllocationBetaBadge}
        message="Loading your allocation..."
      />
    );
  }

  if (!hasPermission) {
    return (
      <AppPageShell>
        <AppPageHeader
          title="My Allocation"
          titleMeta={dailyAllocationBetaBadge}
          description="Level 2 Daily Allocation access is required to view issued work."
        />
      </AppPageShell>
    );
  }

  if (loading) {
    return (
      <AppPageLoadingShell
        title="My Allocation"
        titleMeta={dailyAllocationBetaBadge}
        message="Loading your allocation..."
      />
    );
  }

  return (
    <AppPageShell>
      <AppPageHeader
        title="My Allocation"
        titleMeta={dailyAllocationBetaBadge}
        description="Issued site, job, and instructions for your published work days."
      />
      {current ? (
        <IssuedCard item={current} highlighted={Boolean(itemId)} />
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No published allocation is available yet.
          </CardContent>
        </Card>
      )}
      {history.length > 1 ? (
        <div className="mt-6 space-y-3">
          <h2 className="text-lg font-semibold">Earlier revisions</h2>
          {history.slice(1).map((item) => (
            <IssuedCard
              key={`${item.publication_id}-${item.work_date}-${item.revision_no}`}
              item={item}
            />
          ))}
        </div>
      ) : null}
    </AppPageShell>
  );
}

function IssuedCard({ item, highlighted = false }: { item: DailyAllocationIssuedItem; highlighted?: boolean }) {
  return (
    <Card className={highlighted ? 'border-primary' : undefined}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span>{format(parseISO(item.work_date), 'EEEE d MMM yyyy')}</span>
          <Badge variant="secondary">Revision {item.revision_no}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {item.availability !== 'available' && item.absence ? (
          <p>{item.absence.reason_name}{item.absence.is_half_day ? ` (${item.absence.half_day_session || 'half day'})` : ''}</p>
        ) : null}
        {item.job_code ? <p><span className="text-muted-foreground">Job:</span> {item.job_code}</p> : null}
        {item.title ? <p><span className="text-muted-foreground">Title:</span> {item.title}</p> : null}
        {item.site_address ? <p><span className="text-muted-foreground">Site:</span> {item.site_address}</p> : null}
        {item.instructions.start_time ? <p><span className="text-muted-foreground">Start:</span> {item.instructions.start_time}</p> : null}
        {item.instructions.meeting_point ? <p><span className="text-muted-foreground">Meeting point:</span> {item.instructions.meeting_point}</p> : null}
        {item.instructions.meet_person ? <p><span className="text-muted-foreground">Meet:</span> {item.instructions.meet_person}</p> : null}
        {item.instructions.notes ? <p><span className="text-muted-foreground">Notes:</span> {item.instructions.notes}</p> : null}
      </CardContent>
    </Card>
  );
}
