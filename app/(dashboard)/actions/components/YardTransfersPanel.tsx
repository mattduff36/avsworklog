'use client';

import { useCallback, useEffect, useState } from 'react';
import { INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY } from '@/lib/config/reminder-workflows';
import { isReminderActionActive } from '@/lib/utils/reminder-action-filters';
import type { ReminderActionWithAsset } from '@/types/reminders';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PanelLoader } from '@/components/ui/panel-loader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { YardTransferAllocateDialog } from './YardTransferAllocateDialog';

interface YardTransfersPanelProps {
  refreshToken: number;
  onActionsChanged?: () => void;
}

function getMetadataString(action: ReminderActionWithAsset, key: string): string {
  const value = action.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

function getSnapshotCount(action: ReminderActionWithAsset, key: string): number {
  const value = action.metadata?.[key];
  return Array.isArray(value) ? value.length : 0;
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function YardTransfersPanel({
  refreshToken,
  onActionsChanged,
}: YardTransfersPanelProps) {
  const [actions, setActions] = useState<ReminderActionWithAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAction, setSelectedAction] = useState<ReminderActionWithAsset | null>(null);

  const loadActions = useCallback(async () => {
    setLoading(true);
    try {
      const searchParams = new URLSearchParams({
        workflow: INVENTORY_KIOSK_UNALLOCATED_TAKE_WORKFLOW_KEY,
        status: 'open',
      });
      const response = await fetch(`/api/actions?${searchParams.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Failed to load Yard transfers');
      setActions(((payload.actions || []) as ReminderActionWithAsset[]).filter(isReminderActionActive));
    } catch (error) {
      console.error(error);
      setActions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActions();
  }, [loadActions, refreshToken]);

  if (loading) {
    return <PanelLoader message="Loading Yard transfers..." />;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Yard transfers</CardTitle>
          <CardDescription>
            Stock collected from Yard without a known location. Allocate each take to a real location.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No unallocated Yard takes.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Location details</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actions.map((action) => (
                  <TableRow key={action.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatCreatedAt(action.created_at)}
                    </TableCell>
                    <TableCell className="max-w-md">
                      {getMetadataString(action, 'location_details') || action.description || action.title}
                    </TableCell>
                    <TableCell>
                      {getSnapshotCount(action, 'serialized_items')} items,{' '}
                      {getSnapshotCount(action, 'hardware_lines')} hardware
                    </TableCell>
                    <TableCell className="text-right">
                      <Button type="button" size="sm" onClick={() => setSelectedAction(action)}>
                        Allocate
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <YardTransferAllocateDialog
        open={Boolean(selectedAction)}
        action={selectedAction}
        onOpenChange={(open) => {
          if (!open) setSelectedAction(null);
        }}
        onAllocated={async () => {
          await loadActions();
          onActionsChanged?.();
        }}
      />
    </>
  );
}
