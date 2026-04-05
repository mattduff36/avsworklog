/**
 * Structured Logger Utility
 * 
 * Provides consistent logging throughout the application with environment-aware
 * log levels and integration with the error logging system.
 * 
 * Usage:
 *   import { logger } from '@/lib/utils/logger';
 *   
 *   logger.debug('Debugging info', { data: 'value' });
 *   logger.info('User logged in', { userId: '123' });
 *   logger.warn('Deprecated function used', { function: 'oldFunction' });
 *   logger.error('Failed to save data', error, 'MyComponent');
 */

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development';

  /**
   * Debug logging - only shown in development
   */
  debug(message: string, data?: unknown): void {
    if (this.isDevelopment) {
      console.debug(`[DEBUG] ${message}`, data || '');
    }
  }

  /**
   * Info logging - shown in all environments
   */
  info(message: string, data?: unknown): void {
    console.info(`[INFO] ${message}`, data || '');
  }

  /**
   * Warning logging - shown in all environments
   */
  warn(message: string, data?: unknown): void {
    console.warn(`[WARN] ${message}`, data || '');
  }

  /**
   * Error logging - shown in all environments and sent to error logger
   */
  error(message: string, error?: Error | unknown, componentName?: string): void {
    // Always log to console
    console.error(`[ERROR] ${message}`, error || '');

    // Send to error logging system
    if (typeof window !== 'undefined') {
      void import('./error-logger')
        .then(({ errorLogger }) => {
          errorLogger.logError({
            error: error instanceof Error ? error : new Error(message),
            componentName,
            additionalData: {
              message,
              timestamp: new Date().toISOString(),
            },
          });
        })
        .catch((loggingError) => {
          console.warn('[Logger] Failed to load browser error logger:', loggingError);
        });
    }
  }

  /**
   * Performance timing helper
   */
  time(label: string): void {
    if (this.isDevelopment) {
      console.time(`[PERF] ${label}`);
    }
  }

  /**
   * End performance timing
   */
  timeEnd(label: string): void {
    if (this.isDevelopment) {
      console.timeEnd(`[PERF] ${label}`);
    }
  }

  /**
   * Group console logs (development only)
   */
  group(label: string): void {
    if (this.isDevelopment) {
      console.group(label);
    }
  }

  /**
   * End console group
   */
  groupEnd(): void {
    if (this.isDevelopment) {
      console.groupEnd();
    }
  }

  /**
   * Table logging for arrays/objects (development only)
   */
  table(data: unknown): void {
    if (this.isDevelopment && console.table) {
      console.table(data);
    }
  }
}

// Export singleton instance
export const logger = new Logger();
