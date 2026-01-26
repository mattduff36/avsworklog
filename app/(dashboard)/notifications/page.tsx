'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Loader2, 
  Bell, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  Info, 
  Settings,
  Users,
  Wrench,
  FileText,
  CheckSquare,
  ClipboardCheck
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import type { NotificationItem } from '@/types/messages';
import type { NotificationPreference, NotificationModuleKey } from '@/types/notifications';
import { NOTIFICATION_MODULES } from '@/types/notifications';
import { BlockingMessageModal } from '@/components/messages/BlockingMessageModal';
import { ReminderModal } from '@/components/messages/ReminderModal';

const MODULE_ICONS: Record<string, any> = {
  'AlertTriangle': AlertTriangle,
  'Wrench': Wrench,
  'FileText': FileText,
  'CheckSquare': CheckSquare,
  'ClipboardCheck': ClipboardCheck,
};

export default function NotificationsPage() {
  const { profile, isAdmin, isSuperAdmin, isManager } = useAuth();
  
  // Notifications state
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [filteredNotifications, setFilteredNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNotification, setSelectedNotification] = useState<NotificationItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  
  // Preferences state
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [savingPrefModule, setSavingPrefModule] = useState<string | null>(null);
  
  // Admin state
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [users, setUsers] = useState<Array<{ id: string; full_name: string; role: string }>>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [adminNotifications, setAdminNotifications] = useState<NotificationItem[]>([]);
  const [loadingAdminNotifications, setLoadingAdminNotifications] = useState(false);

  // Filter modules based on user permissions
  const availableModules = NOTIFICATION_MODULES.filter(module => {
    if (module.availableFor === 'all') return true;
    if (module.availableFor === 'admin') return isAdmin;
    if (module.availableFor === 'manager') return isManager || isAdmin;
    return false;
  });

  useEffect(() => {
    fetchNotifications();
    fetchPreferences();
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin]);

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

  const fetchNotifications = useCallback(async () => {
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
  }, []);

  const fetchPreferences = async () => {
    setLoadingPrefs(true);
    try {
      const response = await fetch('/api/notification-preferences');
      const data = await response.json();

      if (data.success) {
        setPreferences(data.preferences || []);
      }
    } catch (error) {
      console.error('Error fetching preferences:', error);
    } finally {
      setLoadingPrefs(false);
    }
  };

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const { data: profilesData, error } = await (await import('@/lib/supabase/client')).createClient()
        .from('profiles')
        .select('id, full_name, role:roles(name)')
        .order('full_name');

      if (error) throw error;
      setUsers((profilesData || []).map((p: any) => ({
        id: p.id,
        full_name: p.full_name,
        role: p.role?.name || 'unknown',
      })));
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchAdminNotifications = async (userId: string) => {
    if (userId === 'all') {
      setAdminNotifications([]);
      return;
    }

    setLoadingAdminNotifications(true);
    try {
      const response = await fetch(`/api/messages/notifications/admin?user_id=${userId}`);
      const data = await response.json();

      if (data.success) {
        setAdminNotifications(data.notifications || []);
      } else {
        throw new Error(data.error || 'Failed to fetch notifications');
      }
    } catch (error) {
      console.error('Error fetching admin notifications:', error);
      toast.error('Failed to load user notifications');
    } finally {
      setLoadingAdminNotifications(false);
    }
  };

  useEffect(() => {
    if (selectedUserId && selectedUserId !== 'all') {
      fetchAdminNotifications(selectedUserId);
    } else {
      setAdminNotifications([]);
    }
  }, [selectedUserId]);

  const updatePreference = async (
    moduleKey: NotificationModuleKey,
    field: 'notify_in_app' | 'notify_email',
    value: boolean
  ) => {
    setSavingPrefModule(moduleKey);
    try {
      // Get current preference to ensure we send both fields
      const currentPref = preferences.find(p => p.module_key === moduleKey);
      
      // Prepare data with both fields
      const updateData = {
        module_key: moduleKey,
        notify_in_app: field === 'notify_in_app' ? value : (currentPref?.notify_in_app ?? true),
        notify_email: field === 'notify_email' ? value : (currentPref?.notify_email ?? true),
      };

      const response = await fetch('/api/notification-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });

      const data = await response.json();

      if (data.success) {
        // Update local state
        setPreferences(prev => {
          const existing = prev.find(p => p.module_key === moduleKey);
          if (existing) {
            return prev.map(p => p.module_key === moduleKey ? { ...p, [field]: value } : p);
          } else {
            return [...prev, data.preference];
          }
        });
        toast.success('Preference updated');
      } else {
        throw new Error(data.error || 'Failed to update preference');
      }
    } catch (error) {
      console.error('Error updating preference:', error);
      toast.error('Failed to update preference');
    } finally {
      setSavingPrefModule(null);
    }
  };

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

  const getPreference = (moduleKey: NotificationModuleKey) => {
    return preferences.find(p => p.module_key === moduleKey) || {
      notify_in_app: true,
      notify_email: true,
    };
  };

  const getModuleIcon = (iconName: string) => {
    const Icon = MODULE_ICONS[iconName] || Bell;
    return Icon;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-100 dark:bg-blue-950 rounded-lg">
            <Bell className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-1">
              Notifications
            </h1>
            <p className="text-muted-foreground">
              Manage your notifications and preferences
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div>
        <Tabs defaultValue="all" className="w-full">
            <TabsList className="grid w-full max-w-2xl grid-cols-3 bg-slate-100 dark:bg-slate-800 p-1">
              <TabsTrigger value="all" className="gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900">
                <Bell className="h-4 w-4" />
                All Notifications
              </TabsTrigger>
              <TabsTrigger value="preferences" className="gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900">
                <Settings className="h-4 w-4" />
                Preferences
              </TabsTrigger>
              {isAdmin && (
                <TabsTrigger value="admin" className="gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900">
                  <Users className="h-4 w-4" />
                  Admin
                </TabsTrigger>
              )}
            </TabsList>

            {/* All Notifications Tab */}
            <TabsContent value="all" className="space-y-4 mt-4">
              {/* Search */}
              <Card>
                <CardContent className="pt-6">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search notifications..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-11 bg-white dark:bg-slate-900 border-border dark:text-slate-100 text-slate-900"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Notifications List */}
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredNotifications.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Bell className="h-16 w-16 text-muted-foreground dark:text-slate-600 mb-3" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      No notifications found
                    </h3>
                    <p className="text-muted-foreground text-center">
                      {searchQuery ? 'Try adjusting your search' : 'You have no notifications in the last 60 days'}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {filteredNotifications.map((notification) => (
                    <Card
                      key={notification.id}
                      className="bg-white dark:bg-slate-900 border-border hover:shadow-lg transition-shadow cursor-pointer"
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
                              <h3 className="font-semibold text-foreground">
                                {notification.subject}
                              </h3>
                              {getStatusBadge(notification.status)}
                            </div>

                            <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                              {notification.body}
                            </p>

                            <div className="flex items-center gap-2 text-xs text-muted-foreground dark:text-muted-foreground">
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
            </TabsContent>

            {/* Preferences Tab */}
            <TabsContent value="preferences" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-foreground">Notification Preferences</CardTitle>
                  <CardDescription className="text-muted-foreground">
                    Customize how you receive notifications for different modules
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingPrefs ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {availableModules.map((module) => {
                        const pref = getPreference(module.key);
                        const Icon = getModuleIcon(module.icon);
                        const isSaving = savingPrefModule === module.key;

                        return (
                          <div key={module.key} className="pb-6 border-b border-border last:border-0 last:pb-0">
                            <div className="flex items-start gap-3 mb-4">
                              <Icon className="h-5 w-5 text-muted-foreground mt-0.5" />
                              <div className="flex-1">
                                <h3 className="font-medium text-foreground">{module.label}</h3>
                                <p className="text-sm text-muted-foreground">{module.description}</p>
                              </div>
                            </div>

                            <div className="ml-8 space-y-3">
                              <div className="flex items-center justify-between">
                                <Label htmlFor={`${module.key}-in-app`} className="text-sm font-medium text-foreground dark:text-slate-200">
                                  In-App Notifications
                                </Label>
                                <Switch
                                  id={`${module.key}-in-app`}
                                  checked={pref.notify_in_app}
                                  onCheckedChange={(checked) => updatePreference(module.key, 'notify_in_app', checked)}
                                  disabled={isSaving}
                                />
                              </div>
                              
                              <div className="flex items-center justify-between">
                                <Label htmlFor={`${module.key}-email`} className="text-sm font-medium text-foreground dark:text-slate-200">
                                  Email Notifications
                                </Label>
                                <Switch
                                  id={`${module.key}-email`}
                                  checked={pref.notify_email}
                                  onCheckedChange={(checked) => updatePreference(module.key, 'notify_email', checked)}
                                  disabled={isSaving}
                                />
                              </div>

                              {isSaving && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Saving...
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Admin Tab */}
            {isAdmin && (
              <TabsContent value="admin" className="space-y-4 mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-foreground">View Notifications For</CardTitle>
                    <CardDescription className="text-muted-foreground">
                      Select a user to view their notification history
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-3">
                      <Users className="h-5 w-5 text-muted-foreground" />
                      <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                        <SelectTrigger className="w-full max-w-md">
                          <SelectValue placeholder="Select user" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          <SelectItem value="all">Select a user...</SelectItem>
                          {users.map(u => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.full_name} ({u.role})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {/* Admin Notifications Display */}
                {selectedUserId === 'all' ? (
                  <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                      <Info className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <p>Select a user to view their notifications</p>
                    </CardContent>
                  </Card>
                ) : loadingAdminNotifications ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : adminNotifications.length === 0 ? (
                  <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                      <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <p>This user has no notifications in the last 60 days</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {adminNotifications.map((notification) => (
                      <Card
                        key={notification.id}
                        className="bg-white dark:bg-slate-900 border-border hover:shadow-lg transition-shadow cursor-pointer"
                        onClick={() => handleNotificationClick(notification)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-4">
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

                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <h3 className="font-semibold text-foreground">
                                  {notification.subject}
                                </h3>
                                {getStatusBadge(notification.status)}
                              </div>

                              <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                                {notification.body}
                              </p>

                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>From: {notification.sender_name}</span>
                                <span>•</span>
                                <span>{formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}</span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            )}
          </Tabs>
        </div>
      </div>

      {/* Modals */}
      {showModal && selectedNotification && (
        <>
          {selectedNotification.type === 'TOOLBOX_TALK' ? (
            <BlockingMessageModal
              open={showModal}
              message={{
                id: selectedNotification.message_id,
                recipient_id: selectedNotification.id,
                subject: selectedNotification.subject,
                body: selectedNotification.body,
                sender_name: selectedNotification.sender_name,
                created_at: selectedNotification.created_at,
              }}
              onSigned={handleModalClose}
              totalPending={1}
              currentIndex={1}
            />
          ) : (
            <ReminderModal
              open={showModal}
              onClose={handleModalClose}
              message={{
                id: selectedNotification.message_id,
                recipient_id: selectedNotification.id,
                subject: selectedNotification.subject,
                body: selectedNotification.body,
                sender_name: selectedNotification.sender_name,
                created_at: selectedNotification.created_at,
              }}
              onDismissed={handleModalClose}
            />
          )}
        </>
      )}
    </div>
  );
}
