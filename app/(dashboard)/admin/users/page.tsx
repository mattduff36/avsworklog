'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  KeyRound,
  Copy,
  CheckCircle2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
import type { Database } from '@/types/database';
import { RoleManagement } from '@/components/admin/RoleManagement';

type Profile = Database['public']['Tables']['profiles']['Row'];
type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
type ProfileWithEmail = Profile & { email?: string };

type TabType = 'users' | 'roles';

export default function UsersAdminPage() {
  const { user: currentUser, isAdmin } = useAuth();
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<TabType>('users');

  // State
  const [users, setUsers] = useState<ProfileWithEmail[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<ProfileWithEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'manager' | 'employee'>('all');
  const [availableRoles, setAvailableRoles] = useState<Array<{ id: string; name: string; display_name: string }>>([]);

  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [passwordDisplayDialogOpen, setPasswordDisplayDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  
  // Password display states
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);

  // Form states
  const [formData, setFormData] = useState({
    email: '',
    full_name: '',
    phone_number: '',
    employee_id: '',
    role_id: '',
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Stats
  const stats = {
    total: users.length,
    admins: users.filter((u) => u.role?.name === 'admin').length,
    managers: users.filter((u) => u.role?.name === 'manager').length,
    employees: users.filter((u) => u.role?.name?.startsWith('employee-')).length,
  };

  // Helper function to fetch users with emails
  async function fetchUsersWithEmails() {
    // Fetch profiles from database with role information
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select(`
        *,
        role:roles(
          name,
          display_name
        )
      `)
      .order('full_name', { ascending: true });

    if (profilesError) throw profilesError;

    // Fetch auth users to get emails (via API route)
    const response = await fetch('/api/admin/users/list-with-emails');
    const { users: authUsers } = await response.json();

    // Create a map of user id to email
    const emailMap = new Map(authUsers?.map((u: any) => [u.id, u.email]) || []);

    // Merge profiles with emails
    return profiles?.map(profile => ({
      ...profile,
      email: emailMap.get(profile.id) || ''
    })) || [];
  }

  // Fetch available roles
  useEffect(function () {
    async function fetchRoles() {
      try {
        const { data, error } = await supabase
          .from('roles')
          .select('id, name, display_name')
          .order('is_super_admin', { ascending: false })
          .order('is_manager_admin', { ascending: false })
          .order('display_name');
        
        if (error) throw error;
        setAvailableRoles(data || []);
      } catch (error) {
        console.error('Error fetching roles:', error);
      }
    }

    if (isAdmin) {
      fetchRoles();
    }
  }, [isAdmin, supabase]);

  // Fetch users
  useEffect(function () {
    async function fetchUsers() {
      try {
        setLoading(true);
        const usersWithEmails = await fetchUsersWithEmails();
        setUsers(usersWithEmails);
        setFilteredUsers(usersWithEmails);
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

  // Search and role filter
  useEffect(function () {
    let filtered = users;

    // Apply role filter
    if (roleFilter !== 'all') {
      filtered = filtered.filter((user) => {
        if (roleFilter === 'admin') return user.role?.name === 'admin';
        if (roleFilter === 'manager') return user.role?.name === 'manager';
        if (roleFilter === 'employee') return user.role?.name?.startsWith('employee-');
        return true;
      });
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((user) =>
        user.full_name?.toLowerCase().includes(query) ||
        user.email?.toLowerCase().includes(query) ||
        user.employee_id?.toLowerCase().includes(query)
      );
    }

    setFilteredUsers(filtered);
  }, [searchQuery, roleFilter, users]);

  // Handle add user
  async function handleAddUser() {
    if (!formData.email || !formData.full_name) {
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
          full_name: formData.full_name,
          phone_number: formData.phone_number,
          employee_id: formData.employee_id,
          role_id: formData.role_id,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create user');
      }

      // Refresh users list
      const usersWithEmails = await fetchUsersWithEmails();
      setUsers(usersWithEmails);
      setFilteredUsers(usersWithEmails);

      // Show password to admin
      setTemporaryPassword(result.temporaryPassword);
      setEmailSent(result.emailSent);
      setIsNewUser(true);
      setPasswordCopied(false);
      setPasswordDisplayDialogOpen(true);

      // Reset form and close dialog
      setFormData({
        email: '',
        full_name: '',
        phone_number: '',
        employee_id: '',
        role_id: '',
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
    if (!selectedUser || !formData.full_name || !formData.email) {
      setFormError('Please fill in all required fields');
      return;
    }

    try {
      setFormLoading(true);
      setFormError('');

      // Update via API route (handles both auth and profile)
      const response = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          full_name: formData.full_name,
          phone_number: formData.phone_number,
          employee_id: formData.employee_id,
          role_id: formData.role_id,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update user');
      }

      // Refresh users list
      const usersWithEmails = await fetchUsersWithEmails();
      setUsers(usersWithEmails);
      setFilteredUsers(usersWithEmails);

      setEditDialogOpen(false);
      setSelectedUser(null);
    } catch (error) {
      console.error('Error updating user:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to update user');
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
        let errorMessage = 'Failed to delete user';
        try {
          const result = await response.json();
          errorMessage = result.error || errorMessage;
        } catch (jsonError) {
          // If JSON parsing fails, use the response status text
          errorMessage = `Failed to delete user: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      // Refresh users list
      const usersWithEmails = await fetchUsersWithEmails();
      setUsers(usersWithEmails);
      setFilteredUsers(usersWithEmails);

      setDeleteDialogOpen(false);
      setSelectedUser(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete user';
      console.error('Error deleting user:', errorMessage, error);
      setFormError(errorMessage);
    } finally {
      setFormLoading(false);
    }
  }

  // Open edit dialog
  function openEditDialog(user: Profile) {
    setSelectedUser(user);
    setFormData({
      email: user.email || '',
      full_name: user.full_name || '',
      phone_number: user.phone_number || '',
      employee_id: user.employee_id || '',
      role_id: user.role_id || '',
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

  // Open reset password dialog
  function openResetPasswordDialog(user: Profile) {
    setSelectedUser(user);
    setFormError('');
    setResetPasswordDialogOpen(true);
  }

  // Handle reset password
  async function handleResetPassword() {
    if (!selectedUser) return;

    try {
      setFormLoading(true);
      setFormError('');

      const response = await fetch(`/api/admin/users/${selectedUser.id}/reset-password`, {
        method: 'POST',
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to reset password');
      }

      // Show new password to admin
      setTemporaryPassword(result.temporaryPassword);
      setEmailSent(result.emailSent);
      setIsNewUser(false);
      setPasswordCopied(false);
      setPasswordDisplayDialogOpen(true);
      setResetPasswordDialogOpen(false);
      setSelectedUser(null);
    } catch (error) {
      console.error('Error resetting password:', error);
      setFormError('Failed to reset password');
    } finally {
      setFormLoading(false);
    }
  }

  // Copy password to clipboard
  async function copyPasswordToClipboard() {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setPasswordCopied(true);
      setTimeout(() => setPasswordCopied(false), 3000);
    } catch (error) {
      console.error('Failed to copy password:', error);
    }
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
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-lg p-6 border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">User Management</h1>
            <p className="text-slate-600 dark:text-slate-400">
              Manage users, roles, and permissions
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2 bg-slate-100 dark:bg-slate-800 p-1">
          <TabsTrigger 
            value="users" 
            className="gap-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
          >
            <User className="h-4 w-4" />
            Users
          </TabsTrigger>
          <TabsTrigger 
            value="roles" 
            className="gap-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
          >
            <Shield className="h-4 w-4" />
            Roles
          </TabsTrigger>
        </TabsList>

        {/* Users Tab Content */}
        <TabsContent value="users" className="space-y-6">
          {/* Stats Cards - Now Filter Buttons */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card 
          className={`bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 cursor-pointer hover:shadow-lg transition-all ${
            roleFilter === 'all' ? 'border-2 border-yellow-500' : ''
          }`}
          onClick={() => setRoleFilter('all')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">All Users</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</p>
              </div>
              <User className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card 
          className={`bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 cursor-pointer hover:shadow-lg transition-all ${
            roleFilter === 'admin' ? 'border-2 border-yellow-500' : ''
          }`}
          onClick={() => setRoleFilter('admin')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Admins</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.admins}</p>
              </div>
              <Shield className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
        <Card 
          className={`bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 cursor-pointer hover:shadow-lg transition-all ${
            roleFilter === 'manager' ? 'border-2 border-yellow-500' : ''
          }`}
          onClick={() => setRoleFilter('manager')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Managers</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.managers}</p>
              </div>
              <Shield className="h-8 w-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card 
          className={`bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 cursor-pointer hover:shadow-lg transition-all ${
            roleFilter === 'employee' ? 'border-2 border-yellow-500' : ''
          }`}
          onClick={() => setRoleFilter('employee')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">Employees</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.employees}</p>
              </div>
              <User className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User Management Interface */}
      <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-slate-900 dark:text-white">All Users</CardTitle>
              <CardDescription className="text-slate-600 dark:text-slate-400">
                View and manage user accounts, roles, and permissions
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setFormData({
                    email: '',
                    full_name: '',
                    phone_number: '',
                    employee_id: '',
                    role_id: '',
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
              <div className="text-center py-8 text-slate-600 dark:text-slate-400">
                {searchQuery ? 'No users found matching your search.' : 'No users yet.'}
              </div>
            ) : (
              <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/50">
                      <TableHead className="text-slate-700 dark:text-slate-300">Name</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Email</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Employee ID</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Role</TableHead>
                      <TableHead className="text-slate-700 dark:text-slate-300">Created</TableHead>
                      <TableHead className="text-right text-slate-700 dark:text-slate-300">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user) => (
                      <TableRow key={user.id} className="border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <TableCell className="font-medium text-slate-900 dark:text-white">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                              <User className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                            </div>
                            {user.full_name || 'Unnamed User'}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">
                          <div className="flex items-center gap-2 text-sm">
                            <Mail className="h-3 w-3 text-slate-400" />
                            {user.email}
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">{user.employee_id || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={
                            user.email === 'admin@mpdee.co.uk' ? 'destructive' :
                            user.role?.name === 'admin' ? 'destructive' :
                            user.role?.name === 'manager' ? 'warning' : 'secondary'
                          }>
                            {user.email === 'admin@mpdee.co.uk' ? 'SuperAdmin' : (user.role?.display_name || 'No Role')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">
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
                              title="Edit User"
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openResetPasswordDialog(user)}
                              className="text-amber-400 hover:text-amber-300 hover:bg-slate-800"
                              title="Reset Password"
                            >
                              <KeyRound className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openDeleteDialog(user)}
                              disabled={user.id === currentUser?.id} // Prevent self-deletion
                              className="text-red-400 hover:text-red-300 hover:bg-slate-800 disabled:opacity-30"
                              title="Delete User"
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
            <div className="bg-blue-500/10 border border-blue-500/50 rounded p-3 text-sm text-blue-400">
              <strong>Note:</strong> A secure temporary password will be automatically generated and sent to the user's email address.
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-email">Email *</Label>
              <Input
                id="add-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="user@example.com"
                className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-name">Full Name *</Label>
              <Input
                id="add-name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                placeholder="John Smith"
                className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-phone">Phone Number</Label>
              <Input
                id="add-phone"
                type="tel"
                value={formData.phone_number}
                onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                placeholder="07123 456789"
                className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-employee-id">Employee ID</Label>
              <Input
                id="add-employee-id"
                value={formData.employee_id}
                onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                placeholder="E001"
                className="bg-slate-800 border-slate-600 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-role">Role *</Label>
              <Select value={formData.role_id} onValueChange={(value) => setFormData({ ...formData, role_id: value })}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {availableRoles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.display_name}
                    </SelectItem>
                  ))}
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
              <Label htmlFor="edit-email">Email *</Label>
              <Input
                id="edit-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="bg-slate-800 border-slate-600 text-white"
              />
              <p className="text-xs text-amber-500">⚠️ Changing email will require the user to verify their new address</p>
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
              <Label htmlFor="edit-phone">Phone Number</Label>
              <Input
                id="edit-phone"
                type="tel"
                value={formData.phone_number}
                onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
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
              <Select value={formData.role_id} onValueChange={(value) => setFormData({ ...formData, role_id: value })}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {availableRoles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.display_name}
                    </SelectItem>
                  ))}
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
                <Badge variant={
                  selectedUser.email === 'admin@mpdee.co.uk' ? 'destructive' :
                  selectedUser.role?.name === 'admin' ? 'destructive' : 'default'
                }>
                  {selectedUser.email === 'admin@mpdee.co.uk' ? 'SuperAdmin' : (selectedUser.role?.display_name || 'No Role')}
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

      {/* Reset Password Confirmation Dialog */}
      <Dialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-500" />
              Reset User Password
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              This will generate a new temporary password for the user. They will be required to change it on their next login.
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
            </div>
          )}
          {formError && (
            <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
              {formError}
            </div>
          )}
          <div className="bg-amber-500/10 border border-amber-500/50 rounded p-3 text-sm text-amber-400">
            <strong>Note:</strong> The new password will be sent to the user's email address and displayed to you.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetPasswordDialogOpen(false); setSelectedUser(null); }} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button
              onClick={handleResetPassword}
              disabled={formLoading}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4 mr-2" />
                  Reset Password
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Display Dialog */}
      <Dialog open={passwordDisplayDialogOpen} onOpenChange={setPasswordDisplayDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              {isNewUser ? 'User Created Successfully' : 'Password Reset Successfully'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {isNewUser 
                ? 'The user account has been created with a temporary password.'
                : 'The user\'s password has been reset to a new temporary password.'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Email Status */}
            {emailSent ? (
              <div className="bg-green-500/10 border border-green-500/50 rounded p-3 text-sm text-green-400">
                ✅ Email sent successfully to the user
              </div>
            ) : (
              <div className="bg-amber-500/10 border border-amber-500/50 rounded p-3 text-sm text-amber-400">
                ⚠️ Email failed to send - Please share the password with the user manually
              </div>
            )}

            {/* Password Display */}
            <div className="bg-slate-800 border-2 border-[#F1D64A] rounded-lg p-4">
              <Label className="text-sm text-slate-400 mb-2 block">Temporary Password</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-slate-950 rounded p-3 font-mono text-lg text-[#F1D64A] select-all">
                  {temporaryPassword}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyPasswordToClipboard}
                  className="border-slate-600 hover:bg-slate-800"
                >
                  {passwordCopied ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-1 text-green-500" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Important Notice */}
            <div className="bg-blue-500/10 border border-blue-500/50 rounded p-4">
              <p className="text-sm text-blue-400 font-medium mb-2">
                📋 Important Information
              </p>
              <ul className="text-sm text-blue-400 space-y-1 list-disc list-inside">
                <li>This password will only be shown once</li>
                <li>The user must change this password on their first login</li>
                <li>Password has been {emailSent ? 'emailed' : 'generated but not emailed'}</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button 
              onClick={() => {
                setPasswordDisplayDialogOpen(false);
                setTemporaryPassword('');
                setPasswordCopied(false);
              }}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </TabsContent>

        {/* Roles Tab Content */}
        <TabsContent value="roles">
          <RoleManagement />
        </TabsContent>
      </Tabs>
    </div>
  );
}
