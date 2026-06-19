'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { BackButton } from '@/components/ui/back-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageLoader } from '@/components/ui/page-loader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle, CalendarCheck, Clock, Download, Loader2, MapPin, PackageSearch } from 'lucide-react';
import { toast } from 'sonner';
import { formatInventoryCategoryLabel, type InventoryItem, type InventoryItemGroupSummary } from '../../types';
import { InventoryCheckModal, type InventoryChecklistSubmitPayload } from '../../components/InventoryCheckModal';
import {
  INVENTORY_CHECKLIST_DEFINITIONS,
  INVENTORY_CHECK_OVERALL_STATUS_LABELS,
  INVENTORY_SERVICE_CHECKLIST_VERSION,
  getInventoryChecklistDefinition,
  getInventoryChecklistLabel,
  getInventoryChecklistSummary,
  type InventoryChecklistDefinition,
  type InventoryCheckOverallStatus,
  type InventoryChecklistItemResult,
} from '@/lib/checklists/inventory-service-checklist';
import {
  CHECK_INTERVAL_MONTHS,
  checkIntervalMonthsToDays,
  formatInventoryCheckIntervalMonths,
  formatInventoryDate,
  formatInventoryUnknownLocationAge,
  getCheckStatusLabel,
  getInventoryCheckIntervalMonths,
  getInventoryCheckStatus,
  getInventoryDueDate,
  isInventoryCheckExempt,
} from '../../utils';

interface MovementProfile {
  full_name: string | null;
}

interface MovementLocation {
  name: string | null;
}

interface InventoryMovement {
  id: string;
  from_location: MovementLocation | null;
  to_location: MovementLocation | null;
  note: string | null;
  moved_at: string;
  moved_by_profile: MovementProfile | null;
  batch?: {
    move_scope: string;
    group?: InventoryItemGroupSummary | null;
  } | null;
}

interface InventoryCheck {
  id: string;
  checked_at: string;
  interval_days: number;
  note: string | null;
  checklist_version: string | null;
  checklist_items: InventoryChecklistItemResult[] | null;
  overall_status: InventoryCheckOverallStatus | null;
  created_at: string;
  checked_by_profile: MovementProfile | null;
}

