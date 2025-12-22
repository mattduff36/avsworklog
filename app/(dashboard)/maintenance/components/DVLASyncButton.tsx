'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface DVLASyncButtonProps {
  vehicleId: string;
  registrationNumber: string;
  lastSync?: string | null;
  syncStatus?: 'never' | 'success' | 'error' | 'pending' | null;
  onSyncComplete?: () => void;
  size?: 'sm' | 'default' | 'lg';
  variant?: 'ghost' | 'outline' | 'default';
}

export function DVLASyncButton({
  vehicleId,
  registrationNumber,
  lastSync,
  syncStatus,
  onSyncComplete,
  size = 'sm',
  variant = 'ghost',
}: DVLASyncButtonProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const { toast } = useToast();

  const handleSync = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click

    setIsSyncing(true);

    try {
      const response = await fetch('/api/maintenance/sync-dvla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Check if DVLA API is not configured
        if (response.status === 503) {
          toast({
            title: 'DVLA API Not Configured',
            description: 'Please configure your DVLA API provider credentials in the system settings.',
            variant: 'destructive',
          });
          return;
        }

        throw new Error(data.error || 'Sync failed');
      }

      if (data.success && data.successful > 0) {
        const result = data.results[0];
        const updatedFields = result.updatedFields || [];

        if (updatedFields.length > 0) {
          toast({
            title: 'DVLA Sync Successful',
            description: `Updated: ${updatedFields.join(', ')} for ${registrationNumber}`,
          });
        } else {
          toast({
            title: 'DVLA Sync Complete',
            description: `No changes for ${registrationNumber} - data is up to date.`,
          });
        }

        onSyncComplete?.();
      } else {
        throw new Error('Sync failed');
      }
    } catch (error: any) {
      console.error('DVLA sync error:', error);
      toast({
        title: 'Sync Failed',
        description: error.message || 'Failed to sync vehicle data from DVLA',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const getStatusIcon = () => {
    if (isSyncing) {
      return <RefreshCw className="h-3 w-3 animate-spin" />;
    }

    switch (syncStatus) {
      case 'success':
        return <CheckCircle className="h-3 w-3" />;
      case 'error':
        return <XCircle className="h-3 w-3" />;
      case 'never':
        return <AlertCircle className="h-3 w-3" />;
      default:
        return <RefreshCw className="h-3 w-3" />;
    }
  };

  const getStatusColor = () => {
    switch (syncStatus) {
      case 'success':
        return 'text-green-400 hover:text-green-300';
      case 'error':
        return 'text-red-400 hover:text-red-300';
      case 'never':
        return 'text-yellow-400 hover:text-yellow-300';
      default:
        return 'text-blue-400 hover:text-blue-300';
    }
  };

  const getTooltipText = () => {
    if (isSyncing) return 'Syncing with DVLA...';
    
    if (lastSync) {
      const syncDate = new Date(lastSync);
      const now = new Date();
      const daysDiff = Math.floor((now.getTime() - syncDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysDiff === 0) return 'Sync Tax/MOT from DVLA (synced today)';
      if (daysDiff === 1) return 'Sync Tax/MOT from DVLA (synced yesterday)';
      return `Sync Tax/MOT from DVLA (synced ${daysDiff} days ago)`;
    }
    
    return 'Sync Tax/MOT data from DVLA';
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={variant}
            size={size}
            onClick={handleSync}
            disabled={isSyncing}
            className={`${getStatusColor()} hover:bg-slate-800`}
            title={getTooltipText()}
          >
            {getStatusIcon()}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{getTooltipText()}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

