'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TabsContent } from '@/components/ui/tabs';
import { guestInspectorName } from '@/lib/inspections/guest-plant';
import { createClient } from '@/lib/supabase/client';
import { formatDate, formatDateTime } from '@/lib/utils/date';
import type {
  AssetHistoryAssetType,
  AssetHistoryDailyTaskSource,
} from '@/lib/fleet/asset-history-events';

type AssetType = AssetHistoryAssetType;
export type DailyCheckHistoryItem = AssetHistoryDailyTaskSource & { record_kind?: 'full_check' | 'defect_report' };

interface DailyChecksHistoryTabProps {
  assetId: string;
  assetType: AssetType;
}

const assetConfig = {
  van: {
    assetLabel: 'van',
    titleLabel: 'Van',
    routePrefix: '/van-inspections',
    distanceLabel: 'Mileage',
    distanceUnit: 'miles',
  },
  plant: {
    assetLabel: 'plant machinery',
    titleLabel: 'Plant Machinery',
    routePrefix: '/plant-inspections',
    distanceLabel: 'Hours',
    distanceUnit: 'h',
  },
  hgv: {
    assetLabel: 'HGV',
    titleLabel: 'HGV',
    routePrefix: '/hgv-inspections',
    distanceLabel: 'KM',
    distanceUnit: 'km',
  },
} satisfies Record<AssetType, {
  assetLabel: string;
  titleLabel: string;
  routePrefix: string;
  distanceLabel: string;
  distanceUnit: string;
}>;

async function addDefectCounts(rows: DailyCheckHistoryItem[]) {
  if (rows.length === 0) return rows;

  const supabase = createClient();
  const inspectionIds = rows.map((row) => row.id);
  const { data, error } = await supabase
    .from('inspection_items')
    .select('inspection_id, status')
    .in('inspection_id', inspectionIds)
    .in('status', ['attention', 'defect']);

  if (error) throw error;

  const defectCounts = new Map<string, number>();
  (data || []).forEach((item: { inspection_id: string | null }) => {
    if (!item.inspection_id) return;
    defectCounts.set(item.inspection_id, (defectCounts.get(item.inspection_id) || 0) + 1);
  });

  return rows.map((row) => ({
    ...row,
    defect_count: defectCounts.get(row.id) || 0,
  }));
}

function getDailyCheckStatusLabel(inspection: DailyCheckHistoryItem) {
  const defectCount = inspection.defect_count || 0;
  if (defectCount === 0) return inspection.history_summary ? 'No defects recorded' : 'All Passed';
  return `${defectCount} ${defectCount === 1 ? 'Defect' : 'Defects'}`;
}

function getDailyCheckStatusClassName(inspection: DailyCheckHistoryItem) {
  return (inspection.defect_count || 0) > 0
    ? 'bg-red-500/10 text-red-300 border-red-500/30'
    : 'bg-green-500/10 text-green-300 border-green-500/30';
}

function formatDistance(value: number | null, assetType: AssetType) {
  if (value == null) return `${assetConfig[assetType].distanceLabel} not set`;

  const formattedValue = value.toLocaleString();
  if (assetType === 'plant') return `${formattedValue}${assetConfig[assetType].distanceUnit}`;

  return `${formattedValue} ${assetConfig[assetType].distanceUnit}`;
}

