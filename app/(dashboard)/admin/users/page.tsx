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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  UserPlus,
  Search,
  Edit,
  Trash2,
  Shield,
  User,
  Mail,
  Calendar,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
import type { Database } from '@/types/database';

type Profile = Database['public']['Tables']['profiles']['Row'];
type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];

export default function UsersAdminPage() {
  const { user, isAdmin } = useAuth();
  const supabase = createClient();

  // State
  const [users, setUsers] = useState<Profile[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    full_name: '',
    employee_id: '',
    role: 'employee' as 'admin' | 'manager' | 'employee',
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Stats
  const stats = {
    total: users.length,
    admins: users.filter((u) => u.role === 'admin').length,
    managers: users.filter((u) => u.role === 'manager').length,
    employees: users.filter((u) => u.role === 'employee').length,
  };

  // Fetch users
  useEffect(function () {
    async function fetchUsers() {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;
        setUsers(data || []);
        setFilteredUsers(data || []);
      } catch (error) {
        console.error('Error fetching users:', error);
      } finally {
        setLoading(false);
      }
    }

    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin, supabase]);

  // Search filter
  useEffect(function () {
    if (!searchQuery.trim()) {
      setFilteredUsers(users);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = users.filter((user) =>
      user.full_name?.toLowerCase().includes(query) ||
      user.email?.toLowerCase().includes(query) ||
      user.employee_id?.toLowerCase().includes(query)
    );
    setFilteredUsers(filtered);
  }, [searchQuery, users]);

  // Handle add user
  async function handleAddUser() {
    if (!formData.email || !formData.password || !formData.full_name) {
      setFormError('Please fill in all required fields');
      return;
    }

    try {
      setFormLoading(true);
      setFormError('');

      // Create user via API route
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          full_name: formData.full_name,
          employee_id: formData.employee_id,
          role: formData.role,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create user');
      }

      // Refresh users list
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
      
      setUsers(data || []);
      setFilteredUsers(data || []);

      // Reset form and close dialog
      setFormData({
        email: '',
        password: '',
        full_name: '',
        employee_id: '',
        role: 'employee',
      });
      setAddDialogOpen(false);
    } catch (error) {
      console.error('Error creating user:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to create user');
    } finally {
      setFormLoading(false);
    }
  }

  // Handle edit user
  async function handleEditUser() {
    if (!selectedUser || !formData.full_name) {
      setFormError('Please fill in all required fields');
      return;
    }

    try {
      setFormLoading(true);
      setFormError('');

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.full_name,
          employee_id: formData.employee_id,
          role: formData.role,
        })
        .eq('id', selectedUser.id);

      if (error) throw error;

      // Refresh users list
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
      
      setUsers(data || []);
      setFilteredUsers(data || []);

      setEditDialogOpen(false);
      setSelectedUser(null);
    } catch (error) {
      console.error('Error updating user:', error);
      setFormError('Failed to update user');
    } finally {
      setFormLoading(false);
    }
  }

  // Handle delete user
  async function handleDeleteUser() {
    if (!selectedUser) return;

    try {
      setFormLoading(true);
      setFormError('');

      // Delete via API route (handles auth user deletion)
      const response = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to delete user');
      }

      // Refresh users list
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
      
      setUsers(data || []);
      setFilteredUsers(data || []);

      setDeleteDialogOpen(false);
      setSelectedUser(null);
    } catch (error) {
      console.error('Error deleting user:', error);
      setFormError('Failed to delete user');
    } finally {
      setFormLoading(false);
    }
  }

  // Open edit dialog
  function openEditDialog(user: Profile) {
    setSelectedUser(user);
    setFormData({
      email: user.email || '',
      password: '',
      full_name: user.full_name || '',
      employee_id: user.employee_id || '',
      role: user.role as 'admin' | 'manager' | 'employee',
    });
    setFormError('');
    setEditDialogOpen(true);
  }

  // Open delete dialog
  function openDeleteDialog(user: Profile) {
    setSelectedUser(user);
    setFormError('');
    setDeleteDialogOpen(true);
  }

  // Check authorization
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Access Denied
            </CardTitle>
            <CardDescription>
              You do not have permission to access user management.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">User Management</h1>
          <p className="text-slate-400">
            Manage users, roles, and permissions
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-900/50 border-slate-700">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Total Users</p>
                <p className="text-2xl font-bold text-white">{stats.total}</p>
              </div>
              <User className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900/50 border-slate-700">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Admins</p>
                <p className="text-2xl font-bold text-white">{stats.admins}</p>
              </div>
              <Shield className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900/50 border-slate-700">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Managers</p>
                <p className="text-2xl font-bold text-white">{stats.managers}</p>
              </div>
              <Shield className="h-8 w-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900/50 border-slate-700">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Employees</p>
                <p className="text-2xl font-bold text-white">{stats.employees}</p>
              </div>
              <User className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User Management Interface */}
      <Card className="bg-slate-900/50 border-slate-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white">All Users</CardTitle>
              <CardDescription className="text-slate-400">
                View and manage user accounts, roles, and permissions
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setFormData({
                    email: '',
                    password: '',
                    full_name: '',
                    employee_id: '',
                    role: 'employee',
                  });
                  setFormError('');
                  setAddDialogOpen(true);
                }}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Add User
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search by name, email, or employee ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-slate-900/50 border-slate-600 text-white"
                />
              </div>
            </div>

            {/* User Table */}
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                {searchQuery ? 'No users found matching your search.' : 'No users yet.'}
              </div>
            ) : (
              <div className="border border-slate-700 rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700 hover:bg-slate-800/50">
                      <TableHead className="text-slate-300">Name</TableHead>
                      <TableHead className="text-slate-300">Email</TableHead>
                      <TableHead className="text-slate-300">Employee ID</TableHead>
                      <TableHead className="text-slate-300">Role</TableHead>
                      <TableHead className="text-slate-300">Created</TableHead>
                      <TableHead className="text-right text-slate-300">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => (
                      <TableRow key={user.id} className="border-slate-700 hover:bg-slate-800/50">
                        <TableCell className="font-medium text-white">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-slate-700 flex items-center justify-center">
                              <User className="h-4 w-4 text-slate-300" />
                            </div>
                            {user.full_name || 'Unnamed User'}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-300">
                          <div className="flex items-center gap-2 text-sm">
                            <Mail className="h-3 w-3 text-slate-400" />
                            {user.email}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-300">{user.employee_id || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={
                            user.role === 'admin' ? 'destructive' :
                            user.role === 'manager' ? 'default' : 'secondary'
                          }>
                            {user.role}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-300">
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-3 w-3 text-slate-400" />
                            {new Date(user.created_at || '').toLocaleDateString()}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(user)}
                              className="text-blue-400 hover:text-blue-300 hover:bg-slate-800"
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openDeleteDialog(user)}
                              disabled={user.id === user.id} // Prevent self-deletion
                              className="text-red-400 hover:text-red-300 hover:bg-slate-800 disabled:opacity-30"
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
          </div>
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription className="text-slate-400">
              Create a new user account with email and password
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="add-email">Email *</Label>
              <Input
                id="add-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="user@example.com"
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-password">Password *</Label>
              <Input
                id="add-password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Minimum 6 characters"
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-name">Full Name *</Label>
              <Input
                id="add-name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                placeholder="John Smith"
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-employee-id">Employee ID</Label>
              <Input
                id="add-employee-id"
                value={formData.employee_id}
                onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                placeholder="E001"
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-role">Role *</Label>
              <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value as 'admin' | 'manager' | 'employee' })}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button onClick={handleAddUser} disabled={formLoading} className="bg-blue-600 hover:bg-blue-700">
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Create User
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription className="text-slate-400">
              Update user information and role
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && (
              <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                value={formData.email}
                disabled
                className="bg-slate-800 border-slate-600 text-slate-400"
              />
              <p className="text-xs text-slate-500">Email cannot be changed</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name">Full Name *</Label>
              <Input
                id="edit-name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-employee-id">Employee ID</Label>
              <Input
                id="edit-employee-id"
                value={formData.employee_id}
                onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Role *</Label>
              <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value as 'admin' | 'manager' | 'employee' })}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button onClick={handleEditUser} disabled={formLoading} className="bg-blue-600 hover:bg-blue-700">
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

      {/* Delete User Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete User
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete this user? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="bg-slate-800 rounded p-4 space-y-2">
              <p className="text-sm">
                <span className="text-slate-400">Name:</span>{' '}
                <span className="text-white font-medium">{selectedUser.full_name}</span>
              </p>
              <p className="text-sm">
                <span className="text-slate-400">Email:</span>{' '}
                <span className="text-white">{selectedUser.email}</span>
              </p>
              <p className="text-sm">
                <span className="text-slate-400">Role:</span>{' '}
                <Badge variant={selectedUser.role === 'admin' ? 'destructive' : 'default'}>
                  {selectedUser.role}
                </Badge>
              </p>
            </div>
          )}
          {formError && (
            <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
              {formError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button
              onClick={handleDeleteUser}
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
                  Delete User
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
