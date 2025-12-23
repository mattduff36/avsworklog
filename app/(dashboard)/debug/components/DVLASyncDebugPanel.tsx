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
  const [syncResult, setSyncResult] = useState<any>(null);
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
        throw new Error('Failed to fetch vehicles');
      }

      const normalizedReg = regNumber.replace(/\s+/g, '').toUpperCase();
      const vehicle = vehiclesData.vehicles.find((v: any) => 
        v.vehicle?.reg_number?.replace(/\s+/g, '').toUpperCase() === normalizedReg
      );

      if (!vehicle) {
        toast.error(`Vehicle ${regNumber} not found in database`);
        setSyncing(false);
        return;
      }

      // Now sync that vehicle
      const response = await fetch('/api/maintenance/sync-dvla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: vehicle.vehicle_id }),
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

    } catch (error: any) {
      console.error('Sync error:', error);
      toast.error(error.message || 'Failed to sync vehicle');
      setSyncResult({ success: false, error: error.message });
    } finally {
      setSyncing(false);
    }
  };

  const handleBulkSyncClick = async () => {
    // Get vehicle count first
    try {
      const response = await fetch('/api/maintenance');
      const data = await response.json();
      
      if (data.success) {
        const activeVehicles = data.vehicles.filter((v: any) => 
          v.vehicle?.status === 'active' || !v.vehicle?.status
        );
        setVehicleCount(activeVehicles.length);
        setShowBulkConfirm(true);
      }
    } catch (error) {
      toast.error('Failed to get vehicle count');
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

    } catch (error: any) {
      console.error('Bulk sync error:', error);
      toast.error(error.message || 'Failed to bulk sync vehicles');
      setSyncResult({ success: false, error: error.message });
    } finally {
      setBulkSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Configuration Info */}
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Developer Tool</AlertTitle>
        <AlertDescription>
          These controls sync vehicle tax due dates from GOV.UK VES API. Each sync uses your production API quota.
        </AlertDescription>
      </Alert>

      {/* Single Vehicle Sync */}
      <Card>
        <CardHeader>
          <CardTitle>Sync Single Vehicle</CardTitle>
          <CardDescription>
            Sync tax due date for a specific vehicle by registration number
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="regNumber">Registration Number</Label>
            <div className="flex gap-2">
              <Input
                id="regNumber"
                placeholder="e.g. AB12 CDE"
                value={regNumber}
                onChange={(e) => setRegNumber(e.target.value.toUpperCase())}
                disabled={syncing}
                className="flex-1"
              />
              <Button 
                onClick={handleSingleSync}
                disabled={syncing || !regNumber.trim()}
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

      {/* Bulk Sync All Vehicles */}
      <Card>
        <CardHeader>
          <CardTitle>Bulk Sync All Vehicles</CardTitle>
          <CardDescription>
            Sync tax due dates for all active vehicles in the database
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={handleBulkSyncClick}
            disabled={bulkSyncing}
            variant="outline"
            className="w-full"
          >
            {bulkSyncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing All Vehicles...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync All Vehicles (Tax Dates)
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Sync Results */}
      {syncResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {syncResult.success ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <XCircle className="h-5 w-5 text-red-500" />
              )}
              Sync Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-slate-100 dark:bg-slate-800 p-4 rounded-md overflow-auto text-xs">
              {JSON.stringify(syncResult, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Bulk Sync Confirmation Dialog */}
      <Dialog open={showBulkConfirm} onOpenChange={setShowBulkConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Bulk Sync</DialogTitle>
            <DialogDescription>
              This will sync tax due dates for <strong>{vehicleCount} active vehicles</strong> from the DVLA API.
              <br /><br />
              <strong>API Usage:</strong> ~{vehicleCount} API calls
              <br />
              <strong>Time:</strong> ~{Math.ceil(vehicleCount / 60)} minutes (1 call per second)
              <br /><br />
              This will use your production API quota. Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkSync}>
              Yes, Sync All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