export async function fetchDailyChecks(assetType: AssetType, assetId: string, offset = 0) {
  const supabase = createClient();

  switch (assetType) {
    case 'van': {
      const { data, error } = await supabase
        .from('van_inspections')
        .select(`
          id,
          inspection_date,
          inspection_end_date,
          submitted_at,
          status,
          current_mileage,
          profile:profiles!van_inspections_user_id_fkey(full_name)
        `)
        .eq('van_id', assetId)
        .eq('status', 'submitted')
        .order('inspection_date', { ascending: false })
        .limit(50);

      if (error) throw error;
      return addDefectCounts((data || []) as unknown as DailyCheckHistoryItem[]);
    }
    case 'plant': {
      const { data, error } = await supabase
        .from('plant_inspections')
        .select(`
          id,
          guest_name,
          guest_submission_id,
          inspection_date,
          inspection_end_date,
          submitted_at,
          status,
          current_mileage,
          profile:profiles!plant_inspections_user_id_fkey(full_name)
        `)
        .eq('plant_id', assetId)
        .eq('status', 'submitted')
        .order('inspection_date', { ascending: false })
        .limit(50);

      if (error) throw error;
      return addDefectCounts((data || []).map(row => ({ ...row, profile: row.guest_name ? { full_name: guestInspectorName(row) } : row.profile })) as unknown as DailyCheckHistoryItem[]);
    }
    case 'hgv': {
      const { data, error } = await supabase.rpc('hgv_asset_daily_checks', {
        p_asset_id: assetId,
        p_offset: offset,
      });
      if (error) throw error;
      return (data || []).map((entry): DailyCheckHistoryItem => {
        const tractor = entry.tractor_registration || 'HGV';
        const summary = entry.entry_kind === 'swap'
          ? `Trailer change · ${tractor} · ${entry.trailer_label || 'Trailer'}`
          : entry.entry_kind === 'trailer' ? `${entry.record_kind === 'defect_report' ? 'Trailer defect report' : 'Trailer check'} · ${tractor}` : undefined;
        const section = entry.entry_kind === 'swap'
          ? `#trailer-swap-${entry.id}` : entry.entry_kind === 'trailer' ? '#trailer-check' : '';
        return {
          ...entry,
          status: 'submitted',
          inspection_end_date: null,
          profile: entry.driver_name ? { full_name: entry.driver_name } : null,
          history_summary: summary,
          history_href: `/hgv-inspections/${entry.inspection_id}${section}`,
        };
      });
    }
  }
}

export function DailyChecksHistoryTab({ assetId, assetType }: DailyChecksHistoryTabProps) {
  const router = useRouter();
  const [dailyChecks, setDailyChecks] = useState<DailyCheckHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const config = assetConfig[assetType];

  const loadDailyChecks = useCallback(async () => {
    if (!assetId) {
      setDailyChecks([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const rows = await fetchDailyChecks(assetType, assetId);
      setDailyChecks(rows);
    } catch (loadError) {
      console.error(`Error fetching ${assetType} daily checks:`, loadError);
      setDailyChecks([]);
      setError('Daily checks could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [assetId, assetType]);

  useEffect(() => {
    void loadDailyChecks();
  }, [loadDailyChecks]);

  return (
    <TabsContent value="inspections" className="space-y-6">
      <Card className="bg-slate-800/50 border-border">
        <CardHeader>
          <CardTitle>{config.titleLabel} Daily Check History</CardTitle>
          <CardDescription>Daily check submissions for this {config.assetLabel}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-20 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center text-muted-foreground">
              <ClipboardCheck className="h-12 w-12 opacity-50" />
              <p>{error}</p>
            </div>
          ) : dailyChecks.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center text-muted-foreground">
              <ClipboardCheck className="h-12 w-12 opacity-50" />
              <p>No daily checks recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dailyChecks.map((inspection) => (
                <button
                  key={inspection.id}
                  type="button"
                  onClick={() => router.push(inspection.history_href || `${config.routePrefix}/${inspection.id}`)}
                  className="w-full rounded-lg border border-border p-4 text-left transition-colors hover:bg-slate-700/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {formatDate(inspection.inspection_date)}{inspection.record_kind === 'defect_report' ? ' · Additional defect report' : ''}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {inspection.profile?.full_name ? `${inspection.profile.full_name} - ` : ''}
                        {inspection.history_summary || formatDistance(inspection.current_mileage, assetType)}
                      </div>
                      {inspection.submitted_at && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Submitted {formatDateTime(inspection.submitted_at)}
                        </div>
                      )}
                    </div>
                    <Badge variant="outline" className={`w-fit ${getDailyCheckStatusClassName(inspection)}`}>
                      {getDailyCheckStatusLabel(inspection)}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}
