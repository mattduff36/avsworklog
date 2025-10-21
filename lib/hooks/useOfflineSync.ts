'use client';

import { useEffect, useState } from 'react';
import { useOfflineStore } from '@/lib/stores/offline-queue';

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(true);
  const { queue, processQueue } = useOfflineStore();

  useEffect(() => {
    // Check initial online status
    setIsOnline(navigator.onLine);

    // Listen for online/offline events
    const handleOnline = () => {
      setIsOnline(true);
      // Process queue when coming back online
      processQueue();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [processQueue]);

  return {
    isOnline,
    pendingCount: queue.length,
    hasQueuedItems: queue.length > 0,
  };
}

