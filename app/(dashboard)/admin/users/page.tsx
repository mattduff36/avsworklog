'use client';

import { Fragment, useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
  Briefcase,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import type { Database } from '@/types/database';
import { getRoleSortPriority } from '@/lib/config/roles-core';

const RoleManagement = dynamic(() => import('@/components/admin/RoleManagement').then(m => ({ default: m.RoleManagement })), { 
  ssr: false,
  loading: () => <div className="flex items-center justify-center p-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
});

const JobRolesTab = dynamic(() => import('@/components/admin/JobRolesTab').then(m => ({ default: m.JobRolesTab })), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center p-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
});

const TeamsTab = dynamic(() => import('@/components/admin/TeamsTab').then(m => ({ default: m.TeamsTab })), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center p-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
});

type Profile = Database['public']['Tables']['profiles']['Row'];
type ProfileWithRole = Omit<Profile, 'role'> & {
  role?: {
    name: string;
    display_name: string;
    role_class?: 'admin' | 'manager' | 'employee';
    is_super_admin?: boolean;
    is_manager_admin?: boolean;
  } | null;
  role_id?: string | null;
  line_manager_id?: string | null;
  secondary_manager_id?: string | null;
  team_id?: string | null;
  is_placeholder?: boolean | null;
};
type ProfileWithEmail = ProfileWithRole & { email?: string };

type TabType = 'users' | 'roles' | 'teams' | 'permissions';
type UserStatusTab = 'active' | 'deleted';

function isDeletedUserProfile(user: { full_name?: string | null }): boolean {
  return Boolean(user.full_name?.includes('(Deleted User)'));
}

function isExpectedUserAdminError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes('Forbidden:');
}

