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
      <Alert className="bg-amber-500/10 border-amber-500/50 text-amber-400">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="text-amber-300">Developer Tool</AlertTitle>
        <AlertDescription className="text-amber-200/80">
          These controls sync vehicle tax due dates from GOV.UK VES API. Each sync uses your production API quota.
        </AlertDescription>
      </Alert>

      {/* Single Vehicle Sync */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Sync Single Vehicle</CardTitle>
          <CardDescription className="text-slate-400">
            Sync tax due date for a specific vehicle by registration number
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="regNumber" className="text-slate-300">Registration Number</Label>
            <div className="flex gap-2">
              <Input
                id="regNumber"
                placeholder="e.g. AB12 CDE"
                value={regNumber}
                onChange={(e) => setRegNumber(e.target.value.toUpperCase())}
                disabled={syncing}
                className="flex-1 bg-slate-800 border-slate-600 text-white placeholder:text-slate-500"
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

      {/* Bulk Sync All Vehicles */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Bulk Sync All Vehicles</CardTitle>
          <CardDescription className="text-slate-400">
            Sync tax due dates for all active vehicles in the database
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
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              {syncResult.success ? (
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              ) : (
                <XCircle className="h-5 w-5 text-red-400" />
              )}
              Sync Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-slate-800 border border-slate-700 p-4 rounded-md overflow-auto text-xs text-slate-300">
              {JSON.stringify(syncResult, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Bulk Sync Confirmation Dialog */}
      <Dialog open={showBulkConfirm} onOpenChange={setShowBulkConfirm}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl text-white">Confirm Bulk Sync</DialogTitle>
            <DialogDescription className="text-slate-400">
              This will sync tax due dates for <strong className="text-white">{vehicleCount} active vehicles</strong> from the DVLA API.
              <br /><br />
              <strong className="text-white">API Usage:</strong> ~{vehicleCount} API calls
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

