'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ExternalLink, Phone } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { PanelLoader } from '@/components/ui/panel-loader';
import { formatDate, formatDateTime } from '@/lib/utils/date';
import { formatTrackerTimestamp, parseTrackerTimestamp } from '@/lib/utils/tracker-dates';
import { formatAssetMeterReading, getAssetMeterLabel } from '@/lib/workshop-tasks/asset-meter';
import { resolveWorkshopTaskAsset } from '@/lib/workshop-tasks/task-asset';
import {
  formatWhereaboutsEventPrimary,
  isWhereaboutsPayloadForAsset,
  resolveWhereaboutsMapTarget,
} from '@/lib/workshop-tasks/whereabouts-dialog';
import type { WorkshopAssetWhereaboutsPayload } from '@/types/workshop-asset-whereabouts';

const AssetLocationMap = dynamic(
  () => import('@/components/fleet/AssetLocationMap').then((mod) => ({ default: mod.AssetLocationMap })),
  {
    ssr: false,
    loading: () => (
      <PanelLoader message="Loading map..." accent="workshop" className="h-56 min-h-[14rem]" />
    ),
  }
);

const TRACKER_STALE_MS = 4 * 60 * 60 * 1000;

interface AssetWhereaboutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: {
    plant_id?: string | null;
    hgv_id?: string | null;
    van_id?: string | null;
  } | null;
  assetLabel: string;
}

function isTrackerStale(updatedAt: string | null | undefined): boolean {
  const parsed = parseTrackerTimestamp(updatedAt);
  if (!parsed) return false;
  return Date.now() - parsed.getTime() > TRACKER_STALE_MS;
}

export function AssetWhereaboutsDialog({
  open,
  onOpenChange,
  task,
  assetLabel,
}: AssetWhereaboutsDialogProps) {
  const asset = task ? resolveWorkshopTaskAsset(task) : null;
  const [payload, setPayload] = useState<WorkshopAssetWhereaboutsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackerMatch, setTrackerMatch] = useState<boolean | null>(null);
  const [trackerUpdatedAt, setTrackerUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !asset) {
      setPayload(null);
      setError(null);
      setLoading(false);
      setTrackerMatch(null);
      setTrackerUpdatedAt(null);
      return;
    }

    const controller = new AbortController();
    let ignore = false;

    async function load() {
      setLoading(true);
      setError(null);
      setPayload(null);
      setTrackerMatch(null);
      setTrackerUpdatedAt(null);
      try {
        const response = await fetch(
          `/api/workshop-tasks/assets/${asset!.assetType}/${asset!.assetId}/whereabouts`,
          { signal: controller.signal, cache: 'no-store' }
        );
        if (ignore) return;
        if (!response.ok) {
          setError(response.status === 404 ? 'Asset not found.' : 'Unable to load location details.');
          return;
        }
        const data = (await response.json()) as WorkshopAssetWhereaboutsPayload;
        if (ignore) return;
        setPayload(data);
      } catch (loadError) {
        if (ignore || (loadError instanceof DOMException && loadError.name === 'AbortError')) return;
        setError('Unable to load location details.');
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void load();
    return () => {
      ignore = true;
      controller.abort();
    };
  }, [open, asset?.assetType, asset?.assetId]);

  const matchedPayload = isWhereaboutsPayloadForAsset(payload, asset) ? payload : null;
  const mapTarget = resolveWhereaboutsMapTarget(asset, matchedPayload);
  const stale = isTrackerStale(trackerUpdatedAt);
  const displayLabel = matchedPayload?.asset.label || assetLabel;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-[calc(100vw-2rem)] max-w-4xl flex-col overflow-hidden border-border"
        style={{ maxHeight: 'min(85vh, calc(100dvh - 4rem))' }}
      >
        <DialogHeader className="shrink-0 pr-8 text-left">
          <DialogTitle>Location</DialogTitle>
          <p className="text-xs text-muted-foreground">{displayLabel}</p>
          <DialogDescription className="text-muted-foreground">
            Last-known tracker location, recent jobs, and the last driver for this asset.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <PanelLoader
            message="Loading location details..."
            accent="workshop"
            className="min-h-[16rem] py-10"
          />
        ) : error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : (
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-2 md:overflow-hidden">
            <div className="flex min-h-0 flex-col gap-2">
              {mapTarget ? (
                <>
                  <AssetLocationMap
                    plantId={mapTarget.plantId}
                    regNumber={mapTarget.regNumber}
                    assetLabel={mapTarget.assetLabel}
                    locationProvider={mapTarget.locationProvider}
                    loadingVariant="compact"
                    className="h-56 min-h-[14rem] md:h-full md:min-h-[16rem]"
                    prefetchAllLocations={false}
                    onMatchResult={setTrackerMatch}
                    onLocationData={(data) => setTrackerUpdatedAt(data.updatedAt)}
                  />
                  {trackerMatch === false ? (
                    <p className="text-xs text-muted-foreground">No tracker location for this asset.</p>
                  ) : null}
                  {trackerMatch && trackerUpdatedAt ? (
                    <p className={`text-xs ${stale ? 'text-amber-300' : 'text-muted-foreground'}`}>
                      Last reported:{' '}
                      <span className={stale ? 'text-amber-200' : 'text-foreground'}>
                        {formatTrackerTimestamp(trackerUpdatedAt)}
                      </span>
                    </p>
                  ) : null}
                </>
              ) : !asset ? (
                <p className="text-sm text-muted-foreground">This task is not linked to an asset.</p>
              ) : null}
            </div>

            {matchedPayload ? (
              <div className="flex min-h-0 flex-col gap-4">
                <div className="grid shrink-0 grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Last check</p>
                    <p className="text-sm text-foreground">
                      {matchedPayload.lastCheckAt ? formatDate(matchedPayload.lastCheckAt) : 'None in recent checks'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Last driver</p>
                    <p className="text-sm text-foreground">{matchedPayload.lastDriverName || 'Unknown'}</p>
                    {matchedPayload.lastDriverPhone ? (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        <a href={`tel:${matchedPayload.lastDriverPhone}`} className="underline underline-offset-2">
                          {matchedPayload.lastDriverPhone}
                        </a>
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {matchedPayload.meter ? getAssetMeterLabel(matchedPayload.meter.unit) : 'Meter'}
                    </p>
                    <p className="text-sm text-foreground">
                      {matchedPayload.meter ? formatAssetMeterReading(matchedPayload.meter.value) : 'Not recorded'}
                    </p>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  <p className="shrink-0 text-xs font-medium text-muted-foreground">Recent jobs and checks</p>
                  {matchedPayload.events.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No recent allocation or checks in the last 14 days.
                    </p>
                  ) : (
                    <ul className="min-h-0 space-y-2 md:flex-1 md:overflow-y-auto">
                      {matchedPayload.events.map((event) => (
                        <li
                          key={event.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-3 py-2"
                        >
                          <p className="min-w-0 truncate text-sm text-foreground">
                            {formatWhereaboutsEventPrimary(event)}
                          </p>
                          <div className="flex shrink-0 items-center gap-2">
                            <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                              {event.source === 'allocation' ? 'Allocated' : 'Daily check'}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatDateTime(event.occurredAt)}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {matchedPayload.canOpenFleetHistory ? (
                  <Link
                    href={matchedPayload.fleetHistoryHref}
                    className="inline-flex shrink-0 items-center gap-1 text-sm text-blue-300 underline underline-offset-2"
                  >
                    Open fleet history
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
