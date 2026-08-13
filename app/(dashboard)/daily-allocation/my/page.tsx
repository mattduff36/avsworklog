'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { Card, CardContent } from '@/components/ui/card';
import { DailyAllocationBetaBadge } from '@/components/daily-allocation/DailyAllocationBetaBadge';
import { IssuedAllocationCard } from '@/components/daily-allocation/IssuedAllocationCard';
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
  const publicationId = searchParams.get('publication');

  return (
    <MyDailyAllocationBody
      key={publicationId || itemId || 'latest'}
      hasPermission={hasPermission && canUseLevel(2)}
      permissionLoading={permissionLoading || levelLoading}
      itemId={itemId}
      publicationId={publicationId}
    />
  );
}

function MyDailyAllocationBody({
  hasPermission,
  permissionLoading,
  itemId,
  publicationId,
}: {
  hasPermission: boolean;
  permissionLoading: boolean;
  itemId: string | null;
  publicationId: string | null;
}) {
  const [current, setCurrent] = useState<DailyAllocationIssuedItem | null>(null);
  const [history, setHistory] = useState<DailyAllocationIssuedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hasPermission || permissionLoading) return;
    let mounted = true;
    const params = new URLSearchParams();
    if (publicationId) params.set('publication', publicationId);
    else if (itemId) params.set('item', itemId);
    const query = params.toString() ? `?${params.toString()}` : '';
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
  }, [hasPermission, itemId, permissionLoading, publicationId]);

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

  const highlighted = Boolean(publicationId || itemId);
  const earlier = current
    ? history.filter((item) => item.publication_id !== current.publication_id)
    : history;

  return (
    <AppPageShell>
      <AppPageHeader
        title="My Allocation"
        titleMeta={dailyAllocationBetaBadge}
        description="Issued site, job, and instructions for your published work days."
      />
      {current ? (
        <IssuedAllocationCard item={current} highlighted={highlighted} />
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No published allocation is available yet.
          </CardContent>
        </Card>
      )}
      {earlier.length ? (
        <div className="mt-6 space-y-3">
          <h2 className="text-lg font-semibold">Earlier revisions</h2>
          {earlier.map((item) => (
            <IssuedAllocationCard
              key={`${item.publication_id}-${item.work_date}-${item.revision_no}`}
              item={item}
            />
          ))}
        </div>
      ) : null}
    </AppPageShell>
  );
}
