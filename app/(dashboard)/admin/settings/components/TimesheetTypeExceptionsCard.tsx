'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PanelLoader } from '@/components/ui/panel-loader';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import {
  TimesheetTypeOptions,
  getTimesheetTypeLabel,
} from '@/app/(dashboard)/timesheets/types/registry';
import { CircleHelp, Loader2, Plus, RotateCcw, Trash2, UserRoundCog } from 'lucide-react';
import { toast } from 'sonner';
import type {
  TimesheetExceptionOverrideType,
  TimesheetTypeExceptionMatrixResponse,
} from '@/types/timesheet-type-exceptions';

interface DirectoryEntry {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  role?: {
    name?: string | null;
    display_name?: string | null;
  } | null;
  team?: {
    id?: string | null;
    name?: string | null;
  } | null;
}

const SETTINGS_HELPER_TEXT_CLASS = 'text-sm leading-relaxed text-slate-400';

function getTimesheetOverrideLabel(value: TimesheetExceptionOverrideType): string {
  if (value === 'user_choice') return "User's Choice";
  return getTimesheetTypeLabel(value);
}

export function TimesheetTypeExceptionsCard() {
  const [matrix, setMatrix] = useState<TimesheetTypeExceptionMatrixResponse | null>(null);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [addingUser, setAddingUser] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [removingRowId, setRemovingRowId] = useState<string | null>(null);

  const loadMatrix = useCallback(async () => {
    setLoadingMatrix(true);
    try {
      const response = await fetch('/api/admin/settings/timesheet-exceptions', { cache: 'no-store' });
      const payload = (await response.json()) as (TimesheetTypeExceptionMatrixResponse & { error?: string });
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load timesheet overrides');
      }
      setMatrix({ rows: payload.rows || [] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load timesheet overrides');
    } finally {
      setLoadingMatrix(false);
    }
  }, []);

  const loadDirectory = useCallback(async () => {
    setLoadingDirectory(true);
    try {
      const users = (await fetchUserDirectory({ includeRole: true, module: 'timesheets' })) as DirectoryEntry[];
      setDirectory(users);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load user directory');
    } finally {
      setLoadingDirectory(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadMatrix(), loadDirectory()]);
  }, [loadDirectory, loadMatrix]);

  const availableUsers = useMemo(() => {
    const existingIds = new Set((matrix?.rows || []).map((row) => row.profile_id));
    return directory
      .filter((user) => !existingIds.has(user.id))
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  }, [directory, matrix?.rows]);
  const rows = matrix?.rows || [];
  const activeOverrideCount = rows.filter((row) => row.override_timesheet_type !== null).length;

  async function handleAddUser() {
    if (!selectedUserId) return;
    setAddingUser(true);
    try {
      const response = await fetch('/api/admin/settings/timesheet-exceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: selectedUserId }),
      });
      const payload = (await response.json()) as (TimesheetTypeExceptionMatrixResponse & { error?: string });
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to add override row');
      }
      setMatrix({ rows: payload.rows || [] });
      setSelectedUserId('');
      toast.success('User added to timesheet override matrix');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add override row');
    } finally {
      setAddingUser(false);
    }
  }

  async function handleUpdateOverride(profileId: string, timesheetType: TimesheetExceptionOverrideType | null) {
    setSavingRowId(profileId);
    try {
      const response = await fetch(`/api/admin/settings/timesheet-exceptions/${profileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timesheet_type: timesheetType }),
      });
      const payload = (await response.json()) as (TimesheetTypeExceptionMatrixResponse & { error?: string });
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update override');
      }
      setMatrix({ rows: payload.rows || [] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update override');
    } finally {
      setSavingRowId(null);
    }
  }

  async function handleRemoveRow(profileId: string) {
    setRemovingRowId(profileId);
    try {
      const response = await fetch(`/api/admin/settings/timesheet-exceptions/${profileId}`, {
        method: 'DELETE',
      });
      const payload = (await response.json()) as (TimesheetTypeExceptionMatrixResponse & { error?: string });
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to remove override row');
      }
      setMatrix({ rows: payload.rows || [] });
      toast.success('Override row removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove override row');
    } finally {
      setRemovingRowId(null);
    }
  }

  return (
    <Card id="timesheet-overrides" className="scroll-mt-6 overflow-hidden border-border bg-slate-900/60">
      <CardHeader className="border-b border-border bg-gradient-to-r from-sky-500/10 via-transparent to-transparent">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-white">
              <UserRoundCog className="h-5 w-5 text-sky-400" />
              Timesheet Overrides
            </CardTitle>
            <CardDescription className={`${SETTINGS_HELPER_TEXT_CLASS} mt-2 max-w-3xl`}>
              Override the normal timesheet form for individual employees who need a different form.
              This does not change their team or payroll rule assignment.
            </CardDescription>
          </div>
          <Badge variant="outline" className="w-fit border-sky-500/30 bg-sky-500/10 text-sky-300">
            {activeOverrideCount} active override{activeOverrideCount === 1 ? '' : 's'} · {rows.length} listed
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-6">
        <div className="flex items-start gap-3 rounded-lg border border-sky-500/25 bg-sky-500/5 p-4">
          <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">When should I use an override?</p>
            <p className={SETTINGS_HELPER_TEXT_CLASS}>
              Add an employee only when their required form differs from the team default. Choose
              <strong className="font-medium text-slate-200"> User&apos;s Choice</strong> to let them select
              a form when creating a timesheet, or choose a specific form to enforce it.
            </p>
            <p className="text-xs text-muted-foreground">
              Reset removes the individual override and recalculates the effective form from the configured
              team, role, and system defaults. Remove deletes their row from this list.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4 space-y-3">
          <div>
            <p className="font-semibold text-foreground">Add an employee</p>
            <p className="text-xs text-muted-foreground">
              Search the directory, add the employee, then choose their override in the table below.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="timesheet-exception-user" className="text-white font-medium">
                Add User Override
              </Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId} disabled={addingUser || loadingDirectory}>
                <SelectTrigger id="timesheet-exception-user" className="bg-slate-950 border-border text-foreground">
                  <SelectValue placeholder={loadingDirectory ? 'Loading users...' : 'Select user'} />
                </SelectTrigger>
                <SelectContent className="bg-slate-950 border-border text-foreground max-h-72">
                  {availableUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {(user.full_name || 'Unknown user') +
                        (user.employee_id ? ` (${user.employee_id})` : '') +
                        (user.role?.display_name ? ` - ${user.role.display_name}` : '')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              onClick={handleAddUser}
              disabled={!selectedUserId || addingUser}
              className="bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900"
            >
              {addingUser ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Add User
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <p className="font-semibold text-foreground">Current employee overrides</p>
            <p className="text-xs text-muted-foreground">
              The Effective column shows the form the employee will actually receive.
            </p>
          </div>
          <div className="border border-slate-700 rounded-lg overflow-auto">
          {loadingMatrix ? (
            <PanelLoader message="Loading timesheet override matrix..." accent="timesheet" className="py-16" />
          ) : rows.length === 0 ? (
            <div className="py-14 text-center text-sm leading-relaxed text-muted-foreground">
              No user overrides yet. Add a user to create their override row.
            </div>
          ) : (
            <table className="w-full text-sm min-w-[920px]">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">User</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Team Default</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Override</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Effective</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isSaving = savingRowId === row.profile_id;
                  const isRemoving = removingRowId === row.profile_id;
                  const overrideValue = row.override_timesheet_type || 'default';
                  const isUserChoice = row.effective_timesheet_type === 'user_choice';
                  return (
                    <tr key={row.profile_id} className="border-b border-slate-800/70">
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-white">{row.full_name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {row.employee_id ? (
                            <Badge variant="outline" className="border-slate-600 text-muted-foreground text-[10px] px-1.5 py-0">
                              {row.employee_id}
                            </Badge>
                          ) : null}
                          {row.role_display_name ? (
                            <Badge variant="outline" className="border-slate-600 text-muted-foreground text-[10px] px-1.5 py-0">
                              {row.role_display_name}
                            </Badge>
                          ) : null}
                          {row.team_name ? (
                            <Badge variant="outline" className="border-slate-600 text-muted-foreground text-[10px] px-1.5 py-0">
                              {row.team_name}
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {getTimesheetTypeLabel(row.team_timesheet_type)}
                      </td>
                      <td className="px-3 py-2 min-w-[220px]">
                        <Select
                          value={overrideValue}
                          disabled={isSaving || isRemoving}
                          onValueChange={(value) => {
                            const nextValue = value === 'default' ? null : (value as TimesheetExceptionOverrideType);
                            void handleUpdateOverride(row.profile_id, nextValue);
                          }}
                        >
                            <SelectTrigger
                              aria-label={`Timesheet override for ${row.full_name}`}
                              className="bg-slate-950 border-border text-foreground"
                            >
                              <SelectValue placeholder="Use configured default" />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-950 border-border text-foreground">
                            <SelectItem value="default">Use configured default</SelectItem>
                            <SelectItem value="user_choice">User&apos;s Choice</SelectItem>
                            {TimesheetTypeOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2 text-white">
                        <div className="flex items-center gap-2">
                          <span>{getTimesheetOverrideLabel(row.effective_timesheet_type)}</span>
                          {isUserChoice ? (
                            <Badge className="bg-amber-600/30 text-amber-100 border border-amber-500/40">Choice</Badge>
                          ) : row.override_timesheet_type ? (
                            <Badge className="bg-sky-600/30 text-sky-200 border border-sky-500/40">Override</Badge>
                          ) : (
                            <Badge variant="outline" className="border-slate-600 text-muted-foreground">Default</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUpdateOverride(row.profile_id, null)}
                            disabled={isSaving || isRemoving || row.override_timesheet_type === null}
                            className="h-8 px-2 text-slate-300 hover:text-white hover:bg-slate-800"
                            title="Reset to configured default"
                            aria-label={`Reset ${row.full_name} to configured default`}
                          >
                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveRow(row.profile_id)}
                            disabled={isRemoving || isSaving}
                            className="h-8 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            title="Remove user row"
                            aria-label={`Remove ${row.full_name} override row`}
                          >
                            {isRemoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