interface InventoryHistoryPayload {
  item: InventoryItem;
  movements: InventoryMovement[];
  checks: InventoryCheck[];
  group: InventoryItemGroupSummary | null;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getStatusBadgeClass(item: InventoryItem): string {
  if (item.status === 'retired') return 'border-slate-500/30 bg-slate-500/10 text-slate-200';
  const status = getInventoryCheckStatus(item);
  if (status === 'overdue') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (status === 'due_soon') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (status === 'needs_check') return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
  if (status === 'not_required') return 'border-slate-500/30 bg-slate-500/10 text-slate-300';
  return 'border-green-500/30 bg-green-500/10 text-green-300';
}

export default function InventoryItemDetailPage() {
  const params = useParams<{ itemId: string }>();
  const itemId = params.itemId;
  const [payload, setPayload] = useState<InventoryHistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [intervalMonths, setIntervalMonths] = useState('');
  const [checkedAt, setCheckedAt] = useState(new Date().toISOString().slice(0, 10));
  const [showCheckTypeModal, setShowCheckTypeModal] = useState(false);
  const [showCheckModal, setShowCheckModal] = useState(false);
  const [selectedChecklistVersion, setSelectedChecklistVersion] = useState(INVENTORY_SERVICE_CHECKLIST_VERSION);
  const [checkModalSession, setCheckModalSession] = useState(0);
  const [savingInterval, setSavingInterval] = useState(false);
  const [savingCheck, setSavingCheck] = useState(false);
  const [downloadingCheckId, setDownloadingCheckId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const response = await fetch(`/api/inventory/${itemId}/history`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to fetch inventory item history');

      setPayload(data);
      setIntervalMonths(data.item.check_interval_days ? String(getInventoryCheckIntervalMonths(data.item)) : '');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load inventory item');
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  async function parseResponse(response: Response, fallbackMessage: string) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || fallbackMessage);
    return data;
  }

  async function handleSaveInterval(event: React.FormEvent) {
    event.preventDefault();
    setSavingInterval(true);
    try {
      const parsedInterval = Number.parseInt(intervalMonths, 10);
      const response = await fetch(`/api/inventory/${itemId}/check-interval`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          check_interval_days: checkIntervalMonthsToDays(
            Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval : null
          ),
        }),
      });
      await parseResponse(response, 'Failed to update check interval');
      toast.success('Check interval updated');
      await fetchHistory();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update check interval');
    } finally {
      setSavingInterval(false);
    }
  }

  async function handleRecordCheck(checkPayload: InventoryChecklistSubmitPayload) {
    setSavingCheck(true);
    try {
      const response = await fetch(`/api/inventory/${itemId}/checks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkPayload),
      });
      await parseResponse(response, 'Failed to record check');
      toast.success('Inventory check recorded');
      setShowCheckModal(false);
      setCheckedAt(new Date().toISOString().slice(0, 10));
      await fetchHistory();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to record check');
    } finally {
      setSavingCheck(false);
    }
  }

  function handleChooseCheckType(checklistDefinition: InventoryChecklistDefinition) {
    setSelectedChecklistVersion(checklistDefinition.version);
    setCheckModalSession((current) => current + 1);
    setShowCheckTypeModal(false);
    setShowCheckModal(true);
  }

  async function handleDownloadCheckPdf(checkId: string) {
    setDownloadingCheckId(checkId);
    try {
      const response = await fetch(`/api/inventory/${itemId}/checks/${checkId}/pdf`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to download checklist PDF');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `inventory-check-${checkId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Checklist PDF downloaded');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to download checklist PDF');
    } finally {
      setDownloadingCheckId(null);
    }
  }

  if (loading) return <PageLoader message="Loading inventory item..." />;
  if (!payload) {
    return (
      <AppPageShell width="wide">
        <BackButton fallbackHref="/inventory" />
        <Card className="border-slate-700 bg-slate-900/70">
          <CardContent className="py-12 text-center text-muted-foreground">Inventory item not found.</CardContent>
        </Card>
      </AppPageShell>
    );
  }

  const { item, movements, checks, group } = payload;
  const checkStatus = getInventoryCheckStatus(item);
  const intervalMonthsValue = getInventoryCheckIntervalMonths(item);
  const isRetired = item.status === 'retired';
  const isCheckExempt = isInventoryCheckExempt(item);
  const unknownLocationAgeLabel = formatInventoryUnknownLocationAge(item);
  const selectedChecklistDefinition =
    getInventoryChecklistDefinition(selectedChecklistVersion) || INVENTORY_CHECKLIST_DEFINITIONS[0];

  return (
    <AppPageShell width="wide">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/inventory" />
        <AppPageHeader
          title={item.name}
          description={`${item.item_number} · ${item.location?.name || 'No location assigned'}`}
          icon={<PackageSearch className="h-5 w-5" />}
          actions={(
            <Badge variant="outline" className={getStatusBadgeClass(item)}>
              {isRetired ? 'Retired' : getCheckStatusLabel(checkStatus)}
            </Badge>
          )}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card className="border-slate-700 bg-slate-900/70">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Current Location</div>
            <div className="mt-2 flex items-center gap-2 font-semibold text-white">
              <MapPin className="h-4 w-4 text-inventory" />
              {item.location?.name || 'No location assigned'}
            </div>
            {unknownLocationAgeLabel ? (
              <div className="mt-1 text-xs text-muted-foreground">{unknownLocationAgeLabel}</div>
            ) : null}
          </CardContent>
        </Card>
        <Card className="border-slate-700 bg-slate-900/70">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Last Checked</div>
            <div className="mt-2 font-semibold text-white">{formatInventoryDate(item.last_checked_at)}</div>
          </CardContent>
        </Card>
        <Card className="border-slate-700 bg-slate-900/70">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Due Date</div>
            <div className="mt-2 font-semibold text-white">
              {isCheckExempt ? 'No check required' : getInventoryDueDate(item.last_checked_at, intervalMonthsValue)}
            </div>
            {unknownLocationAgeLabel ? (
              <div className="text-xs text-muted-foreground">{unknownLocationAgeLabel}</div>
            ) : null}
          </CardContent>
        </Card>
        <Card className="border-slate-700 bg-slate-900/70">
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Check Interval</div>
            <div className="mt-2 font-semibold text-white">
              {isCheckExempt ? 'Not required' : formatInventoryCheckIntervalMonths(intervalMonthsValue)}
            </div>
            {!isCheckExempt && !item.check_interval_days ? <div className="text-xs text-muted-foreground">Default cadence</div> : null}
            {isCheckExempt ? <div className="text-xs text-muted-foreground">Ignored while this special status applies</div> : null}
          </CardContent>
        </Card>
      </div>

      {isRetired ? (
        <Card className="border-slate-500/30 bg-slate-500/10">
          <CardContent className="flex flex-col gap-2 p-4 text-sm text-slate-100 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <div className="font-medium">This inventory item is retired.</div>
                <div className="text-slate-300">
                  Reason: {item.retire_reason || 'Other'} · Retired: {formatInventoryDate(item.retired_at)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
          <TabsTrigger value="checks">Checks</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0 grid gap-6 lg:grid-cols-2">
          <Card className="border-slate-700 bg-slate-900/70">
            <CardHeader>
              <CardTitle className="text-white">Item Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow label="Status" value={item.status} />
              {isRetired ? (
                <>
                  <DetailRow label="Retired Date" value={formatInventoryDate(item.retired_at)} />
                  <DetailRow label="Retirement Reason" value={item.retire_reason || 'Other'} />
                </>
              ) : null}
              <DetailRow label="Category" value={formatInventoryCategoryLabel(item.category)} />
              <DetailRow label="Source" value={item.source || 'Not recorded'} />
              <DetailRow label="Source Reference" value={item.source_reference || 'Not recorded'} />
              <DetailRow label="Group" value={group?.name || 'No group'} />
              {item.minor_plant_detail ? (
                <>
                  <DetailRow label="Plant ID" value={item.minor_plant_detail.plant_identifier || 'Not recorded'} />
                  {'serial_number' in item.minor_plant_detail ? (
                    <DetailRow label="Serial Number" value={item.minor_plant_detail.serial_number || 'Not recorded'} />
                  ) : null}
                  <DetailRow label="Make" value={item.minor_plant_detail.make || 'Not recorded'} />
                  <DetailRow label="Model" value={item.minor_plant_detail.model || 'Not recorded'} />
                  <DetailRow label="Registration" value={item.minor_plant_detail.reg_number || 'Not recorded'} />
                </>
              ) : null}
              {item.location?.linked_asset_label ? (
                <DetailRow label="Linked Location Asset" value={`${item.location.linked_asset_label}${item.location.linked_asset_nickname ? ` · ${item.location.linked_asset_nickname}` : ''}`} />
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-slate-700 bg-slate-900/70">
            <CardHeader>
              <CardTitle className="text-white">Check Workflow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <form className="space-y-3" onSubmit={handleSaveInterval}>
                <div className="space-y-2">
                  <Label htmlFor="interval_months">Item Check Interval (months)</Label>
                  <Input
                    id="interval_months"
                    type="number"
                    min={1}
                    max={120}
                    value={intervalMonths}
                    onChange={(event) => setIntervalMonths(event.target.value)}
                    placeholder={`Default ${CHECK_INTERVAL_MONTHS}`}
                    className="bg-slate-800 border-slate-600"
                    disabled={isRetired}
                  />
                </div>
                <Button type="submit" variant="outline" disabled={savingInterval || isRetired}>
                  Save Interval
                </Button>
              </form>

              <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-800/40 p-4">
                <div>
                  <div className="font-medium text-white">Inventory Checks</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isRetired
                      ? 'Retired items must be restored before new checks can be recorded.'
                      : isCheckExempt
                        ? 'No due date is generated while this special status applies. You can still record a check before moving it back into a regular category.'
                        : 'Choose a PAT Test or Regular Check, then record Pass, Fail, or N/A. Failed items require comments.'
                    }
                  </p>
                </div>
                <Button
                  type="button"
                  className="bg-inventory text-white hover:bg-inventory-dark"
                  onClick={() => setShowCheckTypeModal(true)}
                  disabled={savingCheck || !checkedAt || isRetired}
                >
                  <CalendarCheck className="mr-2 h-4 w-4" />
                  Start Check
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements" className="mt-0">
          <TimelineCard
            title="Transfer / Location History"
            emptyMessage="No movement history has been recorded for this item yet."
            icon={<MapPin className="h-5 w-5 text-inventory" />}
          >
            {movements.map((movement) => (
              <TimelineEntry
                key={movement.id}
                title={`${movement.from_location?.name || 'Unknown'} → ${movement.to_location?.name || 'Unknown'}`}
                meta={`${formatTimestamp(movement.moved_at)} · ${movement.moved_by_profile?.full_name || 'Unknown user'}`}
                note={movement.note}
                badge={movement.batch?.move_scope === 'group' ? `Group: ${movement.batch.group?.name || 'group move'}` : movement.batch?.move_scope || null}
              />
            ))}
          </TimelineCard>
        </TabsContent>

        <TabsContent value="checks" className="mt-0">
          <TimelineCard
            title="Check History"
            emptyMessage="No check history has been recorded for this item yet."
            icon={<Clock className="h-5 w-5 text-inventory" />}
          >
            {checks.map((check) => (
              <InventoryCheckTimelineEntry
                key={check.id}
                check={check}
                downloading={downloadingCheckId === check.id}
                onDownloadPdf={() => handleDownloadCheckPdf(check.id)}
              />
            ))}
          </TimelineCard>
        </TabsContent>
      </Tabs>

      {!isRetired && checkStatus === 'overdue' ? (
        <Card className="border-red-500/30 bg-red-500/10">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-red-100">
            <AlertTriangle className="h-4 w-4" />
            This item is overdue for its check.
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={showCheckTypeModal} onOpenChange={setShowCheckTypeModal}>
        <DialogContent className="border border-border bg-slate-950 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose Check Type</DialogTitle>
            <DialogDescription>
              Select the checklist to complete for {item.name} ({item.item_number}).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {INVENTORY_CHECKLIST_DEFINITIONS.map((checklistDefinition) => (
              <button
                key={checklistDefinition.version}
                type="button"
                className="rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-left transition-colors hover:border-inventory/70 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inventory/60"
                onClick={() => handleChooseCheckType(checklistDefinition)}
                disabled={savingCheck}
              >
                <div className="font-semibold text-white">{checklistDefinition.label}</div>
                <div className="mt-2 text-sm text-muted-foreground">{checklistDefinition.pdfSubtitle}</div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <InventoryCheckModal
        key={checkModalSession}
        open={showCheckModal}
        onOpenChange={setShowCheckModal}
        itemName={item.name}
        itemNumber={item.item_number}
        checklistDefinition={selectedChecklistDefinition}
        initialCheckedAt={checkedAt}
        saving={savingCheck}
        onSubmit={handleRecordCheck}
      />
    </AppPageShell>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-800 pb-2 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium capitalize text-white">{value}</span>
    </div>
  );
}

function TimelineCard({
  title,
  emptyMessage,
  icon,
  children,
}: {
  title: string;
  emptyMessage: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <Card className="border-slate-700 bg-slate-900/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasChildren ? children : <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>}
      </CardContent>
    </Card>
  );
}

function TimelineEntry({
  title,
  meta,
  note,
  badge,
  actions,
  children,
}: {
  title: string;
  meta: string;
  note?: string | null;
  badge?: string | null;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-semibold text-white">{title}</div>
          <div className="text-xs text-muted-foreground">{meta}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {badge ? <Badge variant="outline" className="border-purple-500/30 bg-purple-500/10 text-purple-200">{badge}</Badge> : null}
          {actions}
        </div>
      </div>
      {note ? <p className="mt-3 text-sm text-slate-300">{note}</p> : null}
      {children}
    </div>
  );
}

function getOverallStatusBadgeClass(status: InventoryCheckOverallStatus): string {
  if (status === 'fail') return 'border-red-500/30 bg-red-500/10 text-red-200';
  if (status === 'partial') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  return 'border-green-500/30 bg-green-500/10 text-green-200';
}

function InventoryCheckTimelineEntry({
  check,
  downloading,
  onDownloadPdf,
}: {
  check: InventoryCheck;
  downloading: boolean;
  onDownloadPdf: () => void;
}) {
  const checklistItems = Array.isArray(check.checklist_items) ? check.checklist_items : null;
  const summary = checklistItems ? getInventoryChecklistSummary(checklistItems) : null;
  const overallStatus = summary ? check.overall_status || (summary.fail > 0 ? 'fail' : 'pass') : null;
  const failedItems = checklistItems?.filter((item) => item.status === 'attention') || [];
  const checkTypeLabel = getInventoryChecklistLabel(check.checklist_version);

  return (
    <TimelineEntry
      title={`${checkTypeLabel} · ${formatInventoryDate(check.checked_at)}`}
      meta={`${check.checked_by_profile?.full_name || 'Unknown user'} · interval ${formatInventoryCheckIntervalMonths(getInventoryCheckIntervalMonths({ check_interval_days: check.interval_days }))}`}
      note={check.note}
      badge={null}
      actions={checklistItems ? (
        <>
          {overallStatus ? (
            <Badge variant="outline" className={getOverallStatusBadgeClass(overallStatus)}>
              {INVENTORY_CHECK_OVERALL_STATUS_LABELS[overallStatus]}
            </Badge>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 border-slate-600"
            onClick={onDownloadPdf}
            disabled={downloading}
          >
            {downloading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
            PDF
          </Button>
        </>
      ) : null}
    >
      {summary ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-200">Pass {summary.pass}</Badge>
            <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-200">Fail {summary.fail}</Badge>
            <Badge variant="outline" className="border-slate-500/30 bg-slate-500/10 text-slate-200">N/A {summary.na}</Badge>
            <Badge variant="outline" className="border-slate-500/30 bg-slate-500/10 text-slate-200">Total {summary.total}</Badge>
          </div>

          {failedItems.length > 0 ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-red-200">Failed Items</div>
              <div className="mt-2 space-y-2">
                {failedItems.map((item) => (
                  <div key={item.item_number} className="text-sm text-red-50">
                    <span className="font-medium">#{item.item_number} {item.label}</span>
                    {item.comment ? <span className="text-red-100">: {item.comment}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </TimelineEntry>
  );
}
