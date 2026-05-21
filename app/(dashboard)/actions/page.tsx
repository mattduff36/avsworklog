'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, Loader2, RefreshCw, Send, TriangleAlert } from 'lucide-react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PageLoader } from '@/components/ui/page-loader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { cn } from '@/lib/utils/cn';
import type { ReminderActionWithAsset } from '@/types/reminders';

interface AssignableUser {
  id: string;
  full_name: string | null;
  employee_id?: string | null;
  has_module_access?: boolean;
  team?: {
    id: string;
    name: string | null;
  } | null;
  role?: {
    id?: string;
    name?: string;
    display_name?: string;
  } | null;
}

function getDaysOverdueLabel(action: ReminderActionWithAsset): string {
  const value = action.metadata?.days_overdue;
  return typeof value === 'number' ? `${value}d overdue` : 'No check recorded';
}

function getLatestInspectionLabel(action: ReminderActionWithAsset): string {
  const value = action.metadata?.last_submitted_inspection_date;
  return typeof value === 'string' ? value : 'Never submitted';
}

function getStatusBadgeVariant(status: ReminderActionWithAsset['status']) {
  if (status === 'resolved') return 'success';
  if (status === 'cancelled') return 'secondary';
  return 'warning';
}

export default function ActionsPage() {
  const router = useRouter();
  const { hasPermission: canViewActions, loading: actionsPermissionLoading } = usePermissionCheck('actions', false);
  const [actions, setActions] = useState<ReminderActionWithAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<ReminderActionWithAsset | null>(null);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  useEffect(() => {
    if (!actionsPermissionLoading && !canViewActions) {
      router.replace('/dashboard');
    }
  }, [actionsPermissionLoading, canViewActions, router]);

  const loadActions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/actions?status=open&workflow=fleet_inspection_overdue', {
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load actions');
      }

      setActions((payload.actions || []) as ReminderActionWithAsset[]);
    } catch (error) {
      console.error(error);
      setActions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!actionsPermissionLoading && canViewActions) {
      void loadActions();
    }
  }, [actionsPermissionLoading, canViewActions, loadActions]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const response = await fetch('/api/users/directory?module=reminders&includeRole=1', {
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load users');
      }

      setUsers((payload.users || []) as AssignableUser[]);
    } catch (error) {
      console.error(error);
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const response = await fetch('/api/actions/generate-fleet-inspection-reminders', {
        method: 'POST',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to generate actions');
      }

      await loadActions();
    } catch (error) {
      console.error(error);
    } finally {
      setGenerating(false);
    }
  }, [loadActions]);

  const openAssignDialog = useCallback(async (action: ReminderActionWithAsset) => {
    setSelectedAction(action);
    setSelectedUserIds([]);
    setSearchValue('');
    setAssignDialogOpen(true);
    if (!users.length) {
      await loadUsers();
    }
  }, [loadUsers, users.length]);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = searchValue.trim().toLowerCase();
    return users.filter((user) => {
      if (user.has_module_access === false) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return [
        user.full_name || '',
        user.employee_id || '',
        user.team?.name || '',
        user.role?.display_name || user.role?.name || '',
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [searchValue, users]);

  function handleToggleUser(userId: string) {
    setSelectedUserIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  async function handleAssignSelectedUsers() {
    if (!selectedAction || selectedUserIds.length === 0) {
      return;
    }

    setAssigning(true);
    try {
      const response = await fetch('/api/actions/assign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action_id: selectedAction.id,
          assignee_ids: selectedUserIds,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to assign users');
      }

      setAssignDialogOpen(false);
      setSelectedAction(null);
      setSelectedUserIds([]);
      await loadActions();
    } catch (error) {
      console.error(error);
    } finally {
      setAssigning(false);
    }
  }

  if (actionsPermissionLoading) {
    return <PageLoader message="Loading actions..." />;
  }

  if (!canViewActions) {
    return <PageLoader message="Redirecting..." />;
  }

  return (
    <AppPageShell>
      <AppPageHeader
        title="Actions"
        description="Generated actions that managers and admins can assign as employee reminders."
        icon={<BellRing className="h-5 w-5" />}
        iconContainerClassName="bg-reminders-soft text-reminders"
        actions={(
          <Button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating}
            className="gap-2"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh generated actions
          </Button>
        )}
      />

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-foreground">Fleet inspection reminders</CardTitle>
          <CardDescription className="text-muted-foreground">
            Open actions are generated automatically for active assets with no submitted check in the last 4 weeks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Open actions</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{actions.length}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Pending reminders</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {actions.reduce((total, action) => total + action.reminders_count.pending, 0)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Actioned reminders</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {actions.reduce((total, action) => total + action.reminders_count.actioned, 0)}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-reminders" />
            </div>
          ) : actions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/10 p-8 text-center">
              <TriangleAlert className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                No overdue fleet inspection actions are currently open.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Latest submitted</TableHead>
                    <TableHead>Overdue</TableHead>
                    <TableHead>Reminder counts</TableHead>
                    <TableHead className="text-right">Assign</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {actions.map((action) => (
                    <TableRow key={action.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">{action.asset_label || action.title}</p>
                          <p className="text-xs text-muted-foreground">{action.description}</p>
                          {action.asset_route ? (
                            <Link href={action.asset_route} className="text-xs text-reminders hover:underline">
                              Open asset history
                            </Link>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(action.status)}>{action.status}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {getLatestInspectionLabel(action)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="warning">{getDaysOverdueLabel(action)}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">Pending {action.reminders_count.pending}</Badge>
                          <Badge variant="outline">Actioned {action.reminders_count.actioned}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button type="button" variant="outline" onClick={() => void openAssignDialog(action)}>
                          Assign users
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Assign reminder</DialogTitle>
            <DialogDescription>
              {selectedAction?.asset_label || selectedAction?.title || 'Select users to receive this reminder.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Input
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search by name, team or role"
            />

            <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
              {usersLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-reminders" />
                </div>
              ) : filteredUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No eligible users found.</p>
              ) : (
                filteredUsers.map((user) => {
                  const isSelected = selectedUserIds.includes(user.id);
                  return (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => handleToggleUser(user.id)}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                        isSelected ? 'border-reminders bg-reminders-soft' : 'border-border hover:bg-muted/20',
                      )}
                    >
                      <Checkbox checked={isSelected} className="mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">{user.full_name || 'Unknown user'}</p>
                        <p className="text-xs text-muted-foreground">
                          {[user.employee_id, user.team?.name, user.role?.display_name || user.role?.name]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleAssignSelectedUsers()}
              disabled={assigning || selectedUserIds.length === 0}
              className="gap-2"
            >
              {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Assign reminder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppPageShell>
  );
}
