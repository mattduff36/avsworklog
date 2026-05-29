'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Car, Database, Loader2, RefreshCw, Search, ShieldCheck, Trash, Truck, Wrench } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { PurgeActions, TestVehicle } from '../types';

const TEST_FLEET_PREFIX = 'TE57';
const TEST_FLEET_TYPE = 'all';

type VehicleIdsByFleetType = {
  vans: string[];
  hgvs: string[];
  plant: string[];
};

type TestFleetSummaryTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

interface TestFleetSummaryMetric {
  title: string;
  value: string;
  detail: string;
  tone: TestFleetSummaryTone;
  icon: ReactNode;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-GB');
}

function getTestFleetMetricClasses(tone: TestFleetSummaryTone): string {
  switch (tone) {
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100';
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-100';
    case 'danger':
      return 'border-red-500/30 bg-red-500/10 text-red-100';
    case 'info':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-100';
    default:
      return 'border-slate-500/30 bg-slate-500/10 text-slate-100';
  }
}

function TestFleetSummaryMetricCard({ metric }: { metric: TestFleetSummaryMetric }) {
  return (
    <div className={`rounded-xl border p-4 ${getTestFleetMetricClasses(metric.tone)}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{metric.title}</p>
          <p className="mt-2 text-xl font-bold">{metric.value}</p>
        </div>
        <span className="opacity-85">{metric.icon}</span>
      </div>
      <p className="mt-2 text-sm leading-5 opacity-85">{metric.detail}</p>
    </div>
  );
}

function getQuickPurgeTargetLabel(prefix: string, fleetType: 'vans' | 'hgvs' | 'plant' | 'all'): string {
  const normalizedPrefix = prefix.trim().toUpperCase();
  const prefixLabel = normalizedPrefix || 'matching';

  if (fleetType === 'hgvs') {
    return `${prefixLabel} HGVs`;
  }

  if (fleetType === 'plant') {
    return `${prefixLabel} Plant Assets`;
  }

  if (fleetType === 'vans') {
    return `${prefixLabel} Vans`;
  }

  return `${prefixLabel} Assets`;
}

function getSelectionKey(vehicleIds: string[]): string {
  return [...vehicleIds].sort().join('|');
}

function groupVehicleIdsByFleetType(vehicleIds: string[], vehicles: TestVehicle[]): VehicleIdsByFleetType {
  return vehicleIds.reduce<VehicleIdsByFleetType>(
    (acc, id) => {
      const vehicle = vehicles.find((entry) => entry.id === id);
      if (vehicle?.fleet_type === 'hgv') {
        acc.hgvs.push(id);
      } else if (vehicle?.fleet_type === 'plant') {
        acc.plant.push(id);
      } else {
        acc.vans.push(id);
      }
      return acc;
    },
    { vans: [], hgvs: [], plant: [] },
  );
}

export function TestFleetDebugPanel() {
  const [testVehicles, setTestVehicles] = useState<TestVehicle[]>([]);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([]);
  const [loadingTestVehicles, setLoadingTestVehicles] = useState(false);
  const [purgePreview, setPurgePreview] = useState<Record<string, number> | null>(null);
  const [purging, setPurging] = useState(false);
  const [confirmQuickPurge, setConfirmQuickPurge] = useState(false);
  const [hardDeleteDialogOpen, setHardDeleteDialogOpen] = useState(false);
  const [purgedSelectionKey, setPurgedSelectionKey] = useState<string | null>(null);
  const [purgeActions, setPurgeActions] = useState<PurgeActions>({
    inspections: true,
    workshop_tasks: true,
    maintenance: true,
    attachments: true,
    archives: true,
  });
  const quickPurgeConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickPurgeTargetLabel = getQuickPurgeTargetLabel(TEST_FLEET_PREFIX, TEST_FLEET_TYPE);
  const selectedSelectionKey = getSelectionKey(selectedVehicleIds);
  const canHardDeleteSelectedFleet = selectedVehicleIds.length > 0 && purgedSelectionKey === selectedSelectionKey;
  const fleetCounts = testVehicles.reduce(
    (acc, vehicle) => {
      if (vehicle.fleet_type === 'hgv') acc.hgvs += 1;
      else if (vehicle.fleet_type === 'plant') acc.plant += 1;
      else acc.vans += 1;
      return acc;
    },
    { vans: 0, hgvs: 0, plant: 0 },
  );
  const purgePreviewTotal = purgePreview
    ? Object.values(purgePreview).reduce((total, value) => total + Number(value), 0)
    : 0;
  const testFleetSummaryMetrics: TestFleetSummaryMetric[] = [
    {
      title: 'Matching test assets',
      value: formatNumber(testVehicles.length),
      detail: `${formatNumber(fleetCounts.vans)} vans, ${formatNumber(fleetCounts.hgvs)} HGVs, and ${formatNumber(fleetCounts.plant)} plant assets match ${TEST_FLEET_PREFIX}.`,
      tone: testVehicles.length > 0 ? 'info' : 'neutral',
      icon: <Car className="h-5 w-5" />,
    },
    {
      title: 'Selected assets',
      value: formatNumber(selectedVehicleIds.length),
      detail: selectedVehicleIds.length > 0 ? 'These assets are staged for preview, purge, or hard delete actions.' : 'Select assets before previewing or purging linked records.',
      tone: selectedVehicleIds.length > 0 ? 'warning' : 'neutral',
      icon: <ShieldCheck className="h-5 w-5" />,
    },
    {
      title: 'Previewed records',
      value: purgePreview ? formatNumber(purgePreviewTotal) : 'Not previewed',
      detail: purgePreview ? 'Linked records found by the latest preview and ready for controlled purge.' : 'Run Preview Counts before purging to see the affected record volume.',
      tone: purgePreviewTotal > 0 ? 'danger' : 'neutral',
      icon: <Database className="h-5 w-5" />,
    },
    {
      title: 'Hard delete status',
      value: canHardDeleteSelectedFleet ? 'Unlocked' : 'Locked',
      detail: canHardDeleteSelectedFleet ? 'Selected records have been purged, so hard delete is available for the same selection.' : 'Hard delete unlocks only after selected linked records have been purged.',
      tone: canHardDeleteSelectedFleet ? 'danger' : 'success',
      icon: <AlertTriangle className="h-5 w-5" />,
    },
  ];

  const clearQuickPurgeConfirmation = () => {
    if (quickPurgeConfirmTimeoutRef.current) {
      clearTimeout(quickPurgeConfirmTimeoutRef.current);
      quickPurgeConfirmTimeoutRef.current = null;
    }
    setConfirmQuickPurge(false);
  };

  const armQuickPurgeConfirmation = () => {
    if (quickPurgeConfirmTimeoutRef.current) {
      clearTimeout(quickPurgeConfirmTimeoutRef.current);
    }

    setConfirmQuickPurge(true);
    quickPurgeConfirmTimeoutRef.current = setTimeout(() => {
      setConfirmQuickPurge(false);
      quickPurgeConfirmTimeoutRef.current = null;
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (quickPurgeConfirmTimeoutRef.current) {
        clearTimeout(quickPurgeConfirmTimeoutRef.current);
      }
    };
  }, []);

  const fetchTestVehicles = useCallback(async (options?: { preserveSelectedIds?: string[] }): Promise<TestVehicle[] | null> => {
    setLoadingTestVehicles(true);
    try {
      const response = await fetch(`/api/debug/test-vehicles?prefix=${encodeURIComponent(TEST_FLEET_PREFIX)}&type=${TEST_FLEET_TYPE}`);
      const data = await response.json();

      if (data.success) {
        const vehicles = (data.vehicles || []) as TestVehicle[];
        setTestVehicles(vehicles);
        if (options?.preserveSelectedIds) {
          const availableVehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
          setSelectedVehicleIds(options.preserveSelectedIds.filter((id) => availableVehicleIds.has(id)));
        } else {
          setSelectedVehicleIds([]);
          setPurgedSelectionKey(null);
        }
        setPurgePreview(null);
        return vehicles;
      } else {
        toast.error(data.error || 'Failed to fetch test fleet');
      }
    } catch (error) {
      console.error('Error fetching test fleet:', error);
      toast.error('Failed to fetch test fleet');
    } finally {
      setLoadingTestVehicles(false);
    }
    return null;
  }, []);

  useEffect(() => {
    void fetchTestVehicles();
  }, [fetchTestVehicles]);

  const previewPurge = async () => {
    if (selectedVehicleIds.length === 0) {
      toast.error('Please select at least one fleet item');
      return;
    }

    const byType = groupVehicleIdsByFleetType(selectedVehicleIds, testVehicles);

    setPurging(true);
    try {
      const combinedCounts: Record<string, number> = {};
      for (const [ft, ids] of Object.entries(byType)) {
        if (ids.length === 0) continue;
        const response = await fetch('/api/debug/test-vehicles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'preview',
            vehicle_ids: ids,
            prefix: TEST_FLEET_PREFIX,
            actions: purgeActions,
            fleet_type: ft,
          }),
        });
        const data = await response.json();
        if (!data.success) {
          toast.error(data.error || 'Failed to preview purge');
          return;
        }
        for (const [k, v] of Object.entries(data.counts || {})) {
          combinedCounts[k] = (combinedCounts[k] || 0) + Number(v);
        }
      }
      setPurgePreview(combinedCounts);
      toast.success('Preview generated');
    } catch (error) {
      console.error('Error previewing purge:', error);
      toast.error('Failed to preview purge');
    } finally {
      setPurging(false);
    }
  };

  const executePurgeForSelection = async (
    vehicleIds: string[],
    vehicles: TestVehicle[],
    options?: { requireConfirmation?: boolean },
  ) => {
    if (vehicleIds.length === 0) {
      toast.error('Please select at least one fleet item');
      return;
    }

    const byType = groupVehicleIdsByFleetType(vehicleIds, vehicles);

    if (options?.requireConfirmation !== false) {
      const notificationService = await import('@/lib/services/notification.service');
      const confirmed = await notificationService.notify.confirm({
        title: 'Confirm Purge',
        description: `This will permanently delete selected records for ${vehicleIds.length} fleet item(s). This cannot be undone.`,
        confirmText: 'Purge Records',
        destructive: true,
      });

      if (!confirmed) return;
    }

    setPurging(true);
    try {
      let totalAffected = 0;
      for (const [ft, ids] of Object.entries(byType)) {
        if (ids.length === 0) continue;
        const response = await fetch('/api/debug/test-vehicles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'execute',
            vehicle_ids: ids,
            prefix: TEST_FLEET_PREFIX,
            actions: purgeActions,
            fleet_type: ft,
          }),
        });
        const data = await response.json();
        if (!data.success) {
          toast.error(data.error || 'Failed to execute purge');
          return;
        }
        totalAffected += data.affected_vehicles || 0;
      }
      toast.success(`Purged records for ${totalAffected} fleet item(s)`);
      setPurgedSelectionKey(getSelectionKey(vehicleIds));
      setPurgePreview(null);
      await fetchTestVehicles({ preserveSelectedIds: vehicleIds });
    } catch (error) {
      console.error('Error executing purge:', error);
      toast.error('Failed to execute purge');
    } finally {
      setPurging(false);
    }
  };

  const executePurge = async () => {
    await executePurgeForSelection(selectedVehicleIds, testVehicles);
  };

  const quickPurgeMatchingAssets = async () => {
    if (!confirmQuickPurge) {
      armQuickPurgeConfirmation();
      return;
    }

    clearQuickPurgeConfirmation();

    const latestVehicles = await fetchTestVehicles();
    if (!latestVehicles) {
      return;
    }

    if (latestVehicles.length === 0) {
      toast.error(`No fleet items found matching prefix "${TEST_FLEET_PREFIX}"`);
      return;
    }

    const latestVehicleIds = latestVehicles.map((vehicle) => vehicle.id);
    setSelectedVehicleIds(latestVehicleIds);
    await executePurgeForSelection(latestVehicleIds, latestVehicles, { requireConfirmation: false });
  };

  const hardDeleteVehicles = async () => {
    if (selectedVehicleIds.length === 0) {
      toast.error('Please select at least one fleet item');
      return;
    }

    if (!canHardDeleteSelectedFleet) {
      toast.error('Purge selected records before hard deleting fleet items');
      return;
    }

    const byType = { vans: [] as string[], hgvs: [] as string[], plant: [] as string[] };
    for (const id of selectedVehicleIds) {
      const v = testVehicles.find((t) => t.id === id);
      if (v?.fleet_type === 'hgv') byType.hgvs.push(id);
      else if (v?.fleet_type === 'plant') byType.plant.push(id);
      else byType.vans.push(id);
    }

    setPurging(true);
    try {
      let totalAffected = 0;
      let totalRecords = 0;
      for (const [ft, ids] of Object.entries(byType)) {
        if (ids.length === 0) continue;
        const response = await fetch('/api/debug/test-vehicles', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vehicle_ids: ids,
            prefix: TEST_FLEET_PREFIX,
            mode: 'hard_delete',
            fleet_type: ft,
          }),
        });
        const data = await response.json();
        if (!data.success) {
          toast.error(data.error || 'Failed to delete');
          return;
        }
        totalAffected += data.affected_vehicles || 0;
        totalRecords += Object.values(data.deleted_counts || {}).reduce((a: number, b: unknown) => a + Number(b), 0);
      }
      toast.success(`Hard deleted ${totalAffected} fleet item(s) and ${totalRecords} total records`);
      setPurgePreview(null);
      setPurgedSelectionKey(null);
      setHardDeleteDialogOpen(false);
      await fetchTestVehicles();
    } catch (error) {
      console.error('Error deleting fleet items:', error);
      toast.error('Failed to delete');
    } finally {
      setPurging(false);
    }
  };

  return (
    <Card className="overflow-hidden border-avs-yellow/20 bg-slate-950/60">
      <div className="pointer-events-none h-1 bg-gradient-to-r from-orange-500 to-red-600" />
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Car className="h-5 w-5 text-avs-yellow" />
              Test Fleet Cleanup
            </CardTitle>
            <CardDescription>Manage and purge test fleet data (vans, HGVs & plant, TE57 prefix)</CardDescription>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              onClick={quickPurgeMatchingAssets}
              variant={confirmQuickPurge ? 'outline' : 'destructive'}
              size="sm"
              disabled={loadingTestVehicles || purging}
              className={
                confirmQuickPurge
                  ? 'border border-red-500 text-red-300 bg-red-500/10 hover:bg-red-500/20 shadow-sm'
                  : 'border border-red-500/60 shadow-sm'
              }
            >
              {loadingTestVehicles || purging ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash className="h-4 w-4 mr-2" />}
              {loadingTestVehicles
                ? `Refreshing ${quickPurgeTargetLabel}...`
                : purging
                  ? `Purging ${quickPurgeTargetLabel}...`
                  : confirmQuickPurge
                    ? `Confirm Purge of ${quickPurgeTargetLabel}`
                    : `Quick Purge ${quickPurgeTargetLabel}`}
            </Button>
            <Button onClick={() => void fetchTestVehicles()} variant="outline" size="sm" disabled={loadingTestVehicles || purging}>
              {loadingTestVehicles ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-xl border border-slate-700/70 bg-slate-950/35 p-4">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-avs-yellow">Fleet Cleanup Summary</p>
            <p className="mt-1 text-sm text-slate-300">
              Manage the isolated {TEST_FLEET_PREFIX} test fleet without touching real operational assets.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {testFleetSummaryMetrics.map((metric) => (
              <TestFleetSummaryMetricCard key={metric.title} metric={metric} />
            ))}
          </div>
        </div>

        {testVehicles.length > 0 && (
          <div className="space-y-3 rounded-xl border border-slate-700/70 bg-slate-950/35 p-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                Select Fleet ({selectedVehicleIds.length} of {testVehicles.length} selected)
              </Label>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setSelectedVehicleIds(testVehicles.map((v) => v.id))}>
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSelectedVehicleIds([])}>
                  Clear
                </Button>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-700/70">
              {testVehicles.map((vehicle) => (
                <div
                  key={vehicle.id}
                  className="flex cursor-pointer items-center gap-3 border-b border-slate-700/70 p-3 transition-colors last:border-b-0 hover:bg-orange-500/5"
                  onClick={() => {
                    setSelectedVehicleIds((prev) => (prev.includes(vehicle.id) ? prev.filter((id) => id !== vehicle.id) : [...prev, vehicle.id]));
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedVehicleIds.includes(vehicle.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSelectedVehicleIds((prev) => (
                        checked
                          ? [...prev, vehicle.id]
                          : prev.filter((id) => id !== vehicle.id)
                      ));
                    }}
                    className="h-4 w-4 rounded border-2 border-slate-400 dark:border-slate-600 text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 cursor-pointer bg-white dark:bg-slate-800"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold">{vehicle.reg_number}</span>
                      {vehicle.nickname && <span className="text-sm text-muted-foreground">({vehicle.nickname})</span>}
                      <Badge variant="outline" className="gap-0.5 border-orange-500/30 bg-orange-500/10 text-xs font-normal text-orange-300">
                        {vehicle.fleet_type === 'hgv' ? (
                          <Truck className="h-3 w-3" />
                        ) : vehicle.fleet_type === 'plant' ? (
                          <Wrench className="h-3 w-3" />
                        ) : (
                          <Car className="h-3 w-3" />
                        )}
                        {(vehicle.fleet_type || 'van').toUpperCase()}
                      </Badge>
                      <Badge variant={vehicle.status === 'active' ? 'success' : 'secondary'} className="text-xs">
                        {vehicle.status}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {testVehicles.length === 0 && !loadingTestVehicles && (
          <div className="text-center py-8 text-muted-foreground">
            <Car className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No fleet items found matching prefix &quot;{TEST_FLEET_PREFIX}&quot;</p>
            <p className="text-sm mt-1">The fleet loads automatically, or use Refresh to reload</p>
          </div>
        )}

        {selectedVehicleIds.length > 0 && (
          <>
            <div className="space-y-2 rounded-xl border border-slate-700/70 bg-slate-950/35 p-4">
              <Label className="text-sm font-medium">Records to Purge</Label>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="purge-inspections"
                    checked={purgeActions.inspections}
                    onChange={(e) => setPurgeActions((prev) => ({ ...prev, inspections: e.target.checked }))}
                    className="h-4 w-4 rounded border-2 border-slate-400 dark:border-slate-600 text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 cursor-pointer bg-white dark:bg-slate-800"
                  />
                  <Label htmlFor="purge-inspections" className="text-sm font-normal cursor-pointer">
                    Inspections (van/HGV/plant; items, photos)
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="purge-tasks"
                    checked={purgeActions.workshop_tasks}
                    onChange={(e) => setPurgeActions((prev) => ({ ...prev, workshop_tasks: e.target.checked }))}
                    className="h-4 w-4 rounded border-2 border-slate-400 dark:border-slate-600 text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 cursor-pointer bg-white dark:bg-slate-800"
                  />
                  <Label htmlFor="purge-tasks" className="text-sm font-normal cursor-pointer">
                    Workshop Tasks (and comments, attachments)
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="purge-maintenance"
                    checked={purgeActions.maintenance}
                    onChange={(e) => setPurgeActions((prev) => ({ ...prev, maintenance: e.target.checked }))}
                    className="h-4 w-4 rounded border-2 border-slate-400 dark:border-slate-600 text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 cursor-pointer bg-white dark:bg-slate-800"
                  />
                  <Label htmlFor="purge-maintenance" className="text-sm font-normal cursor-pointer">
                    Maintenance Records (history, DVLA logs, MOT data)
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="purge-attachments"
                    checked={purgeActions.attachments}
                    onChange={(e) => setPurgeActions((prev) => ({ ...prev, attachments: e.target.checked }))}
                    className="h-4 w-4 rounded border-2 border-slate-400 dark:border-slate-600 text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 cursor-pointer bg-white dark:bg-slate-800"
                  />
                  <Label htmlFor="purge-attachments" className="text-sm font-normal cursor-pointer">
                    Workshop Attachments (usually cascades with tasks)
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="purge-archives"
                    checked={purgeActions.archives}
                    onChange={(e) => setPurgeActions((prev) => ({ ...prev, archives: e.target.checked }))}
                    className="h-4 w-4 rounded border-2 border-slate-400 dark:border-slate-600 text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 cursor-pointer bg-white dark:bg-slate-800"
                  />
                  <Label htmlFor="purge-archives" className="text-sm font-normal cursor-pointer">
                    Van Archive Entries (vans only)
                  </Label>
                </div>
              </div>
            </div>

            {purgePreview && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                <div className="flex items-start gap-2 mb-3">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-amber-200">Preview: Records to be deleted</h4>
                    <p className="mt-1 text-sm text-amber-100/80">{selectedVehicleIds.length} fleet item(s) selected</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {Object.entries(purgePreview).map(([key, value]) => (
                    <div key={key} className="flex justify-between rounded border border-amber-500/20 bg-slate-950/45 p-2">
                      <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}:</span>
                      <span className="font-mono font-semibold text-amber-200">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 pt-4 border-t">
              <div className="flex flex-wrap gap-2">
                <Button onClick={previewPurge} variant="outline" disabled={purging || selectedVehicleIds.length === 0}>
                  <Search className="h-4 w-4 mr-2" />
                  Preview Counts
                </Button>
                <Button
                  onClick={executePurge}
                  variant="destructive"
                  disabled={purging || selectedVehicleIds.length === 0}
                  className="border border-red-500/60 shadow-sm"
                >
                  {purging ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash className="h-4 w-4 mr-2" />}
                  Purge Selected Records
                </Button>
                <Button
                  onClick={() => setHardDeleteDialogOpen(true)}
                  variant="destructive"
                  disabled={purging || !canHardDeleteSelectedFleet}
                  className="bg-red-600 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  title={!canHardDeleteSelectedFleet ? 'Purge selected records before hard deleting fleet items' : undefined}
                >
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Hard Delete Fleet
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={hardDeleteDialogOpen} onOpenChange={setHardDeleteDialogOpen}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-start gap-2 text-red-300">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              Hard Delete Fleet Items
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 leading-6 text-slate-300">
              <span className="block">
                This will permanently delete {selectedVehicleIds.length} fleet item(s) from the database.
              </span>
              <span className="block">
                Only continue after the selected records have been purged. This action is irreversible and should only be used for test data cleanup.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purging}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void hardDeleteVehicles();
              }}
              disabled={purging || !canHardDeleteSelectedFleet}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {purging ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              I understand, delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
