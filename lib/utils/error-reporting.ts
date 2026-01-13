/**
 * Error reporting utilities for user-facing errors
 */

import { toast } from 'sonner';

interface ReportErrorOptions {
  errorMessage: string;
  errorCode?: string;
  pageUrl?: string;
  additionalContext?: Record<string, unknown>;
}

/**
 * Report an error to the admin
 */
export async function reportError(options: ReportErrorOptions): Promise<void> {
  try {
    const response = await fetch('/api/errors/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error_message: options.errorMessage,
        error_code: options.errorCode,
        page_url: options.pageUrl || (typeof window !== 'undefined' ? window.location.href : undefined),
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        additional_context: options.additionalContext,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error || 'Failed to report error';
      throw new Error(errorMessage);
    }

    try {
      toast.success('Error reported', {
        description: 'Thank you! The issue has been reported to our team.',
        duration: 3000,
      });
    } catch (toastError) {
      console.error('Error reported successfully (toast unavailable)');
    }
  } catch (err) {
    console.error('Failed to report error:', err);
    try {
      toast.error('Could not send report', {
        description: 'Please try again or contact support directly.',
        duration: 3000,
      });
    } catch (toastError) {
      console.error('Could not send report (toast unavailable)');
    }
  }
}

/**
 * Generate a short error code from an error message
 */
export function generateErrorCode(errorMessage: string): string {
  // Create a simple hash-based error code
  let hash = 0;
  for (let i = 0; i < errorMessage.length; i++) {
    hash = ((hash << 5) - hash) + errorMessage.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return `ERR-${Math.abs(hash).toString(36).toUpperCase().substring(0, 6)}`;
}

/**
 * Show an error toast with a report button
 */
export function showErrorWithReport(
  title: string,
  errorMessage: string,
  additionalContext?: Record<string, unknown>
): void {
  const errorCode = generateErrorCode(errorMessage);
  
  try {
    toast.error(title, {
      description: `${errorMessage}\n\nError Code: ${errorCode}`,
      duration: 10000, // 10 seconds to give user time to report
      action: {
        label: 'Report',
        onClick: () => {
          reportError({
            errorMessage: `${title}: ${errorMessage}`,
            errorCode,
            additionalContext,
          });
        },
      },
    });
  } catch (toastError) {
    // Fallback if toast is not available
    console.error(`${title}: ${errorMessage} (Error Code: ${errorCode})`);
  }
}

