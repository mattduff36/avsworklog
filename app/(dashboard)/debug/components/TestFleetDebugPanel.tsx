'use client';

import { useState } from 'react';
import { AlertTriangle, Car, Loader2, RefreshCw, Search, Trash, Truck, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { PurgeActions, TestVehicle } from '../types';

export function TestFleetDebugPanel() {
  const [testVehiclePrefix, setTestVehiclePrefix] = useState('TE57');
  const [fleetTypeFilter, setFleetTypeFilter] = useState<'vans' | 'hgvs' | 'plant' | 'all'>('all');
  const [testVehicles, setTestVehicles] = useState<TestVehicle[]>([]);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([]);
  const [loadingTestVehicles, setLoadingTestVehicles] = useState(false);
  const [purgePreview, setPurgePreview] = useState<Record<string, number> | null>(null);
  const [purging, setPurging] = useState(false);
  const [purgeActions, setPurgeActions] = useState<PurgeActions>({
    inspections: true,
    workshop_tasks: true,
    maintenance: true,
    attachments: true,
    archives: true,
  });

  const fetchTestVehicles = async () => {
    setLoadingTestVehicles(true);
    try {
      const response = await fetch(`/api/debug/test-vehicles?prefix=${encodeURIComponent(testVehiclePrefix)}&type=${fleetTypeFilter}`);
      const data = await response.json();

      if (data.success) {
        setTestVehicles(data.vehicles || []);
        setSelectedVehicleIds([]);
        setPurgePreview(null);
      } else {
        toast.error(data.error || 'Failed to fetch test fleet');
      }
    } catch (error) {
      console.error('Error fetching test fleet:', error);
      toast.error('Failed to fetch test fleet');
    } finally {
      setLoadingTestVehicles(false);
    }
  };

  const previewPurge = async () => {
    if (selectedVehicleIds.length === 0) {
      toast.error('Please select at least one fleet item');
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
      const combinedCounts: Record<string, number> = {};
      for (const [ft, ids] of Object.entries(byType)) {
        if (ids.length === 0) continue;
        const response = await fetch('/api/debug/test-vehicles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'preview',
            vehicle_ids: ids,
            prefix: testVehiclePrefix,
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

  const executePurge = async () => {
    if (selectedVehicleIds.length === 0) {
      toast.error('Please select at least one fleet item');
      return;
    }

    const byType = { vans: [] as string[], hgvs: [] as string[], plant: [] as string[] };
    for (const id of selectedVehicleIds) {
      const v = testVehicles.find((t) => t.id === id);
      if (v?.fleet_type === 'hgv') byType.hgvs.push(id);
      else if (v?.fleet_type === 'plant') byType.plant.push(id);
      else byType.vans.push(id);
    }

    const notificationService = await import('@/lib/services/notification.service');
    const confirmed = await notificationService.notify.confirm({
      title: 'Confirm Purge',
      description: `This will permanently delete selected records for ${selectedVehicleIds.length} fleet item(s). This cannot be undone.`,
      confirmText: 'Purge Records',
      destructive: true,
    });

    if (!confirmed) return;

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
            prefix: testVehiclePrefix,
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
      setPurgePreview(null);
      fetchTestVehicles();
    } catch (error) {
      console.error('Error executing purge:', error);
      toast.error('Failed to execute purge');
    } finally {
      setPurging(false);
    }
  };

  const archiveVehicles = async () => {
    const vanIds = selectedVehicleIds.filter((id) => testVehicles.find((t) => t.id === id)?.fleet_type === 'van');
    if (vanIds.length === 0) {
      toast.error(
        selectedVehicleIds.length > 0
          ? 'Archive is only supported for vans. HGVs and plant must be hard deleted.'
          : 'Please select at least one fleet item',
      );
      return;
    }
    const nonVanCount = selectedVehicleIds.length - vanIds.length;
    const notificationService = await import('@/lib/services/notification.service');
    const confirmed = await notificationService.notify.confirm({
      title: 'Archive Fleet Items',
      description: `This will archive ${vanIds.length} van(s) (soft delete). ${nonVanCount > 0 ? `${nonVanCount} non-van item(s) selected will be skipped (use Hard Delete for HGVs/plant). ` : ''}Vans will be marked as archived and moved to van_archive.`,
      confirmText: 'Archive',
      destructive: false,
    });

    if (!confirmed) return;

    setPurging(true);
    try {
      const response = await fetch('/api/debug/test-vehicles', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_ids: vanIds,
          prefix: testVehiclePrefix,
          mode: 'archive',
          archive_reason: 'Test Data Cleanup',
          fleet_type: 'vans',
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Archived ${data.archived_count} van(s)`);
        fetchTestVehicles();
      } else {
        if (data.failed_vehicles?.length > 0) {
          const failedList = data.failed_vehicles.map((v: { reg_number: string }) => v.reg_number).join(', ');
          toast.error(`Archived ${data.archived_count} of ${data.total_requested}. Failed: ${failedList}`);
        } else {
          toast.error(data.error || 'Failed to archive');
        }
        fetchTestVehicles();
      }
    } catch (error) {
      console.error('Error archiving:', error);
      toast.error('Failed to archive');
    } finally {
      setPurging(false);
    }
  };

  const hardDeleteVehicles = async () => {
    if (selectedVehicleIds.length === 0) {
      toast.error('Please select at least one fleet item');
      return;
    }

    const byType = { vans: [] as string[], hgvs: [] as string[], plant: [] as string[] };
    for (const id of selectedVehicleIds) {
      const v = testVehicles.find((t) => t.id === id);
      if (v?.fleet_type === 'hgv') byType.hgvs.push(id);
      else if (v?.fleet_type === 'plant') byType.plant.push(id);
      else byType.vans.push(id);
    }

    const notificationService = await import('@/lib/services/notification.service');
    const confirmed = await notificationService.notify.confirm({
      title: '⚠️ HARD DELETE FLEET ITEMS',
      description: `This will PERMANENTLY DELETE ${selectedVehicleIds.length} fleet item(s) and ALL associated records from the database. This is IRREVERSIBLE and DANGEROUS. Only use for test data cleanup.`,
      confirmText: 'I understand - DELETE PERMANENTLY',
      destructive: true,
    });

    if (!confirmed) return;

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
            prefix: testVehiclePrefix,
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
      fetchTestVehicles();
    } catch (error) {
      console.error('Error deleting fleet items:', error);
      toast.error('Failed to delete');
    } finally {
      setPurging(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Car className="h-5 w-5 text-red-500" />
              Test Fleet Cleanup
            </CardTitle>
            <CardDescription>Manage and purge test fleet data (vans, HGVs & plant, TE57 prefix)</CardDescription>
          </div>
          <Button onClick={fetchTestVehicles} variant="outline" size="sm" disabled={loadingTestVehicles}>
            {loadingTestVehicles ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="vehicle-prefix" className="text-sm font-medium">
                Fleet Registration Prefix
              </Label>
              <div className="flex gap-2">
                <Input
                  id="vehicle-prefix"
                  value={testVehiclePrefix}
                  onChange={(e) => setTestVehiclePrefix(e.target.value.toUpperCase())}
                  placeholder="TE57"
                  className="w-32 font-mono"
                />
                <Button onClick={fetchTestVehicles} disabled={loadingTestVehicles || !testVehiclePrefix.trim()}>
                  Load Fleet
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Fleet Type</Label>
              <Select value={fleetTypeFilter} onValueChange={(v: 'vans' | 'hgvs' | 'plant' | 'all') => setFleetTypeFilter(v)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All (Vans + HGVs + Plant)</SelectItem>
                  <SelectItem value="vans">Vans only</SelectItem>
                  <SelectItem value="hgvs">HGVs only</SelectItem>
                  <SelectItem value="plant">Plant only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Only fleet items starting with this prefix can be managed here</p>
        </div>

        {testVehicles.length > 0 && (
          <div className="space-y-3">
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

            <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
              {testVehicles.map((vehicle) => (
                <div
                  key={vehicle.id}
                  className="flex items-center gap-3 p-3 hover:bg-accent cursor-pointer"
                  onClick={() => {
                    setSelectedVehicleIds((prev) => (prev.includes(vehicle.id) ? prev.filter((id) => id !== vehicle.id) : [...prev, vehicle.id]));
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedVehicleIds.includes(vehicle.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      setSelectedVehicleIds((prev) => (prev.includes(vehicle.id) ? prev.filter((id) => id !== vehicle.id) : [...prev, vehicle.id]));
                    }}
                    className="h-4 w-4 rounded border-2 border-slate-400 dark:border-slate-600 text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 cursor-pointer bg-white dark:bg-slate-800"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold">{vehicle.reg_number}</span>
                      {vehicle.nickname && <span className="text-sm text-muted-foreground">({vehicle.nickname})</span>}
                      <Badge variant="outline" className="text-xs font-normal gap-0.5">
                        {vehicle.fleet_type === 'hgv' ? (
                          <Truck className="h-3 w-3" />
                        ) : vehicle.fleet_type === 'plant' ? (
                          <Wrench className="h-3 w-3" />
                        ) : (
                          <Car className="h-3 w-3" />
                        )}
                        {(vehicle.fleet_type || 'van').toUpperCase()}
                      </Badge>
                      <Badge variant={vehicle.status === 'active' ? 'default' : 'secondary'} className="text-xs">
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
            <p>No fleet items found matching prefix &quot;{testVehiclePrefix}&quot;</p>
            <p className="text-sm mt-1">Click &quot;Load Fleet&quot; to search</p>
          </div>
        )}

        {selectedVehicleIds.length > 0 && (
          <>
            <div className="space-y-2 p-4 border rounded-lg bg-muted/30">
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
              <div className="p-4 border border-yellow-500 rounded-lg bg-yellow-50 dark:bg-yellow-950/20">
                <div className="flex items-start gap-2 mb-3">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-yellow-900 dark:text-yellow-300">Preview: Records to be deleted</h4>
                    <p className="text-sm text-yellow-800 dark:text-yellow-400 mt-1">{selectedVehicleIds.length} fleet item(s) selected</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {Object.entries(purgePreview).map(([key, value]) => (
                    <div key={key} className="flex justify-between p-2 bg-white dark:bg-slate-900 rounded">
                      <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}:</span>
                      <span className="font-mono font-semibold text-yellow-900 dark:text-yellow-300">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 pt-4 border-t">
              <div className="flex gap-2">
                <Button onClick={previewPurge} variant="outline" disabled={purging || selectedVehicleIds.length === 0}>
                  <Search className="h-4 w-4 mr-2" />
                  Preview Counts
                </Button>
                <Button onClick={executePurge} variant="destructive" disabled={purging || selectedVehicleIds.length === 0}>
                  {purging ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash className="h-4 w-4 mr-2" />}
                  Purge Selected Records
                </Button>
              </div>

              <div className="pt-3 border-t">
                <p className="text-sm font-medium text-muted-foreground mb-3">Fleet Actions (records must be purged first):</p>
                <div className="flex gap-2">
                  <Button onClick={archiveVehicles} variant="outline" disabled={purging || selectedVehicleIds.length === 0}>
                    Archive Vans (vans only)
                  </Button>
                  <Button
                    onClick={hardDeleteVehicles}
                    variant="destructive"
                    disabled={purging || selectedVehicleIds.length === 0}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Hard Delete Fleet
                  </Button>
                </div>
                <p className="text-xs text-red-600 dark:text-red-400 mt-2">⚠️ Hard Delete permanently removes fleet items from the database</p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
