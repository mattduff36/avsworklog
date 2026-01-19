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

  /**
   * Some errors are caused by browser quirks, extensions, or third-party snippets.
   * We don't want these to pollute centralized logging (especially on mobile Safari).
   */
  private shouldIgnoreRuntimeError(message: string, filename?: string): boolean {
    const msg = (message || '').trim();
    const file = filename || '';

    // Mobile Safari noise seen in production logs (no repo reference found).
    if (msg.includes("Can't find variable: gmo") || msg.includes('gmo is not defined')) return true;

    // Ignore obvious extension / injected script failures (best-effort, keep narrow).
    if (file.includes('chrome-extension://') || file.includes('safari-extension://')) return true;

    return false;
  }

  private constructor() {
    // Load last email sent date from localStorage
    if (typeof window !== 'undefined') {
      this.lastEmailSentDate = localStorage.getItem('lastErrorEmailSentDate');
    }
    // Set up global error handlers
    if (typeof window !== 'undefined') {
      // Capture unhandled errors
      window.addEventListener('error', (event) => {
        const errorMessage = event.error?.message || event.message || 'Unknown error';
        const location = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : 'unknown location';

        // Filter out known noisy runtime errors before logging
        if (this.shouldIgnoreRuntimeError(errorMessage, event.filename)) {
          return;
        }
        
        this.logError({
          error: event.error || new Error(`Uncaught Error: ${errorMessage} at ${location}`),
          componentName: 'Global Error Handler',
          additionalData: {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            location,
            description: `Unhandled JavaScript error thrown at runtime`,
          },
        });
      });

      // Capture unhandled promise rejections
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        let errorMessage = 'Promise rejected';
        
        if (reason instanceof Error) {
          errorMessage = `Unhandled Promise Rejection: ${reason.message}`;
        } else if (typeof reason === 'string') {
          errorMessage = `Unhandled Promise Rejection: ${reason}`;
        } else if (reason && typeof reason === 'object') {
          errorMessage = `Unhandled Promise Rejection: ${JSON.stringify(reason)}`;
        }
        
        this.logError({
          error: reason instanceof Error ? reason : new Error(errorMessage),
          componentName: 'Unhandled Promise Rejection',
          additionalData: {
            reason: reason,
            reasonType: typeof reason,
            description: 'Promise was rejected but no .catch() handler was attached',
            pageUrl: window.location.href,
          },
        });
      });

      // Capture console.error calls (for development)
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        originalError.apply(console, args);
        
        // Don't log if we're already in the logging process (prevent recursion)
        if (this.isLogging) return;
        
        // Helper function to serialize an argument properly
        const serializeArg = (arg: unknown): string => {
          if (arg === null) return 'null';
          if (arg === undefined) return 'undefined';
          
          // Handle Error objects specially
          if (arg instanceof Error) {
            return `${arg.name}: ${arg.message}${arg.stack ? '\n' + arg.stack : ''}`;
          }
          
          // Handle plain objects
          if (typeof arg === 'object') {
            try {
              const keys = Object.keys(arg);
              // Empty object
              if (keys.length === 0) return '{}';
              
              // Try to stringify with error properties if it looks like an error
              if ('message' in arg || 'name' in arg || 'stack' in arg) {
                const errorLike = arg as { message?: string; name?: string; stack?: string };
                return `${errorLike.name || 'Error'}: ${errorLike.message || 'Unknown error'}`;
              }
              
              // Regular object - stringify
              const stringified = JSON.stringify(arg, null, 2);
              // If it stringifies to empty object, return a more useful representation
              return stringified === '{}' ? '[Empty Object]' : stringified;
            } catch (e) {
              return '[Object (unstringifiable)]';
            }
          }
          
          return String(arg);
        };
        
        const errorMessage = args.map(serializeArg).join(' ');
        
        // Don't log errors from the error logging system itself
        if (errorMessage.includes('Error fetching error logs') || 
            errorMessage.includes('error_logs') ||
            errorMessage.includes('Failed to log error')) {
          return;
        }

        // Filter out noisy network failures that are common on mobile and not actionable.
        // These should be handled gracefully in-app without escalating to centralized logs.
        if (
          errorMessage.includes('TypeError: Failed to fetch') &&
          (errorMessage.includes('Error fetching profile:') || errorMessage.includes('Error checking for duplicate:'))
        ) {
          return;
        }
        
        // Filter out empty/meaningless errors
        if (errorMessage.trim() === '{}' || 
            errorMessage.trim() === '' ||
            errorMessage.trim() === '[Empty Object]' ||
            errorMessage === '[object Object]' ||
            errorMessage === 'undefined' ||
            errorMessage === 'null') {
          return;
        }
        
        // Filter out Supabase auth internal errors (empty objects from auth flow)
        if (args.length === 1 && 
            typeof args[0] === 'object' && 
            args[0] !== null &&
            Object.keys(args[0]).length === 0) {
          return;
        }
        
        // Filter out Supabase session errors (these are internal and not actionable)
        if (errorMessage.includes('_useSession') || 
            errorMessage.includes('_getUser') ||
            errorMessage.includes('AuthSessionMissingError')) {
          return;
        }
        
        // Only log if it looks like an actual error (not React warnings)
        if (!errorMessage.includes('Warning:') && !errorMessage.includes('%c')) {
          this.logError({
            error: new Error(`Console Error: ${errorMessage}`),
            componentName: 'Console Error',
            additionalData: { 
              args,
              description: 'Error logged via console.error() in application code',
              pageUrl: typeof window !== 'undefined' ? window.location.href : 'N/A',
              callStack: new Error().stack,
            },
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

