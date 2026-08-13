'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DailyAllocationBetaBadge } from '@/components/daily-allocation/DailyAllocationBetaBadge';
import { Badge } from '@/components/ui/badge';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { useModuleAccessLevel } from '@/lib/hooks/useModuleAccessLevel';
import { formatDailyAllocationVisitTime } from '@/lib/utils/daily-allocation-timeline';
import type { DailyJobSheetPayload } from '@/types/daily-allocation';
import { toast } from 'sonner';

const dailyAllocationBetaBadge = <DailyAllocationBetaBadge />;

export default function DailyAllocationJobSheetPage() {
  const { hasPermission, loading: permissionLoading } = usePermissionCheck('daily-allocation');
  const { canUseLevel, isLoading: levelLoading } = useModuleAccessLevel('daily-allocation');
  const canViewJobSheet = canUseLevel(4);
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code || '');
  const [sheet, setSheet] = useState<DailyJobSheetPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPermission || !canViewJobSheet || permissionLoading || levelLoading || !code) return;
    let mounted = true;
    fetch(`/api/daily-allocation/jobs/${encodeURIComponent(code)}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as DailyJobSheetPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Unable to load this job sheet.');
        if (mounted) setSheet(payload);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unable to load this job sheet.';
        setLoadError(message);
        toast.error(message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [canViewJobSheet, code, hasPermission, levelLoading, permissionLoading]);

  if (permissionLoading || levelLoading) {
    return (
      <AppPageLoadingShell
        title="Job allocation sheet"
        titleMeta={dailyAllocationBetaBadge}
        message="Loading job allocation sheet..."
      />
    );
  }

  if (!hasPermission) {
    return (
      <AppPageShell>
        <AppPageHeader
          title="Job allocation sheet"
          titleMeta={dailyAllocationBetaBadge}
          description="Daily Allocation is not enabled for your team or is awaiting post-deploy activation."
        />
      </AppPageShell>
    );
  }

  if (!canViewJobSheet) {
    return (
      <AppPageShell>
        <AppPageHeader
          title="Job allocation sheet"
          titleMeta={dailyAllocationBetaBadge}
          description="Level 4 manager access is required to view job allocation sheets."
        />
      </AppPageShell>
    );
  }

  if (loading) {
    return (
      <AppPageLoadingShell
        title="Job allocation sheet"
        titleMeta={dailyAllocationBetaBadge}
        message="Loading job allocation sheet..."
      />
    );
  }

  if (!sheet) {
    return (
      <AppPageShell>
        <AppPageHeader
          title={loadError ? 'Job allocation sheet unavailable' : 'Job allocation sheet'}
          titleMeta={dailyAllocationBetaBadge}
          description={loadError || 'This job code has no allocation records yet.'}
        />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell width="wide" className="print:max-w-none">
      <AppPageHeader
        title={`Job ${sheet.job_code}`}
        titleMeta={dailyAllocationBetaBadge}
        description={[sheet.customer_name, sheet.title].filter(Boolean).join(' · ') || 'Allocation sheet'}
        actions={
          <div className="flex gap-2 print:hidden">
            {sheet.source_href ? (
              <Button asChild variant="outline">
                <Link href={sheet.source_href}>Open source</Link>
              </Button>
            ) : null}
            <Button onClick={() => window.print()}>Print plant sheet</Button>
          </div>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Site</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {sheet.site_address || 'No reliable site address is stored on the source record yet.'}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Issued labour</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sheet.labour.length === 0 ? (
              <p className="text-sm text-muted-foreground">No published labour for this job yet.</p>
            ) : sheet.labour.map((row) => (
              <div key={`${row.work_date}-${row.profile_name}-${row.revision_no}-${row.published_visit_id || 'legacy'}`} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{row.profile_name}</span>
                  <Badge variant="secondary">{row.work_date} · rev {row.revision_no}</Badge>
                </div>
                <p className="text-muted-foreground">{row.site_address || row.availability.replaceAll('_', ' ')}</p>
                {row.starts_at && row.ends_at ? (
                  <p>
                    {formatDailyAllocationVisitTime(row.starts_at) || row.instructions.start_time}
                    –
                    {formatDailyAllocationVisitTime(row.ends_at)}
                  </p>
                ) : row.instructions.start_time ? (
                  <p>Start {row.instructions.start_time}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plant allocation</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Plant</th>
                  <th className="py-2 pr-3">Planned job</th>
                  <th className="py-2 pr-3">Actual job</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Inspection</th>
                </tr>
              </thead>
              <tbody>
                {sheet.plant.length === 0 ? (
                  <tr>
                    <td className="py-3 text-muted-foreground" colSpan={6}>No planned or actual plant for this job.</td>
                  </tr>
                ) : sheet.plant.map((row) => (
                  <tr key={`${row.work_date}-${row.plant_label}-${row.inspection_id || row.plant_id || row.hired_serial}`} className="border-b">
                    <td className="py-2 pr-3">{row.work_date || '—'}</td>
                    <td className="py-2 pr-3">{row.plant_label}</td>
                    <td className="py-2 pr-3">{row.planned_job_code || '—'}</td>
                    <td className="py-2 pr-3">{row.actual_job_code || '—'}</td>
                    <td className="py-2 pr-3">{row.status.replaceAll('_', ' ')}</td>
                    <td className="py-2">
                      {row.inspection_id ? (
                        <Link
                          href={`/plant-inspections/${encodeURIComponent(row.inspection_id)}`}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          View inspection
                        </Link>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </AppPageShell>
  );
}
