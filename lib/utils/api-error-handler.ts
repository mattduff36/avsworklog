/**
 * Global API Error Handler
 * Provides automatic error logging for all API routes
 */

import { NextRequest, NextResponse } from 'next/server';
import { logServerError } from './server-error-logger';

export type APIHandler<T = any> = (
  request: NextRequest,
  context?: any
) => Promise<NextResponse<T>>;

/**
 * Wraps an API route handler with automatic error logging
 * Usage:
 *   export const GET = withErrorHandler(async (request) => { ... }, 'GET /api/route');
 *   export const POST = withErrorHandler(async (request) => { ... }, 'POST /api/route');
 */
export function withErrorHandler<T = any>(
  handler: APIHandler<T>,
  componentName: string
): APIHandler<T> {
  return async (request: NextRequest, context?: any): Promise<NextResponse<T>> => {
    try {
      return await handler(request, context);
    } catch (error) {
      // Log the error to database
      await logServerError({
        error: error as Error,
        request,
        componentName,
        additionalData: {
          method: request.method,
          url: request.url,
        },
      });

      // Return error response
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : 'Internal server error',
        },
        { status: 500 }
      ) as NextResponse<T>;
    }
  };
}

/**
 * Alternative: Handles errors within the route and logs them
 * This is for when you want to handle errors manually but still log them
 */
export async function handleAPIError({
  error,
  request,
  componentName,
  statusCode = 500,
  additionalData,
}: {
  error: Error | string;
  request: NextRequest;
  componentName: string;
  statusCode?: number;
  additionalData?: Record<string, unknown>;
}): Promise<NextResponse> {
  // Log to database
  await logServerError({
    error: error instanceof Error ? error : new Error(error),
    request,
    componentName,
    additionalData,
  });

  // Also log to console for server logs
  console.error(`[${componentName}]`, error);

  // Return error response
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : error,
    },
    { status: statusCode }
  );
}
