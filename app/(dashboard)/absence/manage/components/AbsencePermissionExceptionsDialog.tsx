'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchUserDirectory } from '@/lib/client/user-directory';
import { cn } from '@/lib/utils';
import type {
  AbsenceSecondaryExceptionMatrixResponse,
  AbsenceSecondaryExceptionUserRow,
  AbsenceSecondaryPermissionHeaderGroup,
  AbsenceSecondaryPermissionKey,
} from '@/types/absence-permissions';
import { Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface AbsencePermissionExceptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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

const GROUP_COLOR_CLASS: Record<AbsenceSecondaryPermissionHeaderGroup['id'], string> = {
  'see-bookings': 'bg-yellow-300/90 text-slate-900',
  'add-edit-bookings': 'bg-amber-300/90 text-slate-900',
  'see-allowances': 'bg-lime-300/90 text-slate-900',
  'add-edit-allowances': 'bg-green-300/90 text-slate-900',
  'see-manage-overview': 'bg-indigo-300/90 text-slate-900',
  'see-manage-reasons': 'bg-purple-300/90 text-slate-900',
  'see-manage-work-shifts': 'bg-cyan-300/90 text-slate-900',
  'edit-manage-work-shifts': 'bg-blue-300/90 text-slate-900',
  'authorise-bookings': 'bg-sky-300/90 text-slate-900',
};

const SUBHEADER_CLASS = 'bg-slate-800/80 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

export function AbsencePermissionExceptionsDialog({ open, onOpenChange }: AbsencePermissionExceptionsDialogProps) {
  const [matrix, setMatrix] = useState<AbsenceSecondaryExceptionMatrixResponse | null>(null);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [addingUser, setAddingUser] = useState(false);
  const [savingCellKey, setSavingCellKey] = useState<string | null>(null);
  const [removingRowId, setRemovingRowId] = useState<string | null>(null);

  const loadMatrix = useCallback(async () => {
    setLoadingMatrix(true);
    try {
      const response = await fetch('/api/absence/permissions/secondary/exceptions', { cache: 'no-store' });
      const payload = (await response.json()) as AbsenceSecondaryExceptionMatrixResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Failed to load exception matrix');
      setMatrix(payload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load exception matrix');
    } finally {
      setLoadingMatrix(false);
    }
  }, []);

  const loadDirectory = useCallback(async () => {
    setLoadingDirectory(true);
    try {
      const users = (await fetchUserDirectory({ includeRole: true, module: 'absence' })) as DirectoryEntry[];
      setDirectory(users);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load user directory');
    } finally {
      setLoadingDirectory(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void Promise.all([loadMatrix(), loadDirectory()]);
  }, [open, loadMatrix, loadDirectory]);

  const availableUsers = useMemo(() => {
    const existingIds = new Set((matrix?.rows || []).map((row) => row.profile_id));
    return directory
      .filter((user) => !existingIds.has(user.id))
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  }, [directory, matrix?.rows]);

  async function handleAddUserException() {
    if (!selectedUserId) return;
    setAddingUser(true);
    try {
      const response = await fetch('/api/absence/permissions/secondary/exceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: selectedUserId }),
      });
      const payload = (await response.json()) as AbsenceSecondaryExceptionMatrixResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Failed to add exception user');
      setMatrix(payload);
      setSelectedUserId('');
      toast.success('User exception row added');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add exception user');
    } finally {
      setAddingUser(false);
    }
  }

  async function handleToggleCell(row: AbsenceSecondaryExceptionUserRow, key: AbsenceSecondaryPermissionKey) {
    const nextValue = !row.effective[key];
    const cellKey = `${row.profile_id}:${key}`;
    setSavingCellKey(cellKey);
    try {
      const response = await fetch(`/api/absence/permissions/secondary/exceptions/${row.profile_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: { [key]: nextValue } }),
      });
      const payload = (await response.json()) as AbsenceSecondaryExceptionMatrixResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Failed to update exception cell');
      setMatrix(payload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update exception cell');
    } finally {
      setSavingCellKey(null);
    }
  }

  async function handleResetCell(row: AbsenceSecondaryExceptionUserRow, key: AbsenceSecondaryPermissionKey) {
    const cellKey = `${row.profile_id}:${key}`;
    setSavingCellKey(cellKey);
    try {
      const response = await fetch(`/api/absence/permissions/secondary/exceptions/${row.profile_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: { [key]: null } }),
      });
      const payload = (await response.json()) as AbsenceSecondaryExceptionMatrixResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Failed to reset cell override');
      setMatrix(payload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reset cell override');
    } finally {
      setSavingCellKey(null);
    }
  }

  async function handleRemoveRow(profileId: string) {
    setRemovingRowId(profileId);
    try {
      const response = await fetch(`/api/absence/permissions/secondary/exceptions/${profileId}`, {
        method: 'DELETE',
      });
      const payload = (await response.json()) as AbsenceSecondaryExceptionMatrixResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Failed to remove exception row');
      setMatrix(payload);
      toast.success('Exception row removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove exception row');
    } finally {
      setRemovingRowId(null);
    }
  }

  const rows = matrix?.rows || [];
  const orderedKeys = matrix?.headers.orderedKeys || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border max-w-[96vw] w-[1400px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-foreground">Absence Secondary Permission Exceptions</DialogTitle>
          <DialogDescription className="text-slate-400/90">
            Add specific users and override the module&apos;s default secondary permissions.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-[hsl(var(--absence-primary)/0.25)] bg-[hsl(var(--absence-primary)/0.06)] p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="absence-exception-user" className="text-foreground font-medium">
                Add User Exception
              </Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId} disabled={addingUser || loadingDirectory}>
                <SelectTrigger id="absence-exception-user" className="bg-slate-950 border-border text-foreground">
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
              onClick={handleAddUserException}
              disabled={!selectedUserId || addingUser}
              className="bg-absence hover:bg-absence-dark text-white"
            >
              {addingUser ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Add User Exception
            </Button>
          </div>
        </div>

        <div className="border border-slate-700 rounded-lg overflow-auto">
          {loadingMatrix ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading exceptions matrix...
            </div>
          ) : rows.length === 0 ? (
            <div className="py-14 text-center text-muted-foreground">
              No user exceptions yet. Add a user to create their override row.
            </div>
          ) : (
            <table className="w-full text-sm table-fixed min-w-max">
              <colgroup>
                <col style={{ width: 260 }} />
                {orderedKeys.map((key) => (
                  <col key={key} style={{ width: 46 }} />
                ))}
                <col style={{ width: 88 }} />
              </colgroup>
              <thead>
                <tr>
                  <th
                    rowSpan={2}
                    className="sticky left-0 z-20 bg-slate-900 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-slate-700"
                  >
                    User
                  </th>
                  {(matrix?.headers.groups || []).map((group) => (
                    <th
                      key={group.id}
                      colSpan={group.columns.length}
                      className={cn('border-b border-slate-700 px-2 py-2 text-center text-xs font-semibold', GROUP_COLOR_CLASS[group.id])}
                    >
                      <div>{group.title}</div>
                    </th>
                  ))}
                  <th
                    rowSpan={2}
                    className="border-b border-slate-700 bg-slate-900 px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Actions
                  </th>
                </tr>
                <tr>
                  {(matrix?.headers.groups || []).flatMap((group) =>
                    group.columns.map((column) => (
                      <th key={column.key} className={cn('border-b border-slate-700 px-1 py-1 text-center', SUBHEADER_CLASS)}>
                        {column.label}
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.profile_id} className="border-b border-slate-800/70">
                    <td className="sticky left-0 z-10 bg-slate-900 px-3 py-2 align-top">
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

                    {orderedKeys.map((key) => {
                      const cellKey = `${row.profile_id}:${key}`;
                      const isSaving = savingCellKey === cellKey;
                      const hasOverride = row.overrides[key] !== null;
                      const isEnabled = row.effective[key];
                      const differsFromDefault = row.defaults[key] !== row.effective[key];
                      return (
                        <td key={key} className="px-1 py-1 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => handleToggleCell(row, key)}
                              className={cn(
                                'h-7 w-7 rounded border text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                                isEnabled
                                  ? 'border-green-500/40 bg-green-500/25 text-green-200 hover:bg-green-500/35'
                                  : 'border-slate-600 bg-slate-900 text-slate-300 hover:bg-slate-800',
                                hasOverride && 'ring-1 ring-sky-500/70',
                                isSaving && 'opacity-70 cursor-wait'
                              )}
                              title={
                                hasOverride
                                  ? differsFromDefault
                                    ? 'Overridden from default'
                                    : 'Explicit override matches default'
                                  : 'Using default'
                              }
                            >
                              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto" /> : isEnabled ? 'Y' : 'N'}
                            </button>
                            <button
                              type="button"
                              disabled={isSaving || row.overrides[key] === null}
                              onClick={() => handleResetCell(row, key)}
                              className="h-6 w-6 rounded border border-slate-700 bg-slate-900/70 text-slate-400 hover:text-slate-200 disabled:opacity-35 disabled:cursor-not-allowed"
                              title="Reset this cell to default"
                            >
                              <RotateCcw className="h-3 w-3 mx-auto" />
                            </button>
                          </div>
                        </td>
                      );
                    })}

                    <td className="px-2 py-1 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveRow(row.profile_id)}
                        disabled={removingRowId === row.profile_id}
                        className="h-8 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        {removingRowId === row.profile_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border text-muted-foreground">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

