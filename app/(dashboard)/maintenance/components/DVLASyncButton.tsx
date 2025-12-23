'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, CheckCircle, XCircle, AlertCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';
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
  const [clickCount, setClickCount] = useState(0);
  const [resetTime, setResetTime] = useState<Date | null>(null);
  
  // Rate limiting: 3 clicks per 5 minutes
  const MAX_CLICKS = 3;
  const RESET_MINUTES = 5;

  const handleSync = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click

    // Check rate limit
    if (clickCount >= MAX_CLICKS && resetTime && new Date() < resetTime) {
      return; // Button is disabled, do nothing
    }

    // Reset counter if time has passed
    if (resetTime && new Date() >= resetTime) {
      setClickCount(0);
      setResetTime(null);
    }

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
          toast.error('DVLA API Not Configured', {
            description: 'Please configure your DVLA API provider credentials.',
          });
          return;
        }

        throw new Error(data.error || 'Sync failed');
      }

      if (data.success && data.successful > 0) {
        const result = data.results[0];
        const updatedFields = result.updatedFields || [];

        if (updatedFields.length > 0) {
          toast.success(`Tax due date updated for ${registrationNumber}`);
        } else {
          toast.success(`${registrationNumber} - data is up to date`);
        }

        onSyncComplete?.();
        
        // Increment click count
        const newClickCount = clickCount + 1;
        setClickCount(newClickCount);
        
        // Set reset time after 3rd click
        if (newClickCount >= MAX_CLICKS) {
          const resetAt = new Date();
          resetAt.setMinutes(resetAt.getMinutes() + RESET_MINUTES);
          setResetTime(resetAt);
          toast.info(`Rate limit reached. Try again at ${resetAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
        }
        
      } else {
        throw new Error('Sync failed');
      }
    } catch (error: any) {
      console.error('DVLA sync error:', error);
      toast.error('Sync Failed', {
        description: error.message || 'Failed to sync tax due date from DVLA',
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

  const isRateLimited = clickCount >= MAX_CLICKS && resetTime && new Date() < resetTime;
  
  const getTooltipText = () => {
    if (isRateLimited && resetTime) {
      return `Try again at ${resetTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    }
    
    if (isSyncing) return 'Syncing tax due date from DVLA...';
    
    if (lastSync) {
      const syncDate = new Date(lastSync);
      const now = new Date();
      const daysDiff = Math.floor((now.getTime() - syncDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysDiff === 0) return 'Sync tax due date from DVLA (synced today)';
      if (daysDiff === 1) return 'Sync tax due date from DVLA (synced yesterday)';
      return `Sync tax due date from DVLA (synced ${daysDiff} days ago)`;
    }
    
    return 'Sync tax due date from DVLA';
  };
  
  const getButtonContent = () => {
    if (isRateLimited && resetTime) {
      return (
        <div className="flex items-center gap-1 text-xs">
          <Clock className="h-3 w-3" />
          <span className="whitespace-nowrap">
            {resetTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      );
    }
    return getStatusIcon();
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={variant}
            size={size}
            onClick={handleSync}
            disabled={isSyncing || isRateLimited}
            className={`${isRateLimited ? 'text-slate-500' : getStatusColor()} hover:bg-slate-800`}
            title={getTooltipText()}
          >
            {getButtonContent()}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{getTooltipText()}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

