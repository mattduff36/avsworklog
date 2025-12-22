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
 * Extract useful context from the request
 */
function extractRequestContext(request: Request): Record<string, unknown> {
  const url = new URL(request.url);
  
  return {
    method: request.method,
    pathname: url.pathname,
    searchParams: Object.fromEntries(url.searchParams.entries()),
    referer: request.headers.get('referer') || null,
    origin: request.headers.get('origin') || null,
  };
}

/**
 * Generate a human-readable error description
 */
function generateErrorDescription(
  error: Error,
  componentName: string | null,
  requestContext: Record<string, unknown>
): string {
  const parts: string[] = [];
  
  // Add component context
  if (componentName) {
    parts.push(`Error in ${componentName}`);
  }
  
  // Add HTTP method and endpoint
  if (requestContext.method && requestContext.pathname) {
    parts.push(`${requestContext.method} ${requestContext.pathname}`);
  }
  
  // Add error type if it's not generic
  if (error.name && error.name !== 'Error') {
    parts.push(`(${error.name})`);
  }
  
  // Add the actual error message
  parts.push(`- ${error.message}`);
  
  // Add query params if present
  if (requestContext.searchParams && Object.keys(requestContext.searchParams as object).length > 0) {
    parts.push(`\nQuery params: ${JSON.stringify(requestContext.searchParams, null, 2)}`);
  }
  
  return parts.join(' ');
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

    // Extract request context
    const requestContext = extractRequestContext(request);
    
    // Generate enhanced error description
    const enhancedMessage = generateErrorDescription(errorObj, componentName, requestContext);
    
    // Merge request context with additional data
    const enrichedData = {
      ...requestContext,
      ...additionalData,
      errorContext: {
        originalMessage: errorObj.message,
        errorName: errorObj.name,
        timestamp: new Date().toISOString(),
      },
    };

    const errorLog: ServerErrorLog = {
      error_message: enhancedMessage,
      error_stack: errorObj.stack || null,
      error_type: errorObj.name || 'Error',
      user_id: finalUserId,
      user_email: finalUserEmail,
      page_url: request.url || 'N/A',
      user_agent: request.headers.get('user-agent') || 'N/A',
      component_name: componentName,
      additional_data: enrichedData,
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
