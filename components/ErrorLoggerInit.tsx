'use client';

import { useEffect } from 'react';
import { errorLogger } from '@/lib/utils/error-logger';

/**
 * Initialize the global error logger
 * This component should be included once in the root layout
 */
export function ErrorLoggerInit() {
  useEffect(() => {
    // Make error logger available globally for easy access
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).errorLogger = errorLogger;
    }
    
    // Log initialization
    console.log('✅ Error logger initialized');
  }, []);

  return null;
}

