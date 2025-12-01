/**
 * Global Error Logger
 * Captures and stores all application errors for debugging
 */

import { createClient } from '@/lib/supabase/client';

export interface ErrorLog {
  id: string;
  timestamp: string;
  error_message: string;
  error_stack: string | null;
  error_type: string;
  user_id: string | null;
  user_email: string | null;
  page_url: string;
  user_agent: string;
  component_name: string | null;
  additional_data: Record<string, unknown> | null;
}

class ErrorLogger {
  private static instance: ErrorLogger;
  private supabase = createClient();
  private queue: Omit<ErrorLog, 'id'>[] = [];
  private isProcessing = false;

  private constructor() {
    // Set up global error handlers
    if (typeof window !== 'undefined') {
      // Capture unhandled errors
      window.addEventListener('error', (event) => {
        this.logError({
          error: event.error || new Error(event.message),
          componentName: 'Global Error Handler',
          additionalData: {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
          },
        });
      });

      // Capture unhandled promise rejections
      window.addEventListener('unhandledrejection', (event) => {
        this.logError({
          error: new Error(event.reason?.message || String(event.reason)),
          componentName: 'Unhandled Promise Rejection',
          additionalData: {
            reason: event.reason,
          },
        });
      });

      // Capture console.error calls (for development)
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        originalError.apply(console, args);
        const errorMessage = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        
        // Only log if it looks like an actual error (not React warnings)
        if (!errorMessage.includes('Warning:') && !errorMessage.includes('%c')) {
          this.logError({
            error: new Error(errorMessage),
            componentName: 'Console Error',
            additionalData: { args },
          });
        }
      };
    }
  }

  public static getInstance(): ErrorLogger {
    if (!ErrorLogger.instance) {
      ErrorLogger.instance = new ErrorLogger();
    }
    return ErrorLogger.instance;
  }

  /**
   * Log an error to the database
   */
  public async logError({
    error,
    componentName = null,
    additionalData = null,
  }: {
    error: Error | string;
    componentName?: string | null;
    additionalData?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      const errorObj = typeof error === 'string' ? new Error(error) : error;
      
      // Get current user if available
      const { data: { user } } = await this.supabase.auth.getUser();

      const errorLog: Omit<ErrorLog, 'id'> = {
        timestamp: new Date().toISOString(),
        error_message: errorObj.message || String(error),
        error_stack: errorObj.stack || null,
        error_type: errorObj.name || 'Error',
        user_id: user?.id || null,
        user_email: user?.email || null,
        page_url: typeof window !== 'undefined' ? window.location.href : 'N/A',
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A',
        component_name: componentName,
        additional_data: additionalData,
      };

      // Add to queue
      this.queue.push(errorLog);

      // Process queue
      this.processQueue();
    } catch (err) {
      // Silent fail - don't want error logging to break the app
      console.warn('Failed to log error:', err);
    }
  }

  /**
   * Process the error queue and save to database
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      const batch = [...this.queue];
      this.queue = [];

      const { error } = await this.supabase
        .from('error_logs')
        .insert(batch);

      if (error) {
        // Put items back in queue if insert failed
        this.queue.unshift(...batch);
        console.warn('Failed to save error logs to database:', error);
      }
    } catch (err) {
      console.warn('Error processing error queue:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Clear all error logs (SuperAdmin only)
   */
  public async clearAllLogs(): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase
        .from('error_logs')
        .delete()
        .gte('timestamp', '1970-01-01'); // Delete all

      if (error) throw error;

      return { success: true };
    } catch (err) {
      return { 
        success: false, 
        error: err instanceof Error ? err.message : 'Unknown error' 
      };
    }
  }
}

// Export singleton instance
export const errorLogger = ErrorLogger.getInstance();

/**
 * React Error Boundary compatible error handler
 */
export function logErrorFromBoundary(error: Error, errorInfo: { componentStack: string }) {
  errorLogger.logError({
    error,
    componentName: 'Error Boundary',
    additionalData: {
      componentStack: errorInfo.componentStack,
    },
  });
}

/**
 * Helper to log errors with toast notifications
 */
export function logAndToastError(error: Error | string, componentName?: string) {
  const message = typeof error === 'string' ? error : error.message;
  
  errorLogger.logError({
    error,
    componentName,
  });

  // Return the message so it can be used with toast
  return message;
}

