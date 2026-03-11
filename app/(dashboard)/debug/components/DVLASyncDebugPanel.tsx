'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RefreshCw, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function DVLASyncDebugPanel() {
  const [regNumber, setRegNumber] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [bulkSyncing, setBulkSyncing] = useState(false);
  interface SyncResultRow {
    success: boolean;
    registrationNumber?: string;
    assetType?: string;
    updatedFields?: string[];
    fields_updated?: string[];
    error?: string;
    errors?: string[];
    syncedAt?: string;
  }
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    message?: string;
    total?: number;
    successful?: number;
    failed?: number;
    results?: SyncResultRow[];
    data?: unknown;
  } | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [vehicleCount, setVehicleCount] = useState(0);

  const handleSingleSync = async () => {
    if (!regNumber.trim()) {
      toast.error('Please enter a registration number');
      return;
    }

    setSyncing(true);
    setSyncResult(null);

    try {
      // First, find the vehicle ID from registration
      const vehiclesResponse = await fetch('/api/maintenance');
      const vehiclesData = await vehiclesResponse.json();
      
      if (!vehiclesData.success) {
        throw new Error('Failed to fetch vans');
      }

      const normalizedReg = regNumber.replace(/\s+/g, '').toUpperCase();
      const vehicle = vehiclesData.vehicles.find((v: {
        vehicle?: { reg_number?: string; asset_type?: 'van' | 'hgv' | 'plant' };
        van_id?: string | null;
        hgv_id?: string | null;
        plant_id?: string | null;
        id?: string | null;
      }) => v.vehicle?.reg_number?.replace(/\s+/g, '').toUpperCase() === normalizedReg);

      if (!vehicle) {
        toast.error(`Asset ${regNumber} not found in database.`);
        setSyncing(false);
        return;
      }

      const assetType = vehicle.vehicle?.asset_type || 'van';
      const assetId = vehicle.van_id || vehicle.hgv_id || vehicle.plant_id || vehicle.id;
      if (!assetId) {
        toast.error(`Found ${regNumber}, but no valid asset ID was resolved`);
        setSyncing(false);
        return;
      }

      const response = await fetch('/api/maintenance/sync-dvla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId, assetType }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Sync failed');
      }

      setSyncResult(data);
      
      if (data.successful > 0) {
        toast.success(`Successfully synced ${regNumber}`);
      } else {
        toast.error(`Failed to sync ${regNumber}`);
      }

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to sync asset';
      console.error('Sync error:', error);
      toast.error(errorMessage);
      setSyncResult({ success: false, message: errorMessage });
    } finally {
      setSyncing(false);
    }
  };

  const handleBulkSyncClick = async () => {
      // Get road-eligible asset count first
    try {
      const response = await fetch('/api/maintenance');
      const data = await response.json();
      
      if (data.success) {
          const activeVehicles = data.vehicles.filter((v: {
            vehicle?: { status?: string; reg_number?: string };
          }) =>
            (v.vehicle?.status === 'active' || !v.vehicle?.status) &&
            Boolean(v.vehicle?.reg_number)
        );
        setVehicleCount(activeVehicles.length);
        setShowBulkConfirm(true);
      }
    } catch {
      toast.error('Failed to get van count');
    }
  };

  const handleBulkSync = async () => {
    setShowBulkConfirm(false);
    setBulkSyncing(true);
    setSyncResult(null);

    try {
      const response = await fetch('/api/maintenance/sync-dvla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncAll: true }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Bulk sync failed');
      }

      setSyncResult(data);
      toast.success(`Bulk sync complete: ${data.successful}/${data.total} successful`);

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to bulk sync assets';
      console.error('Bulk sync error:', error);
      toast.error(errorMessage);
      setSyncResult({ success: false, message: errorMessage });
    } finally {
      setBulkSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Configuration Info */}
      <Alert className="bg-amber-500/10 border-amber-500/50 text-amber-400">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="text-amber-300">Developer Tool</AlertTitle>
        <AlertDescription className="text-amber-200/80">
          These controls sync van tax & MOT due dates from GOV.UK APIs (VES & MOT History). Each sync uses your production API quota.
        </AlertDescription>
      </Alert>

      {/* Single Van Sync */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-white">Sync Single Van</CardTitle>
          <CardDescription className="text-muted-foreground">
            Sync tax & MOT due dates for a specific fleet asset by registration number
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="regNumber" className="text-muted-foreground">Registration Number</Label>
            <div className="flex gap-2">
              <Input
                id="regNumber"
                placeholder="e.g. AB12 CDE"
                value={regNumber}
                onChange={(e) => setRegNumber(e.target.value.toUpperCase())}
                disabled={syncing}
                className="flex-1 bg-input border-border text-white placeholder:text-muted-foreground"
              />
              <Button 
                onClick={handleSingleSync}
                disabled={syncing || !regNumber.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {syncing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Sync
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Sync All Road-Eligible Assets */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-white">Bulk Sync All Road Assets</CardTitle>
          <CardDescription className="text-muted-foreground">
            Sync tax & MOT due dates for all active fleet assets with license plates
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={handleBulkSyncClick}
            disabled={bulkSyncing}
            variant="outline"
            className="w-full border-slate-600 text-white hover:bg-slate-800"
          >
            {bulkSyncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing All Assets...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync All Assets (Tax & MOT Dates)
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Sync Results */}
      {syncResult && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              {syncResult.success ? (
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              ) : (
                <XCircle className="h-5 w-5 text-red-400" />
              )}
              Sync Results
              {syncResult.total != null && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ({syncResult.successful ?? 0} ok / {syncResult.failed ?? 0} failed / {syncResult.total} total)
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {syncResult.results?.length ? (
              <div className="space-y-1 max-h-[600px] overflow-auto">
                {syncResult.results.map((row, idx) => {
                  const updated = row.updatedFields?.length || row.fields_updated?.length;
                  const hasError = !row.success;
                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs font-mono ${
                        hasError
                          ? 'bg-red-950/40 border border-red-800/50'
                          : updated
                            ? 'bg-green-950/40 border border-green-800/50'
                            : 'bg-slate-800/60 border border-slate-700/50'
                      }`}
                    >
                      {hasError ? (
                        <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                      ) : updated ? (
                        <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={hasError ? 'text-red-300 font-semibold' : updated ? 'text-green-300 font-semibold' : 'text-slate-400'}>
                            {row.registrationNumber || 'Unknown'}
                          </span>
                          {row.assetType && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 uppercase">
                              {row.assetType}
                            </span>
                          )}
                          {updated ? (
                            <span className="text-green-400">
                              Updated: {(row.updatedFields || row.fields_updated || []).join(', ')}
                            </span>
                          ) : !hasError ? (
                            <span className="text-slate-500">No changes</span>
                          ) : null}
                        </div>
                        {hasError && (
                          <div className="text-red-400 mt-1">
                            {row.error || row.errors?.join('; ') || 'Unknown error'}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <pre className="bg-slate-800 border border-slate-700 p-4 rounded-md overflow-auto text-xs text-muted-foreground">
                {JSON.stringify(syncResult, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      {/* Bulk Sync Confirmation Dialog */}
      <Dialog open={showBulkConfirm} onOpenChange={setShowBulkConfirm}>
        <DialogContent className="border-border text-white">
          <DialogHeader>
            <DialogTitle className="text-xl text-white">Confirm Bulk Sync</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This will sync tax & MOT due dates for <strong className="text-white">{vehicleCount} active road-eligible assets</strong> from GOV.UK APIs.
              <br /><br />
              <strong className="text-white">API Usage:</strong> ~{vehicleCount * 2} API calls (VES + MOT)
              <br />
              <strong className="text-white">Time:</strong> ~{Math.ceil(vehicleCount / 60)} minutes (1 call per second)
              <br /><br />
              This will use your production API quota. Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowBulkConfirm(false)}
              className="border-slate-600 text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleBulkSync}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Yes, Sync All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

