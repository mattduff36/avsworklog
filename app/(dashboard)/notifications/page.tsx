'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Bell, Search, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import type { NotificationItem } from '@/types/messages';
import { BlockingMessageModal } from '@/components/messages/BlockingMessageModal';
import { ReminderModal } from '@/components/messages/ReminderModal';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [filteredNotifications, setFilteredNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNotification, setSelectedNotification] = useState<NotificationItem | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetchNotifications();
  }, []);

  useEffect(() => {
    if (searchQuery) {
      setFilteredNotifications(
        notifications.filter(n =>
          n.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
          n.sender_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          n.body.toLowerCase().includes(searchQuery.toLowerCase())
        )
      );
    } else {
      setFilteredNotifications(notifications);
    }
  }, [searchQuery, notifications]);

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
      toast.error('Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }

  function handleNotificationClick(notification: NotificationItem) {
    setSelectedNotification(notification);
    setShowModal(true);
  }

  function handleModalClose() {
    setShowModal(false);
    setSelectedNotification(null);
    // Refresh notifications after modal closes
    fetchNotifications();
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
            <Info className="h-3 w-3" />
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

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-100 dark:bg-blue-950 rounded-lg">
            <Bell className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
              Notifications
            </h1>
            <p className="text-slate-600 dark:text-slate-400">
              View all your messages from the last 60 days
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search notifications..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-11 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600"
            />
          </div>
        </CardContent>
      </Card>

      {/* Notifications List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : filteredNotifications.length === 0 ? (
        <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bell className="h-16 w-16 text-slate-300 dark:text-slate-600 mb-3" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              No notifications found
            </h3>
            <p className="text-slate-600 dark:text-slate-400 text-center">
              {searchQuery ? 'Try adjusting your search' : 'You have no notifications in the last 60 days'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredNotifications.map((notification) => (
            <Card
              key={notification.id}
              className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => handleNotificationClick(notification)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Priority Indicator */}
                  <div className="mt-1">
                    {notification.priority === 'HIGH' ? (
                      <div className="p-2 bg-red-100 dark:bg-red-950 rounded">
                        <AlertTriangle className="h-5 w-5 text-red-600" />
                      </div>
                    ) : (
                      <div className="p-2 bg-blue-100 dark:bg-blue-950 rounded">
                        <Bell className="h-5 w-5 text-blue-600" />
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-semibold text-slate-900 dark:text-white">
                        {notification.subject}
                      </h3>
                      {getStatusBadge(notification.status)}
                    </div>

                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-2 line-clamp-2">
                      {notification.body}
                    </p>

                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-500">
                      <span>From: {notification.sender_name}</span>
                      <span>•</span>
                      <span>{formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}</span>
                      {notification.signed_at && (
                        <>
                          <span>•</span>
                          <span className="text-green-600">
                            Signed {formatDistanceToNow(new Date(notification.signed_at), { addSuffix: true })}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Modals for viewing messages */}
      {showModal && selectedNotification && selectedNotification.type === 'TOOLBOX_TALK' && (
        <BlockingMessageModal
          open={true}
          message={{
            id: selectedNotification.message_id,
            recipient_id: selectedNotification.id,
            subject: selectedNotification.subject,
            body: selectedNotification.body,
            sender_name: selectedNotification.sender_name,
            created_at: selectedNotification.created_at
          }}
          onSigned={handleModalClose}
          totalPending={1}
          currentIndex={0}
        />
      )}

      {showModal && selectedNotification && selectedNotification.type === 'REMINDER' && (
        <ReminderModal
          open={true}
          onClose={handleModalClose}
          message={{
            id: selectedNotification.message_id,
            recipient_id: selectedNotification.id,
            subject: selectedNotification.subject,
            body: selectedNotification.body,
            sender_name: selectedNotification.sender_name,
            created_at: selectedNotification.created_at
          }}
          onDismissed={handleModalClose}
        />
      )}
    </div>
  );
}

