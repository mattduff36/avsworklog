'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Shield, Plus, Edit, Trash2, Loader2, AlertTriangle, FileText, Check, Minus } from 'lucide-react';
import type { RoleMatrixRow, ModuleName } from '@/types/roles';
import {
  ALL_MODULES,
  STANDARD_MODULES,
  MANAGEMENT_MODULES,
  MODULE_SHORT_NAMES,
  MODULE_DISPLAY_NAMES,
  MODULE_CSS_VAR,
} from '@/types/roles';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TimesheetTypeOptions } from '@/app/(dashboard)/timesheets/types/registry';

function getModuleColor(mod: ModuleName): string {
  const cssVar = MODULE_CSS_VAR[mod];
  return `hsl(var(${cssVar}))`;
}

function getModuleColorAlpha(mod: ModuleName, alpha: number): string {
  const cssVar = MODULE_CSS_VAR[mod];
  return `hsl(var(${cssVar}) / ${alpha})`;
}

export function RoleManagement() {
  const [matrixRoles, setMatrixRoles] = useState<RoleMatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<RoleMatrixRow | null>(null);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const abortControllers = useRef<Map<string, AbortController>>(new Map());

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    display_name: '',
    description: '',
    is_manager_admin: false,
    timesheet_type: 'civils' as string,
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    fetchRoles();
  }, []);

  async function fetchRoles() {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/roles');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch roles');
      }

      setMatrixRoles(data.matrix ?? []);
    } catch (error) {
      console.error('Error fetching roles:', error);
      toast.error('Failed to load roles');
    } finally {
      setLoading(false);
    }
  }

  const handleTogglePermission = useCallback(
    async (role: RoleMatrixRow, mod: ModuleName, newValue: boolean) => {
      const cellKey = `${role.id}:${mod}`;

      const prev = abortControllers.current.get(cellKey);
      if (prev) prev.abort();

      const controller = new AbortController();
      abortControllers.current.set(cellKey, controller);

      const oldPermissions = { ...role.permissions };
      const updatedPermissions = { ...role.permissions, [mod]: newValue };

      setMatrixRoles((prev) =>
        prev.map((r) =>
          r.id === role.id ? { ...r, permissions: updatedPermissions } : r
        )
      );

      setSavingCells((prev) => new Set(prev).add(cellKey));

      try {
        const permissionsArray = ALL_MODULES.map((m) => ({
          module_name: m,
          enabled: m === mod ? newValue : role.permissions[m],
        }));

        const response = await fetch(`/api/admin/roles/${role.id}/permissions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissions: permissionsArray }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to update permission');
        }

        toast.success(
          `${MODULE_SHORT_NAMES[mod]} ${newValue ? 'enabled' : 'disabled'} for ${role.display_name}`,
          { duration: 2000 }
        );
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;

        setMatrixRoles((prev) =>
          prev.map((r) =>
            r.id === role.id ? { ...r, permissions: oldPermissions } : r
          )
        );
        toast.error(
          `Failed to update ${MODULE_SHORT_NAMES[mod]} for ${role.display_name}`
        );
      } finally {
        if (abortControllers.current.get(cellKey) === controller) {
          setSavingCells((prev) => {
            const next = new Set(prev);
            next.delete(cellKey);
            return next;
          });
          abortControllers.current.delete(cellKey);
        }
      }
    },
    []
  );

  async function handleAddRole() {
    if (!formData.name || !formData.display_name) {
      setFormError('Please fill in all required fields');
      return;
    }

    try {
      setFormLoading(true);
      setFormError('');

      const response = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create role');
      }

      toast.success('Role created successfully');
      fetchRoles();
      setAddDialogOpen(false);
      resetForm();
    } catch (error) {
      console.error('Error creating role:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to create role');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleEditRole() {
    if (!selectedRole || !formData.display_name) {
      setFormError('Please fill in all required fields');
      return;
    }

    try {
      setFormLoading(true);
      setFormError('');

      const response = await fetch(`/api/admin/roles/${selectedRole.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update role');
      }

      toast.success('Role updated successfully');
      fetchRoles();
      setEditDialogOpen(false);
      setSelectedRole(null);
      resetForm();
    } catch (error) {
      console.error('Error updating role:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to update role');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDeleteRole() {
    if (!selectedRole) return;

    try {
      setFormLoading(true);
      setFormError('');

      const response = await fetch(`/api/admin/roles/${selectedRole.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete role');
      }

      toast.success('Role deleted successfully');
      fetchRoles();
      setDeleteDialogOpen(false);
      setSelectedRole(null);
    } catch (error) {
      console.error('Error deleting role:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to delete role');
    } finally {
      setFormLoading(false);
    }
  }

  function openEditDialog(role: RoleMatrixRow) {
    setSelectedRole(role);
    setFormData({
      name: role.name,
      display_name: role.display_name,
      description: role.description || '',
      is_manager_admin: role.is_manager_admin,
      timesheet_type: role.timesheet_type || 'civils',
    });
    setFormError('');
    setEditDialogOpen(true);
  }

  function openDeleteDialog(role: RoleMatrixRow) {
    setSelectedRole(role);
    setFormError('');
    setDeleteDialogOpen(true);
  }

  function resetForm() {
    setFormData({
      name: '',
      display_name: '',
      description: '',
      is_manager_admin: false,
      timesheet_type: 'civils',
    });
    setFormError('');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const isProtectedRole = (role: RoleMatrixRow) =>
    role.is_super_admin || role.is_manager_admin;

  function renderModuleColumns(modules: ModuleName[]) {
    return modules.map((mod) => (
      <th
        key={mod}
        className="p-0 align-bottom"
        style={{ width: 30, minWidth: 30, maxWidth: 30, height: 100 }}
      >
        <div className="flex items-end justify-center h-full pb-2">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="cursor-default text-[11px] font-medium tracking-wide whitespace-nowrap"
                  style={{
                    writingMode: 'vertical-rl',
                    transform: 'rotate(180deg)',
                    color: getModuleColor(mod),
                  }}
                >
                  {MODULE_SHORT_NAMES[mod]}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {MODULE_DISPLAY_NAMES[mod]}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </th>
    ));
  }

  function renderPermissionCell(role: RoleMatrixRow, mod: ModuleName) {
    const cellKey = `${role.id}:${mod}`;
    const isSaving = savingCells.has(cellKey);
    const isEnabled = role.permissions[mod];
    const isProtected = isProtectedRole(role);
    const color = getModuleColor(mod);

    if (isProtected) {
      return (
        <td key={mod} className="px-0 py-0.5 text-center">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-center">
                  <div
                    className="h-6 w-6 rounded flex items-center justify-center"
                    style={{ backgroundColor: `color-mix(in srgb, ${color} 25%, transparent)` }}
                  >
                    <Check className="h-3.5 w-3.5" style={{ color }} />
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {role.is_super_admin ? 'Super Admin' : 'Manager/Admin'} — full access
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </td>
      );
    }

    return (
      <td key={mod} className="px-0 py-0.5 text-center">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => handleTogglePermission(role, mod, !isEnabled)}
                className="h-6 w-6 rounded flex items-center justify-center mx-auto transition-all duration-150 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                style={
                  isSaving
                    ? { backgroundColor: 'hsl(215 20% 18%)', border: '1.5px solid hsl(215 20% 30%)' }
                    : isEnabled
                      ? { backgroundColor: color, boxShadow: `0 0 6px ${getModuleColorAlpha(mod, 0.25)}` }
                      : { backgroundColor: 'transparent', border: '1.5px solid hsl(215 20% 30%)' }
                }
                aria-label={`${MODULE_DISPLAY_NAMES[mod]} for ${role.display_name}: ${isSaving ? 'saving' : isEnabled ? 'enabled' : 'disabled'}`}
              >
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 text-slate-400 animate-spin" />
                ) : isEnabled ? (
                  <Check className="h-3.5 w-3.5 text-white" />
                ) : (
                  <Minus className="h-3 w-3 text-slate-600" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {MODULE_DISPLAY_NAMES[mod]}: {isSaving ? 'Saving…' : isEnabled ? 'Enabled' : 'Disabled'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </td>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white">Job Roles & Permissions</CardTitle>
              <CardDescription className="text-muted-foreground">
                Toggle module access per role. Changes save instantly.
              </CardDescription>
            </div>
            <Button
              onClick={() => {
                resetForm();
                setAddDialogOpen(true);
              }}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Role
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {matrixRoles.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No roles configured yet.
            </div>
          ) : (
            <div className="border border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col style={{ width: 140 }} />
                  {STANDARD_MODULES.map((m) => (
                    <col key={m} style={{ width: 30 }} />
                  ))}
                  {MANAGEMENT_MODULES.map((m) => (
                    <col key={m} style={{ width: 30 }} />
                  ))}
                  <col style={{ width: 60 }} />
                </colgroup>
                <thead>
                  <tr className="bg-slate-800/60">
                    <th
                      rowSpan={2}
                      className="sticky left-0 z-10 bg-slate-800 px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider align-bottom border-b border-slate-700"
                    >
                      Role Name
                    </th>
                    <th
                      colSpan={STANDARD_MODULES.length}
                      className="px-1 py-1 text-center text-[10px] font-semibold text-slate-400 uppercase tracking-widest border-l border-slate-700/50"
                    >
                      Standard Modules
                    </th>
                    <th
                      colSpan={MANAGEMENT_MODULES.length}
                      className="px-1 py-1 text-center text-[10px] font-semibold text-slate-400 uppercase tracking-widest border-l border-slate-700/50"
                    >
                      Management
                    </th>
                    <th
                      rowSpan={2}
                      className="px-1 py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider border-l border-slate-700/50 align-bottom border-b border-slate-700"
                    >
                      Actions
                    </th>
                  </tr>
                  <tr className="border-b border-slate-700">
                    {renderModuleColumns(STANDARD_MODULES)}
                    {renderModuleColumns(MANAGEMENT_MODULES)}
                  </tr>
                </thead>
                <tbody>
                  {matrixRoles.map((role) => (
                    <tr
                      key={role.id}
                      className="border-b border-slate-700/50 hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="sticky left-0 z-10 bg-slate-900/95 px-3 py-1 font-medium text-white whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {role.is_super_admin && (
                            <Shield className="h-3.5 w-3.5 text-purple-500 flex-shrink-0" />
                          )}
                          <span className="text-sm truncate">{role.display_name}</span>
                          {role.is_super_admin && (
                            <Badge variant="outline" className="text-purple-500 border-purple-500 text-[9px] px-1 py-0 flex-shrink-0">
                              Super Admin
                            </Badge>
                          )}
                          {role.is_manager_admin && !role.is_super_admin && (
                            <Badge variant="outline" className="text-amber-500 border-amber-500 text-[9px] px-1 py-0 flex-shrink-0">
                              Admin
                            </Badge>
                          )}
                        </div>
                      </td>

                      {STANDARD_MODULES.map((mod) => renderPermissionCell(role, mod))}
                      {MANAGEMENT_MODULES.map((mod) => renderPermissionCell(role, mod))}

                      <td className="px-1 py-0.5 text-center border-l border-slate-700/50">
                        <div className="flex gap-0.5 justify-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(role)}
                            disabled={role.is_super_admin}
                            className="text-blue-400 hover:text-blue-300 hover:bg-slate-800 disabled:opacity-30 h-7 w-7 p-0"
                            title={role.is_super_admin ? 'Cannot edit super admin' : 'Edit Role'}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDeleteDialog(role)}
                            disabled={role.is_super_admin || role.is_manager_admin || role.user_count > 0}
                            className="text-red-400 hover:text-red-300 hover:bg-slate-800 disabled:opacity-30 h-7 w-7 p-0"
                            title={
                              role.is_super_admin || role.is_manager_admin
                                ? 'Cannot delete admin roles'
                                : role.user_count > 0
                                ? 'Cannot delete role with assigned users'
                                : 'Delete Role'
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Role Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="border-border text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Role</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Create a new job role with default permissions
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="add-name">Role Name (Internal) *</Label>
              <Input
                id="add-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="employee-new-department"
                className="bg-input border-border text-white placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">Lowercase, hyphenated (e.g., employee-civils)</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-display-name">Display Name *</Label>
              <Input
                id="add-display-name"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                placeholder="Employee - New Department"
                className="bg-input border-border text-white placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-description">Description</Label>
              <Textarea
                id="add-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of this role..."
                className="bg-input border-border text-white placeholder:text-muted-foreground min-h-[80px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-timesheet-type" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Timesheet Type
              </Label>
              <Select
                value={formData.timesheet_type}
                onValueChange={(value) => setFormData({ ...formData, timesheet_type: value })}
              >
                <SelectTrigger id="add-timesheet-type" className="bg-input border-border text-white">
                  <SelectValue placeholder="Select timesheet type" />
                </SelectTrigger>
                <SelectContent>
                  {TimesheetTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Which timesheet format should employees with this role use?
              </p>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-800 rounded">
              <div>
                <Label htmlFor="add-is-manager">Manager/Admin Role</Label>
                <p className="text-xs text-muted-foreground">Full access to all modules</p>
              </div>
              <Switch
                id="add-is-manager"
                checked={formData.is_manager_admin}
                onCheckedChange={(checked) => setFormData({ ...formData, is_manager_admin: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddDialogOpen(false); resetForm(); }} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button onClick={handleAddRole} disabled={formLoading} className="bg-blue-600 hover:bg-blue-700">
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Role
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="border-border text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Role</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Update role details
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit-display-name">Display Name *</Label>
              <Input
                id="edit-display-name"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                className="bg-input border-border text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="bg-input border-border text-white placeholder:text-muted-foreground min-h-[80px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-timesheet-type" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Timesheet Type
              </Label>
              <Select
                value={formData.timesheet_type}
                onValueChange={(value) => setFormData({ ...formData, timesheet_type: value })}
              >
                <SelectTrigger id="edit-timesheet-type" className="bg-input border-border text-white">
                  <SelectValue placeholder="Select timesheet type" />
                </SelectTrigger>
                <SelectContent>
                  {TimesheetTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Which timesheet format should employees with this role use?
              </p>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-800 rounded">
              <div>
                <Label htmlFor="edit-is-manager">Manager/Admin Role</Label>
                <p className="text-xs text-muted-foreground">Full access to all modules</p>
              </div>
              <Switch
                id="edit-is-manager"
                checked={formData.is_manager_admin}
                onCheckedChange={(checked) => setFormData({ ...formData, is_manager_admin: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditDialogOpen(false); setSelectedRole(null); resetForm(); }} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button onClick={handleEditRole} disabled={formLoading} className="bg-blue-600 hover:bg-blue-700">
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Role Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="border-border text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete Role
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete this role? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {selectedRole && (
            <div className="bg-slate-800 rounded p-4 space-y-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Role:</span>{' '}
                <span className="text-white font-medium">{selectedRole.display_name}</span>
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Users:</span>{' '}
                <span className="text-white">{selectedRole.user_count}</span>
              </p>
            </div>
          )}
          {formError && (
            <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
              {formError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteDialogOpen(false); setSelectedRole(null); }} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button
              onClick={handleDeleteRole}
              disabled={formLoading}
              className="bg-red-600 hover:bg-red-700"
            >
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Role
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
