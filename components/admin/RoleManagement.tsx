'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
import { Shield, Plus, Edit, Trash2, Loader2, AlertTriangle, Users, Lock, FileText } from 'lucide-react';
import type { RoleWithUserCount, ModuleName } from '@/types/roles';
import { ALL_MODULES, MODULE_DESCRIPTIONS, MODULE_DISPLAY_NAMES } from '@/types/roles';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TimesheetTypeOptions } from '@/app/(dashboard)/timesheets/types/registry';

export function RoleManagement() {
  const [roles, setRoles] = useState<RoleWithUserCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<RoleWithUserCount | null>(null);
  
  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    display_name: '',
    description: '',
    is_manager_admin: false,
    timesheet_type: 'civils' as string,
  });
  const [permissions, setPermissions] = useState<Record<ModuleName, boolean>>({} as Record<ModuleName, boolean>);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Fetch roles
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
      
      setRoles(data.roles);
    } catch (error) {
      console.error('Error fetching roles:', error);
      toast.error('Failed to load roles');
    } finally {
      setLoading(false);
    }
  }

  // Handle add role
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

  // Handle edit role
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

  // Handle delete role
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

  // Handle update permissions
  async function handleUpdatePermissions() {
    if (!selectedRole) return;

    try {
      setFormLoading(true);
      setFormError('');

      const permissionsArray = Object.entries(permissions).map(([module_name, enabled]) => ({
        module_name: module_name as ModuleName,
        enabled,
      }));

      const response = await fetch(`/api/admin/roles/${selectedRole.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: permissionsArray }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update permissions');
      }

      toast.success('Permissions updated successfully');
      fetchRoles();
      setPermissionsDialogOpen(false);
      setSelectedRole(null);
    } catch (error) {
      console.error('Error updating permissions:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to update permissions');
    } finally {
      setFormLoading(false);
    }
  }

  // Open permissions dialog
  async function openPermissionsDialog(role: RoleWithUserCount) {
    try {
      setFormError('');
      setFormLoading(true);

      // Fetch full role details with permissions
      const response = await fetch(`/api/admin/roles/${role.id}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch role details');
      }

      setSelectedRole(data.role);

      // Convert permissions array to object
      const permsObj: Record<ModuleName, boolean> = {} as Record<ModuleName, boolean>;
      ALL_MODULES.forEach(module => {
        const perm = data.role.permissions.find((p: any) => p.module_name === module);
        permsObj[module] = perm?.enabled || false;
      });
      setPermissions(permsObj);

      setPermissionsDialogOpen(true);
    } catch (error) {
      console.error('Error fetching role details:', error);
      toast.error('Failed to load permissions');
    } finally {
      setFormLoading(false);
    }
  }

  function openEditDialog(role: RoleWithUserCount) {
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

  function openDeleteDialog(role: RoleWithUserCount) {
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white">Job Roles & Permissions</CardTitle>
              <CardDescription className="text-slate-400">
                Manage job roles and configure module access permissions
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
          {roles.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              No roles configured yet.
            </div>
          ) : (
            <div className="border border-slate-700 rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700 hover:bg-slate-800/50">
                    <TableHead className="text-slate-300">Role Name</TableHead>
                    <TableHead className="text-slate-300">Description</TableHead>
                    <TableHead className="text-slate-300">Type</TableHead>
                    <TableHead className="text-slate-300">Users</TableHead>
                    <TableHead className="text-slate-300">Modules</TableHead>
                    <TableHead className="text-right text-slate-300">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.map((role) => (
                    <TableRow key={role.id} className="border-slate-700 hover:bg-slate-800/50">
                      <TableCell className="font-medium text-white">
                        <div className="flex items-center gap-2">
                          {role.is_super_admin && <Shield className="h-4 w-4 text-purple-500" />}
                          {role.display_name}
                          {role.is_super_admin && (
                            <Badge variant="outline" className="text-purple-500 border-purple-500">
                              Super Admin
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-300 max-w-xs truncate">
                        {role.description || '-'}
                      </TableCell>
                      <TableCell>
                        {role.is_manager_admin ? (
                          <Badge variant="default" className="bg-amber-500">
                            Manager/Admin
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Employee</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-300">
                        <div className="flex items-center gap-1">
                          <Users className="h-3 w-3 text-slate-400" />
                          {role.user_count}
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-300">
                        {role.is_super_admin || role.is_manager_admin ? (
                          <Badge variant="outline" className="text-green-500 border-green-500">
                            All Access
                          </Badge>
                        ) : (
                          <span className="text-sm">{role.permission_count}/{ALL_MODULES.length} enabled</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openPermissionsDialog(role)}
                            disabled={role.is_super_admin || role.is_manager_admin}
                            className="text-green-400 hover:text-green-300 hover:bg-slate-800 disabled:opacity-30"
                            title={role.is_super_admin || role.is_manager_admin ? 'Cannot modify admin permissions' : 'Manage Permissions'}
                          >
                            <Lock className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(role)}
                            disabled={role.is_super_admin}
                            className="text-blue-400 hover:text-blue-300 hover:bg-slate-800 disabled:opacity-30"
                            title={role.is_super_admin ? 'Cannot edit super admin' : 'Edit Role'}
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDeleteDialog(role)}
                            disabled={role.is_super_admin || role.is_manager_admin || role.user_count > 0}
                            className="text-red-400 hover:text-red-300 hover:bg-slate-800 disabled:opacity-30"
                            title={
                              role.is_super_admin || role.is_manager_admin
                                ? 'Cannot delete admin roles'
                                : role.user_count > 0
                                ? 'Cannot delete role with assigned users'
                                : 'Delete Role'
                            }
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Role Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Role</DialogTitle>
            <DialogDescription className="text-slate-400">
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
                className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500"
              />
              <p className="text-xs text-slate-400">Lowercase, hyphenated (e.g., employee-civils)</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-display-name">Display Name *</Label>
              <Input
                id="add-display-name"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                placeholder="Employee - New Department"
                className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-description">Description</Label>
              <Textarea
                id="add-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of this role..."
                className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 min-h-[80px]"
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
                <SelectTrigger id="add-timesheet-type" className="bg-slate-800 border-slate-600 text-white">
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
              <p className="text-xs text-slate-400">
                Which timesheet format should employees with this role use?
              </p>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-800 rounded">
              <div>
                <Label htmlFor="add-is-manager">Manager/Admin Role</Label>
                <p className="text-xs text-slate-400">Full access to all modules</p>
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
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Role</DialogTitle>
            <DialogDescription className="text-slate-400">
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
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500 min-h-[80px]"
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
                <SelectTrigger id="edit-timesheet-type" className="bg-slate-800 border-slate-600 text-white">
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
              <p className="text-xs text-slate-400">
                Which timesheet format should employees with this role use?
              </p>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-800 rounded">
              <div>
                <Label htmlFor="edit-is-manager">Manager/Admin Role</Label>
                <p className="text-xs text-slate-400">Full access to all modules</p>
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
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete Role
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete this role? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {selectedRole && (
            <div className="bg-slate-800 rounded p-4 space-y-2">
              <p className="text-sm">
                <span className="text-slate-400">Role:</span>{' '}
                <span className="text-white font-medium">{selectedRole.display_name}</span>
              </p>
              <p className="text-sm">
                <span className="text-slate-400">Users:</span>{' '}
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
            <Button variant="outline" onClick={() => { setDeleteDialogOpen(false); setSelectedUser(null); }} className="border-slate-600 text-white hover:bg-slate-800">
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

      {/* Permissions Dialog */}
      <Dialog open={permissionsDialogOpen} onOpenChange={setPermissionsDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Permissions: {selectedRole?.display_name}</DialogTitle>
            <DialogDescription className="text-slate-400">
              Enable or disable access to modules for this role
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                {formError}
              </div>
            )}
            <div className="space-y-2">
              {ALL_MODULES.map((module) => (
                <div
                  key={module}
                  className="flex items-start justify-between p-3 bg-slate-800 rounded hover:bg-slate-750 transition-colors"
                >
                  <div className="flex-1">
                    <Label htmlFor={`perm-${module}`} className="font-medium">
                      {MODULE_DISPLAY_NAMES[module]}
                    </Label>
                    <p className="text-xs text-slate-400 mt-1">
                      {MODULE_DESCRIPTIONS[module]}
                    </p>
                  </div>
                  <Switch
                    id={`perm-${module}`}
                    checked={permissions[module] || false}
                    onCheckedChange={(checked) =>
                      setPermissions({ ...permissions, [module]: checked })
                    }
                    className="ml-4"
                  />
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPermissionsDialogOpen(false); setSelectedRole(null); }} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button onClick={handleUpdatePermissions} disabled={formLoading} className="bg-green-600 hover:bg-green-700">
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Permissions'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