export default function UsersAdminPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user: currentUser, profile, isAdmin, isSuperAdmin, isActualSuperAdmin, loading: authLoading } = useAuth();
  const { hasPermission: canManageUsers, loading: permissionLoading } = usePermissionCheck('admin-users', false);
  const supabase = createClient();
  const [activeTab, setActiveTab] = useState<TabType>('users');
  const isAdminActor = isAdmin || isSuperAdmin || isActualSuperAdmin;
  const isManagerActor = !isAdminActor && profile?.role?.is_manager_admin === true;
  const canManageRoleDefinitions = isAdminActor || isManagerActor;
  const canEditRolePermissions = isAdminActor;
  const canQuickEditAssignments = isAdminActor;

  // State
  const [users, setUsers] = useState<ProfileWithEmail[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<ProfileWithEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'manager' | 'employee'>('all');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [managerFilter, setManagerFilter] = useState<string>('all');
  const [userStatusTab, setUserStatusTab] = useState<UserStatusTab>('active');
  const [availableRoles, setAvailableRoles] = useState<Array<{ id: string; name: string; display_name: string; role_class: 'admin' | 'manager' | 'employee' }>>([]);
  const [teamDirectory, setTeamDirectory] = useState<Array<{
    id: string;
    name: string;
    active: boolean;
    manager_1_id?: string | null;
    manager_2_id?: string | null;
    manager_1_name?: string | null;
    manager_2_name?: string | null;
  }>>([]);

  useEffect(() => {
    const requestedTab = (searchParams.get('tab') || 'users') as TabType;
    const validTabs: TabType[] = ['users', 'roles', 'teams', 'permissions'];
    if (validTabs.includes(requestedTab)) {
      setActiveTab(requestedTab);
      return;
    }
    setActiveTab('users');
    router.replace('/admin/users?tab=users', { scroll: false });
  }, [searchParams, router]);

  function handleTabChange(nextTab: TabType) {
    setActiveTab(nextTab);
    router.replace(`/admin/users?tab=${nextTab}`, { scroll: false });
  }

  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteOptionsDialogOpen, setDeleteOptionsDialogOpen] = useState(false);
  const [deletionMode, setDeletionMode] = useState<'keep-data' | 'delete-all'>('keep-data');
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [passwordDisplayDialogOpen, setPasswordDisplayDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<ProfileWithEmail | null>(null);
  
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
    line_manager_id: '',
    team_id: '',
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [quickEditTarget, setQuickEditTarget] = useState<{
    userId: string;
    field: 'role' | 'team';
  } | null>(null);
  const [quickEditValue, setQuickEditValue] = useState('');
  const [quickEditSaving, setQuickEditSaving] = useState(false);

  const activeUsers = useMemo(
    () => users.filter((user) => !isDeletedUserProfile(user)),
    [users]
  );
  const deletedUsers = useMemo(
    () => users.filter((user) => isDeletedUserProfile(user)),
    [users]
  );
  const usersForCurrentStatus = useMemo(
    () => (userStatusTab === 'deleted' ? deletedUsers : activeUsers),
    [activeUsers, deletedUsers, userStatusTab]
  );

  // Stats
  const stats = {
    total: usersForCurrentStatus.length,
    admins: usersForCurrentStatus.filter((u) => u.role?.role_class === 'admin' || u.role?.name === 'admin').length,
    managers: usersForCurrentStatus.filter((u) => u.role?.role_class === 'manager').length,
    employees: usersForCurrentStatus.filter((u) => u.role?.role_class === 'employee').length,
  };

  const managerNameById = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((u) => {
      map.set(u.id, u.full_name || u.email || 'Unknown');
    });
    return map;
  }, [users]);

  const getDisplayedManager = useMemo(() => {
    return (managerId: string | null | undefined) => {
      if (!managerId) return 'No Manager';
      return managerNameById.get(managerId) || managerId;
    };
  }, [managerNameById]);

  const getDisplayedManagers = useMemo(() => {
    return (primaryManagerId: string | null | undefined, secondaryManagerId: string | null | undefined) => {
      const managers = [primaryManagerId, secondaryManagerId]
        .map((managerId) => getDisplayedManager(managerId))
        .filter((managerName) => managerName !== 'No Manager');

      return managers.join(', ');
    };
  }, [getDisplayedManager]);

  const getUserRolePriority = useMemo(() => {
    return (user: ProfileWithEmail) => {
      if (user.email === 'admin@mpdee.co.uk') {
        return getRoleSortPriority('admin');
      }

      return getRoleSortPriority(user.role?.name || user.role?.role_class || '');
    };
  }, []);

  const teamOptions = useMemo(() => {
    if (teamDirectory.length > 0) {
      return teamDirectory
        .filter((team) => team.active)
        .map((team) => ({ id: team.id, name: team.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    const teams = new Set<string>();
    users.forEach((u) => {
      if (u.team_id) teams.add(u.team_id);
    });
    return Array.from(teams).sort().map((id) => ({ id, name: id }));
  }, [teamDirectory, users]);

  const teamNameById = useMemo(() => {
    const map = new Map<string, string>();
    teamOptions.forEach((team) => map.set(team.id, team.name));
    return map;
  }, [teamOptions]);

  const teamDetailsById = useMemo(() => {
    const map = new Map<string, {
      id: string;
      name: string;
      active: boolean;
      manager_1_id?: string | null;
      manager_2_id?: string | null;
      manager_1_name?: string | null;
      manager_2_name?: string | null;
    }>();
    teamDirectory.forEach((team) => map.set(team.id, team));
    return map;
  }, [teamDirectory]);

  const managerOptions = useMemo(
    () => activeUsers.filter((u) => u.role?.role_class === 'manager' || u.role?.role_class === 'admin'),
    [activeUsers]
  );

  const getRoleOptionsForUser = useMemo(() => {
    return (_user: ProfileWithEmail) => {
      return availableRoles;
    };
  }, [availableRoles]);

  const selectedAddTeamManagers = useMemo(() => {
    return formData.team_id ? teamDetailsById.get(formData.team_id) || null : null;
  }, [formData.team_id, teamDetailsById]);

  // Helper function to fetch users with emails
  async function fetchUsersWithEmails() {
    // Fetch profiles from database with role information
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select(`
        *,
        role:roles(
          name,
          display_name,
          role_class,
          is_super_admin,
          is_manager_admin
        )
      `)
      .order('full_name', { ascending: true });

    if (profilesError) throw profilesError;

    // Fetch auth users to get emails (via API route)
    const response = await fetch('/api/admin/users/list-with-emails');
    const { users: authUsers } = await response.json();

    // Create a map of user id to email
    const emailMap = new Map(authUsers?.map((u: { id: string; email: string }) => [u.id, u.email]) || []);

    // Merge profiles with emails
    return (profiles as unknown as ProfileWithRole[])?.map(profile => ({
      ...profile,
      email: emailMap.get(profile.id) as string || ''
    })) || [] as ProfileWithEmail[];
  }

  // Fetch available roles
  useEffect(function () {
    async function fetchRoles() {
      try {
        const { data, error } = await supabase
          .from('roles')
          .select('id, name, display_name, role_class')
          .order('is_super_admin', { ascending: false })
          .order('is_manager_admin', { ascending: false })
          .order('display_name');
        
        if (error) throw error;

        const filteredRoles = isManagerActor
          ? (data || []).filter((role: { role_class: string }) => role.role_class === 'employee')
          : (data || []);

        const rolesForAssignment = filteredRoles
          .sort((a: { name: string; display_name: string }, b: { name: string; display_name: string }) => {
            const byPriority = getRoleSortPriority(a.name) - getRoleSortPriority(b.name);
            if (byPriority !== 0) return byPriority;
            return a.display_name.localeCompare(b.display_name);
          });

        setAvailableRoles(rolesForAssignment);
      } catch (error) {
        console.error('Error fetching roles:', error);
      }
    }

    if (canManageUsers) {
      fetchRoles();
    }
  }, [canManageUsers, isManagerActor, supabase]);

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

    if (canManageUsers) {
      fetchUsers();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageUsers]);

  // Fetch team metadata used by the Org V2 admin UI
  useEffect(function () {
    async function fetchHierarchyMetadata() {
      try {
        const teamsRes = await fetch('/api/admin/hierarchy/teams');
        if (teamsRes.ok) {
          const teamsData = await teamsRes.json();
          if (Array.isArray(teamsData?.teams)) {
            const mapped = teamsData.teams
              .filter((team: { id?: string; team_id?: string }) => Boolean(team?.id || team?.team_id))
              .map((team: { id?: string; team_id?: string; name?: string; active?: boolean }) => {
                const teamId = team.id || team.team_id || '';
                return {
                  id: teamId,
                  name: team.name || teamId,
                  active: team.active !== false,
                  manager_1_id: (team as { manager_1_id?: string | null }).manager_1_id || null,
                  manager_2_id: (team as { manager_2_id?: string | null }).manager_2_id || null,
                  manager_1_name: (team as { manager_1_name?: string | null }).manager_1_name || null,
                  manager_2_name: (team as { manager_2_name?: string | null }).manager_2_name || null,
                };
              });
            setTeamDirectory(mapped);
          }
        }
      } catch (error) {
        console.error('Error fetching hierarchy metadata:', error);
      }
    }

    if (canManageUsers) {
      fetchHierarchyMetadata();
    }
  }, [canManageUsers]);

  // Search and role filter
  useEffect(function () {
    let filtered = usersForCurrentStatus;

    // Apply role filter
    if (roleFilter !== 'all') {
      filtered = filtered.filter((user) => {
        if (roleFilter === 'admin') return user.role?.role_class === 'admin' || user.role?.name === 'admin';
        if (roleFilter === 'manager') return user.role?.role_class === 'manager';
        if (roleFilter === 'employee') return user.role?.role_class === 'employee';
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

    if (teamFilter !== 'all') {
      filtered = filtered.filter((user) => (user.team_id || 'unassigned') === teamFilter);
    }

    if (managerFilter !== 'all') {
      filtered = filtered.filter(
        (user) =>
          (managerFilter === 'none' && !user.line_manager_id && !user.secondary_manager_id) ||
          user.line_manager_id === managerFilter ||
          user.secondary_manager_id === managerFilter
      );
    }

    const sorted = [...filtered].sort((a, b) => {
      const teamA = a.team_id ? (teamNameById.get(a.team_id) || a.team_id) : 'ZZZ Unassigned';
      const teamB = b.team_id ? (teamNameById.get(b.team_id) || b.team_id) : 'ZZZ Unassigned';
      const byTeam = teamA.localeCompare(teamB);
      if (byTeam !== 0) return byTeam;

      const byRole = getUserRolePriority(a) - getUserRolePriority(b);
      if (byRole !== 0) return byRole;

      return (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '');
    });

    setFilteredUsers(sorted);
  }, [searchQuery, roleFilter, teamFilter, managerFilter, usersForCurrentStatus, teamNameById, getUserRolePriority]);

  function openQuickEdit(user: ProfileWithEmail, field: 'role' | 'team') {
    setQuickEditTarget({ userId: user.id, field });
    setQuickEditValue(field === 'role' ? (user.role_id || '') : (user.team_id || ''));
    setFormError('');
  }

  async function handleQuickEditSave(user: ProfileWithEmail) {
    if (!quickEditTarget) return;

    const nextRoleId = quickEditTarget.field === 'role' ? quickEditValue || null : (user.role_id || null);
    const nextTeamId = quickEditTarget.field === 'team' ? quickEditValue || null : (user.team_id || null);

    try {
      setQuickEditSaving(true);
      setFormError('');

      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          full_name: user.full_name,
          phone_number: user.phone_number,
          employee_id: user.employee_id,
          role_id: nextRoleId,
          line_manager_id: user.line_manager_id || null,
          team_id: nextTeamId,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update user');
      }

      const usersWithEmails = await fetchUsersWithEmails();
      setUsers(usersWithEmails);
      setFilteredUsers(usersWithEmails);
      setQuickEditTarget(null);
      setQuickEditValue('');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to update user');
    } finally {
      setQuickEditSaving(false);
    }
  }

  // Handle add user
  async function handleAddUser() {
    if (!formData.email || !formData.full_name) {
      setFormError('Please fill in all required fields');
      return;
    }

    if (!formData.role_id) {
      setFormError('Please select a role');
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
          line_manager_id: formData.line_manager_id || null,
          team_id: formData.team_id || null,
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
        line_manager_id: '',
        team_id: '',
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
          line_manager_id: formData.line_manager_id || null,
          team_id: formData.team_id || null,
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
      if (!isExpectedUserAdminError(error)) {
        console.error('Error updating user:', error);
      }
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

      // Delete via API route with deletion mode parameter
      const response = await fetch(`/api/admin/users/${selectedUser.id}?mode=${deletionMode}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        let errorMessage = 'Failed to delete user';
        try {
          const result = await response.json();
          errorMessage = result.error || errorMessage;
        } catch {
          // If JSON parsing fails, use the response status text
          errorMessage = `Failed to delete user: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      // Refresh users list
      const usersWithEmails = await fetchUsersWithEmails();
      setUsers(usersWithEmails);
      setFilteredUsers(usersWithEmails);

      setDeleteOptionsDialogOpen(false);
      setSelectedUser(null);
      setFormError(''); // Clear any previous errors
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete user';
      console.error('Error deleting user:', errorMessage, error);
      setFormError(errorMessage);
    } finally {
      setFormLoading(false);
    }
  }

  // Open edit dialog
  function openEditDialog(userProfile: ProfileWithEmail) {
    setSelectedUser(userProfile);
    // Email comes from auth (merged into ProfileWithEmail), not from the profiles table
    const authEmail = userProfile.email || '';
    setFormData({
      email: authEmail,
      full_name: userProfile.full_name || '',
      phone_number: userProfile.phone_number || '',
      employee_id: userProfile.employee_id || '',
      role_id: userProfile.role_id || '',
      line_manager_id: userProfile.line_manager_id || '',
      team_id: userProfile.team_id || '',
    });
    setFormError('');
    setEditDialogOpen(true);
  }

  // Open delete dialog
  function openDeleteDialog(userProfile: ProfileWithEmail) {
    setSelectedUser(userProfile);
    setFormError('');
    setDeleteOptionsDialogOpen(true);
  }

  // Open reset password dialog
  function openResetPasswordDialog(userProfile: ProfileWithEmail) {
    setSelectedUser(userProfile);
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

  // Show loading while auth is being checked
  if (authLoading || permissionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // Check authorization
  if (!canManageUsers) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Access Denied
            </CardTitle>
            <CardDescription>
              You do not have permission to access this page.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">User Management</h1>
            <p className="text-muted-foreground">
              Manage users, roles, and permissions
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as TabType)} className="space-y-6">
        <TabsList className={`grid w-full ${
          canEditRolePermissions ? 'max-w-2xl grid-cols-4' : canManageRoleDefinitions ? 'max-w-xl grid-cols-3' : 'max-w-sm grid-cols-1'
        } bg-slate-100 dark:bg-slate-800 p-0`}>
          <TabsTrigger 
            value="users" 
            className="gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900"
          >
            <User className="h-4 w-4" />
            Users
          </TabsTrigger>
          {canManageRoleDefinitions && (
            <TabsTrigger 
              value="roles" 
              className="gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900"
            >
              <Briefcase className="h-4 w-4" />
              Roles
            </TabsTrigger>
          )}
          {canManageRoleDefinitions && (
            <TabsTrigger
              value="teams"
              className="gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900"
            >
              <Briefcase className="h-4 w-4" />
              Teams
            </TabsTrigger>
          )}
          {canEditRolePermissions && (
            <TabsTrigger 
              value="permissions" 
              className="gap-2 data-[state=active]:bg-avs-yellow data-[state=active]:text-slate-900"
            >
              <Shield className="h-4 w-4" />
              Permissions
            </TabsTrigger>
          )}
        </TabsList>

        {/* Users Tab Content */}
        <TabsContent value="users" className="space-y-6">
          {/* Secondary tabs */}
          <div className="flex justify-end">
            <Tabs value={userStatusTab} onValueChange={(value) => setUserStatusTab(value as UserStatusTab)}>
              <TabsList>
                <TabsTrigger value="active" className="gap-2">
                  Active Users ({activeUsers.length})
                </TabsTrigger>
                <TabsTrigger value="deleted" className="gap-2">
                  Deleted Users ({deletedUsers.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {userStatusTab === 'deleted' && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              Deleted users are hidden from operational pickers by default so they can no longer be selected in modules like absence.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card 
          className={`border-border cursor-pointer hover:shadow-lg transition-all ${
            roleFilter === 'all' ? 'border-2 border-yellow-500' : ''
          }`}
          onClick={() => setRoleFilter('all')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{userStatusTab === 'deleted' ? 'Deleted Users' : 'Active Users'}</p>
                <p className="text-2xl font-bold text-white">{stats.total}</p>
              </div>
              <User className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card 
          className={`border-border cursor-pointer hover:shadow-lg transition-all ${
            roleFilter === 'admin' ? 'border-2 border-yellow-500' : ''
          }`}
          onClick={() => setRoleFilter('admin')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Admins</p>
                <p className="text-2xl font-bold text-white">{stats.admins}</p>
              </div>
              <Shield className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
        <Card 
          className={`border-border cursor-pointer hover:shadow-lg transition-all ${
            roleFilter === 'manager' ? 'border-2 border-yellow-500' : ''
          }`}
          onClick={() => setRoleFilter('manager')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Managers</p>
                <p className="text-2xl font-bold text-white">{stats.managers}</p>
              </div>
              <Shield className="h-8 w-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card 
          className={`border-border cursor-pointer hover:shadow-lg transition-all ${
            roleFilter === 'employee' ? 'border-2 border-yellow-500' : ''
          }`}
          onClick={() => setRoleFilter('employee')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Employees</p>
                <p className="text-2xl font-bold text-white">{stats.employees}</p>
              </div>
              <User className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User Management Interface */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white">{userStatusTab === 'deleted' ? 'Deleted Users' : 'Active Users'}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {userStatusTab === 'deleted'
                  ? 'Review historical deleted accounts and remove them when it is safe to do so.'
                  : 'View and manage active user accounts, roles, and permissions.'}
              </CardDescription>
            </div>
            {userStatusTab === 'active' && (
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    setFormData({
                      email: '',
                      full_name: '',
                      phone_number: '',
                      employee_id: '',
                      role_id: '',
                      line_manager_id: '',
                      team_id: '',
                    });
                    setFormError('');
                    setAddDialogOpen(true);
                  }}
                  className="bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add User
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, or employee ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-11 bg-slate-900/50 border-slate-600 text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Filter by Team</Label>
                <Select value={teamFilter} onValueChange={setTeamFilter}>
                  <SelectTrigger className="bg-input border-border text-white">
                    <SelectValue placeholder="All teams" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All teams</SelectItem>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {teamOptions.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Filter by Line Manager</Label>
                <Select value={managerFilter} onValueChange={setManagerFilter}>
                  <SelectTrigger className="bg-input border-border text-white">
                    <SelectValue placeholder="All managers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All managers</SelectItem>
                    <SelectItem value="none">No manager assigned</SelectItem>
                    {managerOptions.map((managerUser) => (
                      <SelectItem key={managerUser.id} value={managerUser.id}>
                        {managerUser.full_name || managerUser.email || managerUser.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* User Table */}
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery
                  ? 'No users found matching your search.'
                  : userStatusTab === 'deleted'
                    ? 'No deleted users found.'
                    : 'No active users yet.'}
              </div>
            ) : (
              <div className="border border-slate-700 rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700 hover:bg-slate-800/50">
                      <TableHead className="text-muted-foreground">Name</TableHead>
                      <TableHead className="text-muted-foreground">Email</TableHead>
                      <TableHead className="text-muted-foreground">Employee ID</TableHead>
                      <TableHead className="text-muted-foreground">Role</TableHead>
                      <TableHead className="text-muted-foreground">Team</TableHead>
                      <TableHead className="text-muted-foreground">Line Manager(s)</TableHead>
                      <TableHead className="text-muted-foreground">Created</TableHead>
                      <TableHead className="text-right text-muted-foreground">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((user, index) => {
                      const currentTeamKey = user.team_id || 'unassigned';
                      const previousTeamKey = index > 0 ? (filteredUsers[index - 1]?.team_id || 'unassigned') : null;
                      const startsNewTeam = index === 0 || currentTeamKey !== previousTeamKey;
                      const teamLabel = user.team_id ? (teamNameById.get(user.team_id) || user.team_id) : 'Unassigned';

                      return (
                      <Fragment key={user.id}>
                        {startsNewTeam && (
                          <TableRow key={`${currentTeamKey}-divider`} className="border-slate-600 bg-slate-950/40 hover:bg-slate-950/40">
                            <TableCell colSpan={8} className="py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                              {teamLabel}
                            </TableCell>
                          </TableRow>
                        )}
                      <TableRow key={user.id} className="border-slate-700 hover:bg-slate-800/50">
                        <TableCell className="font-medium text-white">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                              <User className="h-4 w-4 text-slate-600 dark:text-muted-foreground" />
                            </div>
                            {user.full_name || 'Unnamed User'}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <div className="flex items-center gap-2 text-sm">
                            <Mail className="h-3 w-3 text-muted-foreground" />
                            {user.email}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{user.employee_id || '-'}</TableCell>
                        <TableCell>
                          <Popover
                            open={quickEditTarget?.userId === user.id && quickEditTarget.field === 'role'}
                            onOpenChange={(open) => {
                              if (!open) {
                                setQuickEditTarget(null);
                                setQuickEditValue('');
                              }
                            }}
                          >
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                disabled={!canQuickEditAssignments}
                                onClick={() => canQuickEditAssignments && openQuickEdit(user, 'role')}
                                className="disabled:cursor-default enabled:cursor-pointer"
                              >
                                <Badge variant={
                                  user.email === 'admin@mpdee.co.uk' ? 'destructive' :
                                  user.role?.role_class === 'admin' ? 'destructive' :
                                  user.role?.role_class === 'manager' ? 'warning' : 'secondary'
                                }>
                                  {user.email === 'admin@mpdee.co.uk' ? 'SuperAdmin' : (user.role?.display_name || 'No Role')}
                                </Badge>
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="border-border bg-slate-900 text-white">
                              <div className="space-y-3">
                                <div>
                                  <p className="text-sm font-medium">Change Job Role</p>
                                  <p className="text-xs text-muted-foreground">{user.full_name || user.email}</p>
                                </div>
                                <Select value={quickEditValue} onValueChange={setQuickEditValue}>
                                  <SelectTrigger className="bg-input border-border text-white">
                                    <SelectValue placeholder="Select role" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {getRoleOptionsForUser(user).map((role) => (
                                      <SelectItem key={role.id} value={role.id}>
                                        {role.display_name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setQuickEditTarget(null);
                                      setQuickEditValue('');
                                    }}
                                    className="border-slate-600 text-white hover:bg-slate-800"
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => handleQuickEditSave(user)}
                                    disabled={quickEditSaving}
                                    className="bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900"
                                  >
                                    {quickEditSaving ? 'Saving...' : 'Save'}
                                  </Button>
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <Popover
                            open={quickEditTarget?.userId === user.id && quickEditTarget.field === 'team'}
                            onOpenChange={(open) => {
                              if (!open) {
                                setQuickEditTarget(null);
                                setQuickEditValue('');
                              }
                            }}
                          >
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                disabled={!canQuickEditAssignments}
                                onClick={() => canQuickEditAssignments && openQuickEdit(user, 'team')}
                                className="text-left disabled:cursor-default enabled:cursor-pointer"
                              >
                                {user.team_id ? (teamNameById.get(user.team_id) || user.team_id) : 'Unassigned'}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="border-border bg-slate-900 text-white">
                              <div className="space-y-3">
                                <div>
                                  <p className="text-sm font-medium">Change Team</p>
                                  <p className="text-xs text-muted-foreground">{user.full_name || user.email}</p>
                                </div>
                                <Select value={quickEditValue || 'none'} onValueChange={(value) => setQuickEditValue(value === 'none' ? '' : value)}>
                                  <SelectTrigger className="bg-input border-border text-white">
                                    <SelectValue placeholder="Select team" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">No team</SelectItem>
                                    {teamOptions.map((team) => (
                                      <SelectItem key={team.id} value={team.id}>
                                        {team.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setQuickEditTarget(null);
                                      setQuickEditValue('');
                                    }}
                                    className="border-slate-600 text-white hover:bg-slate-800"
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => handleQuickEditSave(user)}
                                    disabled={quickEditSaving}
                                    className="bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900"
                                  >
                                    {quickEditSaving ? 'Saving...' : 'Save'}
                                  </Button>
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {getDisplayedManagers(user.line_manager_id, user.secondary_manager_id)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-3 w-3 text-muted-foreground" />
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
                      </Fragment>
                    )})}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="border-border text-white">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription className="text-muted-foreground">
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
              <strong>Note:</strong> A secure temporary password will be automatically generated and sent to the user&apos;s email address.
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-email">Email *</Label>
              <Input
                id="add-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="user@example.com"
                className="bg-input border-border text-white placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-name">Full Name *</Label>
              <Input
                id="add-name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                placeholder="John Smith"
                className="bg-input border-border text-white placeholder:text-muted-foreground"
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
                className="bg-input border-border text-white placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-employee-id">Employee ID</Label>
              <Input
                id="add-employee-id"
                value={formData.employee_id}
                onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                placeholder="E001"
                className="bg-input border-border text-white placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-role">Role *</Label>
              <Select value={formData.role_id} onValueChange={(value) => setFormData({ ...formData, role_id: value })}>
                <SelectTrigger className="bg-input border-border text-white">
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
            <>
              <div className="space-y-2">
                <Label htmlFor="add-team-id">Primary Team</Label>
                <Select
                  value={formData.team_id || 'none'}
                  onValueChange={(value) => setFormData({ ...formData, team_id: value === 'none' ? '' : value })}
                >
                  <SelectTrigger id="add-team-id" className="bg-input border-border text-white">
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No team</SelectItem>
                    {teamOptions.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Manager 1</Label>
                <div className="rounded-md border border-input bg-input px-3 py-2 text-sm text-white">
                  {selectedAddTeamManagers?.manager_1_name || 'No Manager 1'}
                </div>
                <p className="text-xs text-muted-foreground">Inherited automatically from the selected team.</p>
              </div>
              <div className="space-y-2">
                <Label>Manager 2</Label>
                <div className="rounded-md border border-input bg-input px-3 py-2 text-sm text-white">
                  {selectedAddTeamManagers?.manager_2_name || 'No Manager 2'}
                </div>
                <p className="text-xs text-muted-foreground">Inherited automatically from the selected team.</p>
              </div>
            </>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button onClick={handleAddUser} disabled={formLoading} className="bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900">
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
        <DialogContent className="border-border text-white">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription className="text-muted-foreground">
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
                className="bg-input border-border text-white"
              />
              <p className="text-xs text-amber-500">⚠️ Changing email will require the user to verify their new address</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name">Full Name *</Label>
              <Input
                id="edit-name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                className="bg-input border-border text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">Phone Number</Label>
              <Input
                id="edit-phone"
                type="tel"
                value={formData.phone_number}
                onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                className="bg-input border-border text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-employee-id">Employee ID</Label>
              <Input
                id="edit-employee-id"
                value={formData.employee_id}
                onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                className="bg-input border-border text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Role *</Label>
              <Select value={formData.role_id} onValueChange={(value) => setFormData({ ...formData, role_id: value })}>
                <SelectTrigger className="bg-input border-border text-white">
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
            <>
              <div className="space-y-2">
                <Label htmlFor="edit-team-id">Primary Team</Label>
                <Select
                  value={formData.team_id || 'none'}
                  onValueChange={(value) => setFormData({ ...formData, team_id: value === 'none' ? '' : value })}
                >
                  <SelectTrigger id="edit-team-id" className="bg-input border-border text-white">
                    <SelectValue placeholder="Select team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No team</SelectItem>
                    {teamOptions.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Manager 1</Label>
                <div className="rounded-md border border-input bg-input px-3 py-2 text-sm text-white">
                  {(formData.team_id ? teamDetailsById.get(formData.team_id)?.manager_1_name : null) || 'No Manager 1'}
                </div>
                <p className="text-xs text-muted-foreground">Inherited automatically from the selected team.</p>
              </div>
              <div className="space-y-2">
                <Label>Manager 2</Label>
                <div className="rounded-md border border-input bg-input px-3 py-2 text-sm text-white">
                  {(formData.team_id ? teamDetailsById.get(formData.team_id)?.manager_2_name : null) || 'No Manager 2'}
                </div>
                <p className="text-xs text-muted-foreground">Inherited automatically from the selected team.</p>
              </div>
            </>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} className="border-slate-600 text-white hover:bg-slate-800">
              Cancel
            </Button>
            <Button onClick={handleEditUser} disabled={formLoading} className="bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900">
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

      {/* Delete Options Dialog */}
      <Dialog open={deleteOptionsDialogOpen} onOpenChange={setDeleteOptionsDialogOpen}>
        <DialogContent className="border-border text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete User Account
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Choose how to handle this user&apos;s company data (timesheets, inspections, etc.)
            </DialogDescription>
          </DialogHeader>
          
          {selectedUser && (
            <div className="space-y-4">
              {/* User Info */}
              <div className="bg-slate-800 rounded p-4 space-y-2">
                <div className="text-sm">
                  <span className="text-muted-foreground">Name:</span>{' '}
                  <span className="text-white font-medium">{selectedUser.full_name}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Email:</span>{' '}
                  <span className="text-slate-200">{selectedUser.email}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Role:</span>{' '}
                  <Badge variant={
                    selectedUser.email === 'admin@mpdee.co.uk' ? 'destructive' :
                    selectedUser.role?.role_class === 'admin' ? 'destructive' : 'default'
                  }>
                    {selectedUser.email === 'admin@mpdee.co.uk' ? 'SuperAdmin' : (selectedUser.role?.display_name || 'No Role')}
                  </Badge>
                </div>
              </div>

              {/* Deletion Options */}
              <div className="space-y-3">
                <Label className="text-white font-semibold">What should happen to this user&apos;s company data?</Label>
                
                {/* Option 1: Keep Data (Recommended) */}
                <div 
                  onClick={() => setDeletionMode('keep-data')}
                  className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
                    deletionMode === 'keep-data' 
                      ? 'border-green-500 bg-green-500/10' 
                      : 'border-slate-600 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                      deletionMode === 'keep-data' ? 'border-green-500' : 'border-slate-500'
                    }`}>
                      {deletionMode === 'keep-data' && (
                        <div className="h-3 w-3 rounded-full bg-green-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-white">Keep Company Data</p>
                        <Badge variant="outline" className="text-green-500 border-green-500">
                          Recommended
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-400 mt-1">
                        Preserve timesheets, inspections, and other submitted work for audits and reporting.
                        User will be marked as &quot;{selectedUser.full_name} (Deleted User)&quot; in all records.
                      </p>
                      <div className="mt-2 text-xs text-muted-foreground">
                        ✓ Personal account deleted  • ✓ Company data preserved  • ✓ Audit trail maintained
                      </div>
                    </div>
                  </div>
                </div>

                {/* Option 2: Delete All */}
                <div 
                  onClick={() => setDeletionMode('delete-all')}
                  className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
                    deletionMode === 'delete-all' 
                      ? 'border-red-500 bg-red-500/10' 
                      : 'border-slate-600 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                      deletionMode === 'delete-all' ? 'border-red-500' : 'border-slate-500'
                    }`}>
                      {deletionMode === 'delete-all' && (
                        <div className="h-3 w-3 rounded-full bg-red-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-white">Delete All User Data</p>
                        <Badge variant="destructive">
                          Permanent
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-400 mt-1">
                        Completely remove all data including timesheets, inspections, and submitted work.
                        This may impact reports and audit trails.
                      </p>
                      <div className="mt-2 text-xs text-red-400">
                        ⚠ Cannot be undone  • ⚠ Affects reporting  • ⚠ Removes audit history
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {formError && (
                <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
                  {formError}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setDeleteOptionsDialogOpen(false)} 
              className="border-slate-600 text-white hover:bg-slate-800"
              disabled={formLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteUser}
              disabled={formLoading}
              className={deletionMode === 'delete-all' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}
            >
              {formLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  {deletionMode === 'keep-data' ? 'Delete User (Keep Data)' : 'Delete User & All Data'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Confirmation Dialog */}
      <Dialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
        <DialogContent className="border-border text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-500" />
              Reset User Password
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This will generate a new temporary password for the user. They will be required to change it on their next login.
            </DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="bg-slate-800 rounded p-4 space-y-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Name:</span>{' '}
                <span className="text-white font-medium">{selectedUser.full_name}</span>
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Email:</span>{' '}
                <span className="text-slate-200">{selectedUser.email}</span>
              </p>
            </div>
          )}
          {formError && (
            <div className="bg-red-500/10 border border-red-500/50 rounded p-3 text-sm text-red-400">
              {formError}
            </div>
          )}
          <div className="bg-amber-500/10 border border-amber-500/50 rounded p-3 text-sm text-amber-400">
            <strong>Note:</strong> The new password will be sent to the user&apos;s email address and displayed to you.
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
        <DialogContent className="border-border text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              {isNewUser ? 'User Created Successfully' : 'Password Reset Successfully'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
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
              className="bg-avs-yellow hover:bg-avs-yellow-hover text-slate-900"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </TabsContent>

        {/* Roles Tab Content */}
        {canManageRoleDefinitions && (
          <TabsContent value="roles">
            <JobRolesTab />
          </TabsContent>
        )}

        {canManageRoleDefinitions && (
          <TabsContent value="teams">
            <TeamsTab />
          </TabsContent>
        )}

        {/* Permissions Tab Content */}
        {canEditRolePermissions && (
          <TabsContent value="permissions">
            <RoleManagement />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
