/**
 * Error Details Utilities
 * 
 * Utilities for showing error toasts with "Show Details" functionality
 */

import { toast } from 'sonner';
import { ErrorDetailsType } from '@/types/error-details';

interface ShowErrorWithDetailsOptions {
  message: string;
  detailsType: ErrorDetailsType;
  itemId?: string;
  onShowDetails?: () => void;
  additionalData?: Record<string, any>;
}

/**
 * Shows an error toast with a "Show Details" button
 */
export function showErrorWithDetails({
  message,
  detailsType,
  itemId,
  onShowDetails,
  additionalData
}: ShowErrorWithDetailsOptions) {
  toast.error(message, {
    duration: 6000, // Longer duration to give time to click "Show Details"
    action: onShowDetails ? {
      label: 'Show Details',
      onClick: onShowDetails,
    } : undefined,
  });
}

/**
 * Fetches error details from the API
 */
export async function fetchErrorDetails(
  detailsType: ErrorDetailsType,
  params: Record<string, string>
): Promise<any> {
  const queryString = new URLSearchParams(params).toString();
  const response = await fetch(`/api/errors/details/${detailsType}?${queryString}`);
  
  if (!response.ok) {
    let errorMessage = `Failed to fetch error details (${response.status})`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
    } catch {
      // If response isn't JSON, use status text
      errorMessage = response.statusText || errorMessage;
    }
    throw new Error(errorMessage);
  }
  
  return response.json();
}

/**
 * Constructs the URL for a specific task
 */
export function getTaskUrl(taskId: string, taskType: 'workshop' | 'general' = 'workshop'): string {
  if (taskType === 'workshop') {
    return `/workshop-tasks?task=${taskId}`;
  }
  return `/tasks/${taskId}`;
}

/**
 * Formats status for display
 */
export function formatStatus(status: string): string {
  return status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
