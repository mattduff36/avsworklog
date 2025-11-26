import { useState, useEffect } from 'react';

/**
 * Hook to detect online/offline status
 * Returns true if online, false if offline
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => {
    // Initial state - check if we're in browser and get online status
    if (typeof navigator !== 'undefined') {
      return navigator.onLine;
    }
    // Default to true during SSR
    return true;
  });

  useEffect(() => {
    // Only run in browser
    if (typeof window === 'undefined') return;

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    // Listen for online/offline events
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Cleanup listeners on unmount
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}

