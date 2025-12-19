/**
 * Server-Side Error Logger
 * Logs errors from API routes to the error_logs table
 */

import { createClient } from '@/lib/supabase/server';

export interface ServerErrorLog {
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

/**
 * Log an error from a server-side API route
 */
export async function logServerError({
  error,
  request,
  componentName = null,
  additionalData = null,
  userId = null,
  userEmail = null,
}: {
  error: Error | string;
  request: Request;
  componentName?: string | null;
  additionalData?: Record<string, unknown> | null;
  userId?: string | null;
  userEmail?: string | null;
}): Promise<void> {
  try {
    const errorObj = typeof error === 'string' ? new Error(error) : error;
    const supabase = await createClient();

    // If user info not provided, try to get it from session
    let finalUserId = userId;
    let finalUserEmail = userEmail;
    
    if (!finalUserId || !finalUserEmail) {
      const { data: { user } } = await supabase.auth.getUser();
      finalUserId = finalUserId || user?.id || null;
      finalUserEmail = finalUserEmail || user?.email || null;
    }

    const errorLog: ServerErrorLog = {
      error_message: errorObj.message || String(error),
      error_stack: errorObj.stack || null,
      error_type: errorObj.name || 'Error',
      user_id: finalUserId,
      user_email: finalUserEmail,
      page_url: request.url || 'N/A',
      user_agent: request.headers.get('user-agent') || 'N/A',
      component_name: componentName,
      additional_data: additionalData,
    };

    // Insert into database
    const { error: insertError } = await supabase
      .from('error_logs')
      .insert([{
        ...errorLog,
        timestamp: new Date().toISOString(),
      }]);

    if (insertError) {
      // Log to console but don't throw - we don't want error logging to break the app
      console.warn('[Server Error Logger] Failed to log error to database:', insertError);
    }
  } catch (err) {
    // Silent fail - don't want error logging to break the app
    console.warn('[Server Error Logger] Failed to log error:', err);
  }
}

/**
 * Wrap an API route handler with automatic error logging
 */
export function withErrorLogging<T>(
  handler: (request: Request, ...args: any[]) => Promise<T>,
  componentName: string
) {
  return async (request: Request, ...args: any[]): Promise<T> => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      // Log the error
      await logServerError({
        error: error as Error,
        request,
        componentName,
      });
      
      // Re-throw to let the caller handle it
      throw error;
    }
  };
}
