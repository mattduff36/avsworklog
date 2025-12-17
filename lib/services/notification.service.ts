/**
 * Notification Service
 * 
 * Centralized notification system using Sonner toast library.
 * Provides consistent notification patterns across the application.
 * 
 * Usage:
 *   import { notify } from '@/lib/services/notification.service';
 *   
 *   notify.success('Operation completed');
 *   notify.error('Something went wrong', 'Please try again');
 *   const confirmed = await notify.confirm({ title: 'Delete?', description: '...' });
 */

import { toast } from 'sonner';

interface ConfirmOptions {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

class NotificationService {
  /**
   * Show success notification
   */
  success(message: string, description?: string): void {
    toast.success(message, {
      description,
      duration: 3000,
    });
  }

  /**
   * Show error notification
   */
  error(message: string, description?: string): void {
    toast.error(message, {
      description,
      duration: 5000,
    });
  }

  /**
   * Show warning notification
   */
  warning(message: string, description?: string): void {
    toast.warning(message, {
      description,
      duration: 4000,
    });
  }

  /**
   * Show info notification
   */
  info(message: string, description?: string): void {
    toast.info(message, {
      description,
      duration: 4000,
    });
  }

  /**
   * Show loading notification (returns id to dismiss later)
   */
  loading(message: string, description?: string): string | number {
    return toast.loading(message, {
      description,
    });
  }

  /**
   * Dismiss a notification by id
   */
  dismiss(toastId: string | number): void {
    toast.dismiss(toastId);
  }

  /**
   * Show notification with custom action button
   */
  withAction(
    message: string,
    options: {
      description?: string;
      actionLabel: string;
      onAction: () => void;
      type?: 'success' | 'error' | 'info' | 'warning';
    }
  ): void {
    const toastFn = options.type ? toast[options.type] : toast;
    
    toastFn(message, {
      description: options.description,
      action: {
        label: options.actionLabel,
        onClick: options.onAction,
      },
      duration: 10000, // Longer duration for actions
    });
  }

  /**
   * Promise-based confirmation dialog using toast
   * Note: For critical confirmations, use AlertDialog component instead
   * This is a lightweight alternative for simple confirmations
   */
  async confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      toast(options.title, {
        description: options.description,
        duration: 10000,
        action: {
          label: options.confirmText || 'Confirm',
          onClick: () => resolve(true),
        },
        cancel: {
          label: options.cancelText || 'Cancel',
          onClick: () => resolve(false),
        },
      });

      // Auto-resolve to false after timeout
      setTimeout(() => resolve(false), 10000);
    });
  }

  /**
   * Alert replacement - show important message
   * Use this instead of window.alert()
   */
  alert(message: string, description?: string): void {
    toast.info(message, {
      description,
      duration: 5000,
      important: true,
    });
  }
}

// Export singleton instance
export const notify = new NotificationService();

// Export type for external use
export type { ConfirmOptions };
