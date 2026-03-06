import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckSquare, Loader2, Search, Send, Users } from 'lucide-react';

export function NotificationSettingsDebugPanel() {
  const [users, setUsers] = useState<Array<{
    user_id: string;
    full_name: string;
    role_name: string;
    preferences: Array<{
      id?: string;
      module_key: string;
      enabled: boolean;
      notify_in_app: boolean;
      notify_email: boolean;
    }>;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [saving, setSaving] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());

  const MODULES = [
    { key: 'errors', label: 'Error Reports' },
    { key: 'maintenance', label: 'Maintenance' },
    { key: 'rams', label: 'RAMS Signatures' },
    { key: 'approvals', label: 'Approvals' },
    { key: 'inspections', label: 'Inspections' },
  ];

  useEffect(() => {
    fetchAllPreferences();
  }, []);

  const fetchAllPreferences = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/notification-preferences/admin');
      const data = await response.json();

      if (data.success) {
        setUsers(data.users || []);
      } else {
        throw new Error(data.error || 'Failed to fetch preferences');
      }
    } catch (error) {
      console.error('Error fetching notification preferences:', error);
      toast.error('Failed to load notification preferences');
    } finally {
      setLoading(false);
    }
  };

  const updatePreference = async (
    userId: string,
    moduleKey: string,
    field: 'notify_in_app' | 'notify_email',
    value: boolean
  ) => {
    const saveKey = `${userId}-${moduleKey}-${field}`;
    setSaving(saveKey);
    try {
      const user = users.find(u => u.user_id === userId);
      const currentPref = user?.preferences.find(p => p.module_key === moduleKey);

      const updateData = {
        user_id: userId,
        module_key: moduleKey,
        enabled: currentPref?.enabled ?? true,
        notify_in_app: field === 'notify_in_app' ? value : (currentPref?.notify_in_app ?? true),
        notify_email: field === 'notify_email' ? value : (currentPref?.notify_email ?? true),
      };

      const response = await fetch('/api/notification-preferences/admin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });

      const data = await response.json();

      if (data.success) {
        setUsers(prev => prev.map(u => {
          if (u.user_id === userId) {
            const prefs = u.preferences.map(p =>
              p.module_key === moduleKey ? { ...p, [field]: value } : p
            );
            if (!prefs.find((p: { module_key: string }) => p.module_key === moduleKey)) {
              prefs.push({
                module_key: moduleKey,
                enabled: true,
                notify_in_app: updateData.notify_in_app,
                notify_email: updateData.notify_email,
              });
            }
            return { ...u, preferences: prefs };
          }
          return u;
        }));
        toast.success('Preference updated');
      } else {
        throw new Error(data.error || 'Failed to update');
      }
    } catch (error) {
      console.error('Error updating preference:', error);
      toast.error('Failed to update preference');
    } finally {
      setSaving(null);
    }
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.role_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'all' || u.role_name.toLowerCase() === roleFilter.toLowerCase();
    return matchesSearch && matchesRole;
  });

  const uniqueRoles = Array.from(new Set(users.map(u => u.role_name))).sort();

  const batchUpdatePreference = async (
    field: 'notify_in_app' | 'notify_email',
    value: boolean,
    targetModule?: string
  ) => {
    if (selectedUsers.size === 0) {
      toast.error('Please select users first');
      return;
    }

    const modulesToUpdate = targetModule ? [targetModule] : MODULES.map(m => m.key);

    setSaving('batch');
    try {
      const updates = Array.from(selectedUsers).flatMap(userId =>
        modulesToUpdate.map(moduleKey => ({
          userId,
          moduleKey,
          field,
          value
        }))
      );

      const responses = await Promise.all(updates.map(({ userId, moduleKey }) => {
        const user = users.find(u => u.user_id === userId);
        const currentPref = user?.preferences.find(p => p.module_key === moduleKey);

        const updateData = {
          user_id: userId,
          module_key: moduleKey,
          enabled: currentPref?.enabled ?? true,
          notify_in_app: field === 'notify_in_app' ? value : (currentPref?.notify_in_app ?? true),
          notify_email: field === 'notify_email' ? value : (currentPref?.notify_email ?? true),
        };

        return fetch('/api/notification-preferences/admin', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        });
      }));

      const failedCount = responses.filter(r => !r.ok).length;

      if (failedCount > 0) {
        toast.error(`Failed to update ${failedCount} of ${responses.length} preferences`, {
          description: 'Some updates may have failed. Please check and try again.'
        });
      } else {
        toast.success(`Updated ${selectedUsers.size} user(s)`);
        setSelectedUsers(new Set());
        setBatchMode(false);
      }

      await fetchAllPreferences();
    } catch (error) {
      console.error('Error batch updating:', error);
      toast.error('Failed to batch update');
    } finally {
      setSaving(null);
    }
  };

  const toggleUserSelection = (userId: string) => {
    const newSelection = new Set(selectedUsers);
    if (newSelection.has(userId)) {
      newSelection.delete(userId);
    } else {
      newSelection.add(userId);
    }
    setSelectedUsers(newSelection);
  };

  const selectAll = () => {
    setSelectedUsers(new Set(filteredUsers.map(u => u.user_id)));
  };

  const deselectAll = () => {
    setSelectedUsers(new Set());
  };

  const getRoleBadgeVariant = (roleName: string) => {
    const lowerRole = roleName.toLowerCase();
    if (lowerRole.includes('super') || lowerRole === 'admin') return 'destructive';
    if (lowerRole === 'manager') return 'warning';
    return 'secondary';
  };

  const getRoleDisplayName = (roleName: string) => {
    return roleName;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          User Notification Settings
        </CardTitle>
        <CardDescription>
          View and override notification preferences for all users
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-white dark:bg-slate-900"
            />
          </div>

          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-full md:w-[200px] bg-white dark:bg-slate-900">
              <SelectValue placeholder="All Roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {uniqueRoles.map(role => (
                <SelectItem key={role} value={role}>{role}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-full md:w-[200px] bg-white dark:bg-slate-900">
              <SelectValue placeholder="All Modules" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modules</SelectItem>
              {MODULES.map(m => (
                <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={batchMode ? "default" : "outline"}
            onClick={() => {
              setBatchMode(!batchMode);
              if (batchMode) {
                setSelectedUsers(new Set());
              }
            }}
            className="whitespace-nowrap"
          >
            <CheckSquare className="h-4 w-4 mr-2" />
            Batch Mode
          </Button>
        </div>

        {batchMode && (
          <div className="flex flex-wrap gap-2 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-900">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground w-full mb-2">
              {selectedUsers.size} user(s) selected
              <Button size="sm" variant="ghost" onClick={selectAll}>Select All</Button>
              <Button size="sm" variant="ghost" onClick={deselectAll}>Clear</Button>
            </div>
            <Button size="sm" variant="outline" onClick={() => batchUpdatePreference('notify_in_app', true, moduleFilter !== 'all' ? moduleFilter : undefined)} disabled={saving === 'batch'}>
              Enable In-App
            </Button>
            <Button size="sm" variant="outline" onClick={() => batchUpdatePreference('notify_in_app', false, moduleFilter !== 'all' ? moduleFilter : undefined)} disabled={saving === 'batch'}>
              Disable In-App
            </Button>
            <Button size="sm" variant="outline" onClick={() => batchUpdatePreference('notify_email', true, moduleFilter !== 'all' ? moduleFilter : undefined)} disabled={saving === 'batch'}>
              Enable Email
            </Button>
            <Button size="sm" variant="outline" onClick={() => batchUpdatePreference('notify_email', false, moduleFilter !== 'all' ? moduleFilter : undefined)} disabled={saving === 'batch'}>
              Disable Email
            </Button>
            {saving === 'batch' && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No users match your filters</p>
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-border bg-slate-50 dark:bg-slate-800/50">
                    {batchMode && (
                      <th className="p-3 text-left">
                        <input type="checkbox" checked={selectedUsers.size === filteredUsers.length} onChange={() => selectedUsers.size === filteredUsers.length ? deselectAll() : selectAll()} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary cursor-pointer" />
                      </th>
                    )}
                    <th className="p-3 text-left text-sm font-medium text-foreground">User</th>
                    <th className="p-3 text-left text-sm font-medium text-foreground">Role</th>
                    {MODULES.filter(m => moduleFilter === 'all' || m.key === moduleFilter).map(module => (
                      <th key={module.key} className="p-3 text-center text-sm font-medium text-foreground">
                        <div className="flex flex-col gap-1">
                          <span>{module.label}</span>
                          <div className="flex gap-2 text-xs text-muted-foreground justify-center">
                            <span>App</span>
                            <span>Email</span>
                          </div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(user => {
                    const getPref = (moduleKey: string) => {
                      return user.preferences.find(p => p.module_key === moduleKey) || {
                        notify_in_app: true,
                        notify_email: true,
                      };
                    };

                    return (
                      <tr key={user.user_id} className="border-b border-border hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        {batchMode && (
                          <td className="p-3">
                            <input type="checkbox" checked={selectedUsers.has(user.user_id)} onChange={() => toggleUserSelection(user.user_id)} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary cursor-pointer" />
                          </td>
                        )}
                        <td className="p-3 text-sm font-medium text-foreground">{user.full_name}</td>
                        <td className="p-3">
                          <Badge variant={getRoleBadgeVariant(user.role_name)}>
                            {getRoleDisplayName(user.role_name)}
                          </Badge>
                        </td>
                        {MODULES.filter(m => moduleFilter === 'all' || m.key === moduleFilter).map(module => {
                          const pref = getPref(module.key);
                          const saveKey = `${user.user_id}-${module.key}`;
                          const isSaving = saving?.startsWith(saveKey) || false;

                          return (
                            <td key={module.key} className="p-3">
                              <div className="flex gap-4 justify-center items-center">
                                <input type="checkbox" checked={pref.notify_in_app} onChange={(e) => updatePreference(user.user_id, module.key, 'notify_in_app', e.target.checked)} disabled={isSaving} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary focus:ring-offset-0 bg-white dark:bg-slate-700 cursor-pointer disabled:opacity-50" />
                                <input type="checkbox" checked={pref.notify_email} onChange={(e) => updatePreference(user.user_id, module.key, 'notify_email', e.target.checked)} disabled={isSaving} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary focus:ring-offset-0 bg-white dark:bg-slate-700 cursor-pointer disabled:opacity-50" />
                                {isSaving && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="md:hidden space-y-4">
              {filteredUsers.map(user => {
                const getPref = (moduleKey: string) => {
                  return user.preferences.find(p => p.module_key === moduleKey) || {
                    notify_in_app: true,
                    notify_email: true,
                  };
                };

                return (
                  <Card key={user.user_id} className="border-2">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-lg">{user.full_name}</CardTitle>
                          <div className="mt-1">
                            <Badge variant={getRoleBadgeVariant(user.role_name)}>
                              {getRoleDisplayName(user.role_name)}
                            </Badge>
                          </div>
                        </div>
                        {batchMode && (
                          <input type="checkbox" checked={selectedUsers.has(user.user_id)} onChange={() => toggleUserSelection(user.user_id)} className="h-5 w-5 rounded border-slate-300 dark:border-slate-600 text-primary cursor-pointer" />
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {MODULES.filter(m => moduleFilter === 'all' || m.key === moduleFilter).map(module => {
                          const pref = getPref(module.key);
                          const saveKey = `${user.user_id}-${module.key}`;
                          const isSaving = saving?.startsWith(saveKey) || false;

                          return (
                            <div key={module.key} className="flex items-center justify-between p-2 rounded border border-border bg-white dark:bg-slate-800/50">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-foreground dark:text-slate-200">{module.label}</p>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">App</span>
                                  <input type="checkbox" checked={pref.notify_in_app} onChange={(e) => updatePreference(user.user_id, module.key, 'notify_in_app', e.target.checked)} disabled={isSaving} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary focus:ring-offset-0 bg-white dark:bg-slate-700 cursor-pointer disabled:opacity-50" />
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Email</span>
                                  <input type="checkbox" checked={pref.notify_email} onChange={(e) => updatePreference(user.user_id, module.key, 'notify_email', e.target.checked)} disabled={isSaving} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary focus:ring-offset-0 bg-white dark:bg-slate-700 cursor-pointer disabled:opacity-50" />
                                </div>
                                {isSaving && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
