'use client';

import { useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, AlertTriangle, Loader2, CheckCircle2, X } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import type { NotificationItem } from '@/types/messages';

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
  onNotificationClick?: (notification: NotificationItem) => void;
}

export function NotificationPanel({ open, onClose, onNotificationClick }: NotificationPanelProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (open) {
      fetchNotifications();
    }
  }, [open]);

  async function fetchNotifications() {
    setLoading(true);
    try {
      const response = await fetch('/api/messages/notifications');
      const data = await response.json();

      if (data.success) {
        setNotifications(data.notifications || []);
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
      try {
        toast.error('Failed to load notifications');
      } catch (toastError) {
        console.error('Failed to load notifications (toast unavailable)');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleClearAll() {
    setClearing(true);
    try {
      const response = await fetch('/api/messages/clear-all', {
        method: 'POST'
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to clear notifications');
      }

      try {
        toast.success('All notifications cleared');
      } catch (toastError) {
        console.error('All notifications cleared (toast unavailable)');
      }
      setNotifications([]);
      onClose();
    } catch (error) {
      console.error('Error clearing notifications:', error);
      try {
        toast.error(error instanceof Error ? error.message : 'Failed to clear notifications');
      } catch (toastError) {
        console.error('Failed to clear notifications (toast unavailable)');
      }
    } finally {
      setClearing(false);
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'SIGNED':
        return (
          <Badge variant="default" className="gap-1 bg-green-600">
            <CheckCircle2 className="h-3 w-3" />
            Signed
          </Badge>
        );
      case 'DISMISSED':
        return (
          <Badge variant="secondary" className="gap-1">
            Acknowledged
          </Badge>
        );
      case 'SHOWN':
        return (
          <Badge variant="secondary" className="gap-1">
            Viewed
          </Badge>
        );
      default:
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            Pending
          </Badge>
        );
    }
  }

  function truncateText(text: string, maxLength: number = 100) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-16 right-4 z-50 w-[400px] max-w-[calc(100vw-2rem)] bg-slate-900 rounded-lg shadow-2xl border border-slate-700 animate-in slide-in-from-top-2 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-slate-300" />
            <h3 className="font-semibold text-white">Notifications</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Bell className="h-12 w-12 text-slate-300 dark:text-slate-600 mb-3" />
            <p className="text-sm text-slate-400">No notifications</p>
            <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
              You&apos;re all caught up!
            </p>
          </div>
        ) : (
          <>
            <ScrollArea className="h-[400px]">
              <div className="divide-y divide-slate-200 dark:divide-slate-700">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="p-4 hover:bg-slate-800/50 transition-colors cursor-pointer"
                    onClick={() => onNotificationClick?.(notification)}
                  >
                    <div className="flex items-start gap-3">
                      {/* Priority Indicator */}
                      {notification.priority === 'HIGH' && (
                        <div className="mt-1">
                          <AlertTriangle className="h-4 w-4 text-red-600" />
                        </div>
                      )}

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h4 className="font-medium text-sm text-white leading-tight">
                            {notification.subject}
                          </h4>
                          {getStatusBadge(notification.status)}
                        </div>

                        <p className="text-xs text-slate-400 mb-2">
                          {truncateText(notification.body)}
                        </p>

                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-500">
                          <span>From: {notification.sender_name}</span>
                          <span>•</span>
                          <span>{formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* Footer */}
            <div className="p-3 border-t border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-b-lg">
              <div className="flex items-center justify-between gap-2">
                <Link href="/notifications" onClick={onClose}>
                  <Button variant="ghost" size="sm" className="text-xs">
                    See all notifications
                  </Button>
                </Link>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAll}
                  disabled={clearing}
                  className="text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                >
                  {clearing ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Clearing...
                    </>
                  ) : (
                    'Clear all'
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

