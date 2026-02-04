'use client';

import { useEffect, useState } from 'react';
import { useOfflineStore } from '@/lib/stores/offline-queue';
import { toast } from 'sonner';

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof navigator === 'undefined') {
      return true;
    }

    return navigator.onLine;
  });
  const { queue, processQueue } = useOfflineStore();

  useEffect(() => {
    // Listen for online/offline events
    const handleOnline = async () => {
      setIsOnline(true);
      
      // Show toast notification
      const pendingItems = queue.length;
      if (pendingItems > 0) {
        toast.success('Back online!', {
          description: `Syncing ${pendingItems} pending ${pendingItems === 1 ? 'item' : 'items'}...`,
        });
        
        // Process queue when coming back online
        await processQueue();
        
        // Show success after processing
        toast.success('Sync complete!', {
          description: 'All pending items have been submitted.',
        });
      } else {
        toast.success('Back online!', {
          description: 'Your connection has been restored.',
        });
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      
      // Show toast notification
      toast.warning('You are offline', {
        description: 'Changes will be saved locally and synced when you reconnect.',
        duration: 5000,
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [queue.length, processQueue]);

  return {
    isOnline,
    pendingCount: queue.length,
    hasQueuedItems: queue.length > 0,
  };
}

