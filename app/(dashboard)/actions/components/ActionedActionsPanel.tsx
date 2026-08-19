'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadMorePagination } from '@/components/ui/load-more-pagination';
import { PanelLoader } from '@/components/ui/panel-loader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY,
  INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY,
} from '@/lib/config/reminder-workflows';
import { useLoadMorePagination } from '@/lib/hooks/useLoadMorePagination';
import { cn } from '@/lib/utils/cn';
import { isReminderActionActioned } from '@/lib/utils/reminder-action-filters';
import type { ReminderActionWithAsset } from '@/types/reminders';
import { toast } from 'sonner';

function formatLatestSubmitted(action: ReminderActionWithAsset): string {
  if (action.workflow_key === INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY) {
    const allocated = action.metadata?.allocated_location_name;
    if (typeof allocated === 'string' && allocated.trim()) return allocated;
    const details = action.metadata?.location_details;
    if (typeof details === 'string' && details.trim()) return details;
    return 'Allocated';
  }

  const value = action.metadata?.last_submitted_inspection_date;
  if (typeof value !== 'string' || !value) return 'Never';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date).replaceAll('/', '-');
}

export function ActionedActionsPanel() {
  const router = useRouter();
  const [actions, setActions] = useState<ReminderActionWithAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const {
    visibleItems: visibleActions,
    showMore,
  } = useLoadMorePagination(actions, { resetKey: `actioned:${actions.length}` });

  const loadActionedActions = useCallback(async () => {
    setLoading(true);
    try {
      const [fleetParams, yardParams] = [
        new URLSearchParams({
          workflow: FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY,
          status: 'all',
        }),
        new URLSearchParams({
          workflow: INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY,
          status: 'resolved',
        }),
      ];

      const [fleetResponse, yardResponse] = await Promise.all([
        fetch(`/api/actions?${fleetParams.toString()}`, { cache: 'no-store' }),
        fetch(`/api/actions?${yardParams.toString()}`, { cache: 'no-store' }),
      ]);
      const [fleetPayload, yardPayload] = await Promise.all([
        fleetResponse.json(),
        yardResponse.json(),
      ]);
      if (!fleetResponse.ok) {
        throw new Error(fleetPayload.error || 'Failed to load actioned reminders');
      }
      if (!yardResponse.ok) {
        throw new Error(yardPayload.error || 'Failed to load actioned reminders');
      }

      setActions([
        ...((fleetPayload.actions || []) as ReminderActionWithAsset[]),
        ...((yardPayload.actions || []) as ReminderActionWithAsset[]),
      ].filter(isReminderActionActioned));
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Failed to load actioned reminders');
      setActions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActionedActions();
  }, [loadActionedActions]);

  function openAssetHistory(action: ReminderActionWithAsset) {
    if (action.asset_route) {
      router.push(action.asset_route);
    }
  }

  return (
    <Card className="border-slate-700 bg-slate-900/70">
      <CardHeader>
        <CardTitle>Actioned reminders</CardTitle>
        <CardDescription>
          Completed reminders are archived here and removed from the Daily Checks tables.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <PanelLoader message="Loading actioned reminders..." className="py-12" />
        ) : actions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
            <TriangleAlert className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No reminders have been actioned yet.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-slate-700">
              <Table>
              <TableHeader>
                <TableRow className="border-slate-700 hover:bg-transparent">
                  <TableHead>Asset</TableHead>
                  <TableHead>Latest submitted</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleActions.map((action) => (
                  <TableRow
                    key={action.id}
                    className={cn(
                      'border-slate-700',
                      action.asset_route && 'cursor-pointer hover:bg-slate-800/50',
                    )}
                    onClick={() => openAssetHistory(action)}
                  >
                    <TableCell>
                      <p className="font-medium text-foreground">{action.asset_label || action.title}</p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatLatestSubmitted(action)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Actioned
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              </Table>
            </div>
            <LoadMorePagination
              visibleCount={visibleActions.length}
              totalCount={actions.length}
              itemLabel="actioned reminders"
              onShowMore={showMore}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
