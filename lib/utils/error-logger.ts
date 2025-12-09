/**
 * Global Error Logger
 * Captures and stores all application errors for debugging
 * Automatically sends daily error summary email on first error of each day
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
  private isLogging = false; // Prevent recursive logging
  private lastEmailSentDate: string | null = null; // Track last daily email sent

  private constructor() {
    // Load last email sent date from localStorage
    if (typeof window !== 'undefined') {
      this.lastEmailSentDate = localStorage.getItem('lastErrorEmailSentDate');
    }
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
        
        // Don't log if we're already in the logging process (prevent recursion)
        if (this.isLogging) return;
        
        const errorMessage = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        
        // Don't log errors from the error logging system itself
        if (errorMessage.includes('Error fetching error logs') || 
            errorMessage.includes('error_logs') ||
            errorMessage.includes('Failed to log error')) {
          return;
        }
        
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
    // Prevent recursive logging
    if (this.isLogging) return;
    
    this.isLogging = true;
    
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
      // Use console.warn to avoid triggering the console.error interceptor
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('Failed to log error:', err);
      }
    } finally {
      this.isLogging = false;
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
      } else {
        // After successfully logging error, check if we should send daily summary
        this.checkAndSendDailySummary();
      }
    } catch (err) {
      console.warn('Error processing error queue:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Check if this is the first error of a new day and send daily summary
   */
  private async checkAndSendDailySummary(): Promise<void> {
    // Only run on client side
    if (typeof window === 'undefined') return;

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    // Check if we've already sent an email today
    if (this.lastEmailSentDate === today) {
      return; // Already sent today
    }

    // This is the first error of a new day - trigger the daily summary
    try {
      const response = await fetch('/api/errors/daily-summary', {
        method: 'POST',
      });

      if (response.ok) {
        // Update last sent date
        this.lastEmailSentDate = today;
        if (typeof window !== 'undefined') {
          localStorage.setItem('lastErrorEmailSentDate', today);
        }
        console.log('Daily error summary email sent successfully');
      } else {
        console.warn('Failed to send daily error summary email');
      }
    } catch (err) {
      // Silent fail - don't want email sending to break error logging
      console.warn('Error sending daily summary:', err);
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

