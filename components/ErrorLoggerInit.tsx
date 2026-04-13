'use client';

import { useEffect } from 'react';

/**
 * Initialize the global error logger
 * This component should be included once in the root layout
 */
export function ErrorLoggerInit() {
  useEffect(() => {
    let mounted = true;

    void import('@/lib/utils/error-logger').then(({ errorLogger, initializeErrorLogger }) => {
      if (!mounted || typeof window === 'undefined') return;
      initializeErrorLogger();
      (window as unknown as Record<string, unknown>).errorLogger = errorLogger;
      console.log('✅ Error logger initialized');
    });

    return () => {
      mounted = false;
    };
  }, []);

  return null;
}

