'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useOfflineSync } from '@/lib/hooks/useOfflineSync';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Menu, 
  X, 
  Home, 
  FileText, 
  ClipboardCheck, 
  BarChart3, 
  Users, 
  LogOut,
  CheckSquare,
  ListTodo,
  Truck,
  Calendar,
  Bell,
  MessageSquare,
  Eye
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { NotificationPanel } from '@/components/messages/NotificationPanel';
import { SidebarNav } from './SidebarNav';
import { createClient } from '@/lib/supabase/client';
import type { ModuleName } from '@/types/roles';

type ViewAsRole = 'actual' | 'employee' | 'manager' | 'admin';

export function Navbar() {
  const pathname = usePathname();
  const { user, profile, signOut, isAdmin, isManager } = useAuth();
  const { isOnline, pendingCount } = useOfflineSync();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // Sidebar starts collapsed
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [userPermissions, setUserPermissions] = useState<Set<ModuleName>>(new Set());
  const [permissionsLoading, setPermissionsLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string>('');
  const [viewAsRole, setViewAsRole] = useState<ViewAsRole>('actual');
  const [hasRAMSAssignments, setHasRAMSAssignments] = useState(false);
  const supabase = createClient();
  
  const isSuperAdmin = userEmail === 'admin@mpdee.co.uk';
  const effectiveIsManager = isManager && !(isSuperAdmin && viewAsRole === 'employee');
  const effectiveIsAdmin = isAdmin && !(isSuperAdmin && viewAsRole === 'employee');

  // Fetch user email
  useEffect(() => {
    async function fetchUserEmail() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        setUserEmail(user.email);
      }
    }
    fetchUserEmail();
  }, [supabase]);

  // Load persisted viewAs setting
  useEffect(() => {
    if (isSuperAdmin) {
      const stored = localStorage.getItem('viewAsRole');
      if (stored) {
        setViewAsRole(stored as ViewAsRole);
      }
    }
  }, [isSuperAdmin]);

  // Persist viewAs setting
  useEffect(() => {
    if (isSuperAdmin) {
      localStorage.setItem('viewAsRole', viewAsRole);
    }
  }, [viewAsRole, isSuperAdmin]);

  // Fetch user permissions (adjusted for viewAs mode)
  useEffect(() => {
    async function fetchPermissions() {
      if (!profile?.id) {
        setPermissionsLoading(false);
        return;
      }

      // When viewing as different roles, simulate their permissions
      if (isSuperAdmin && viewAsRole !== 'actual') {
        if (viewAsRole === 'admin' || viewAsRole === 'manager') {
          setUserPermissions(new Set(['timesheets', 'inspections', 'absence', 'rams', 'approvals', 'actions', 'reports'] as ModuleName[]));
        } else if (viewAsRole === 'employee') {
          // Simulate basic employee permissions
          setUserPermissions(new Set(['timesheets', 'inspections'] as ModuleName[]));
        }
        setPermissionsLoading(false);
        return;
      }

      // Managers and admins have all permissions
      if (isManager || isAdmin) {
        setUserPermissions(new Set(['timesheets', 'inspections', 'absence', 'rams', 'approvals', 'actions', 'reports'] as ModuleName[]));
        setPermissionsLoading(false);
        return;
      }

      // Fetch role permissions for regular users
      try {
        const { data } = await supabase
          .from('profiles')
          .select(`
            role_id,
            roles!inner(
              role_permissions(
                module_name,
                enabled
              )
            )
          `)
          .eq('id', profile.id)
          .single();
        
        // Build Set of enabled permissions
        const enabledModules = new Set<ModuleName>();
        const rolePerms = data?.roles as any;
        rolePerms?.role_permissions?.forEach((perm: any) => {
          if (perm.enabled) {
            enabledModules.add(perm.module_name as ModuleName);
          }
        });
        
        setUserPermissions(enabledModules);
      } catch (error) {
        console.error('Error fetching permissions:', error);
        setUserPermissions(new Set());
      } finally {
        setPermissionsLoading(false);
      }
    }
    fetchPermissions();
  }, [profile?.id, isManager, isAdmin, supabase, isSuperAdmin, viewAsRole]);

  // Fetch RAMS assignments to determine if RAMS should be visible
  useEffect(() => {
    async function fetchRAMSAssignments() {
      if (!profile?.id) return;
      
      try {
        const { count } = await supabase
          .from('rams_assignments')
          .select('*', { count: 'exact', head: true })
          .eq('employee_id', profile.id);
        
        setHasRAMSAssignments((count || 0) > 0);
      } catch (error) {
        console.error('Error fetching RAMS assignments:', error);
        setHasRAMSAssignments(false);
      }
    }
    
    fetchRAMSAssignments();
  }, [profile?.id, supabase]);

  // Fetch notification count (only when user is authenticated)
  useEffect(() => {
    // Don't fetch if not logged in or user ID is not available
    if (!user?.id) return;

    async function fetchNotificationCount() {
      try {
        // Double-check user is still authenticated before making request
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser?.id) {
          setUnreadCount(0);
          return;
        }

        const response = await fetch('/api/messages/notifications');
        
        // Handle 401 gracefully - user may have just logged out
        if (response.status === 401) {
          setUnreadCount(0);
          return;
        }

        // Handle other HTTP errors
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        if (data.success) {
          setUnreadCount(data.unread_count || 0);
        }
      } catch (error) {
        // Improved error logging with context
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorDetails = {
          message: errorMessage,
          type: error instanceof TypeError ? 'Network' : 'Application',
          endpoint: '/api/messages/notifications',
          userId: user?.id || 'unknown',
          timestamp: new Date().toISOString()
        };

        // Only log if error is not a simple network timeout or user logged out
        if (error instanceof Error && !error.message.includes('401')) {
          console.error('Error fetching notifications:', errorDetails);
        }
        
        // Set count to 0 on error to prevent showing stale data
        setUnreadCount(0);
      }
    }

    fetchNotificationCount();
    
    // Poll every 60 seconds for new notifications
    const interval = setInterval(fetchNotificationCount, 60000);
    return () => clearInterval(interval);
  }, [user?.id, supabase]);

  const handleSignOut = async () => {
    try {
      // Close mobile menu if open
      setMobileMenuOpen(false);
      
      // Sign out and wait for completion
      await signOut();
      
      // Force a hard redirect to ensure all state is cleared (especially important for admin accounts)
      // This ensures the sign out works on first click
      window.location.href = '/login';
    } catch (error) {
      console.error('Error during sign out:', error);
      // Still redirect on error to ensure user can log out
      window.location.href = '/login';
    }
  };

  // Dashboard is always visible
  const dashboardNav = [
    { href: '/dashboard', label: 'Dashboard', icon: Home },
  ];
  
  // Employee navigation - filtered by permissions
  const allEmployeeNav = [
    { href: '/timesheets', label: 'Timesheets', icon: FileText, module: 'timesheets' as ModuleName },
    { href: '/inspections', label: 'Inspections', icon: ClipboardCheck, module: 'inspections' as ModuleName },
    { href: '/rams', label: 'RAMS', icon: CheckSquare, module: 'rams' as ModuleName },
    { href: '/absence', label: 'Absence', icon: Calendar, module: 'absence' as ModuleName },
  ];

  // Filter employee nav by permissions
  const employeeNav = allEmployeeNav.filter(item => {
    // Check basic permission
    if (!userPermissions.has(item.module)) {
      return false;
    }
    
    // Special handling for RAMS - hide for employees with no assignments
    if (item.module === 'rams' && !effectiveIsManager && !effectiveIsAdmin && !hasRAMSAssignments) {
      return false;
    }
    
    return true;
  });

  // Manager/admin links for mobile menu only
  const managerLinks = [
    { href: '/approvals', label: 'Approvals', icon: CheckSquare },
    { href: '/actions', label: 'Actions', icon: ListTodo },
    { href: '/toolbox-talks', label: 'Toolbox Talks', icon: MessageSquare },
    { href: '/reports', label: 'Reports', icon: BarChart3 },
  ];

  const adminLinks = isAdmin ? [
    { href: '/admin/users', label: 'Users', icon: Users },
    { href: '/admin/vehicles', label: 'Vehicles', icon: Truck },
  ] : [];

  return (
    <>
      {/* Sidebar for Manager/Admin (desktop) */}
      <SidebarNav open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />

      <nav className="bg-slate-900/50 backdrop-blur-xl border-b border-slate-700/50 sticky top-0 z-50">
        {/* AVS Yellow accent strip */}
        <div className="h-1 bg-gradient-to-r from-avs-yellow via-avs-yellow to-avs-yellow-hover"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/dashboard" className="flex items-center space-x-2 group">
                <div className="text-xl font-bold text-white group-hover:text-avs-yellow transition-colors">
                  SQUIRES
                </div>
              </Link>

              {/* Desktop Navigation - Same for all users */}
              <div className="hidden md:flex md:ml-10 md:space-x-4">
                {/* Dashboard */}
                {dashboardNav.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname?.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        isActive
                          ? 'bg-avs-yellow'
                          : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                      }`}
                      style={isActive ? { color: 'rgb(15 23 42)' } : {}}
                    >
                      <Icon className="w-4 h-4 mr-2" style={isActive ? { color: 'rgb(15 23 42)' } : {}} />
                      {item.label}
                    </Link>
                  );
                })}
                
                {/* Employee Navigation - Same for all */}
                {employeeNav.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname?.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        isActive
                          ? 'bg-avs-yellow'
                          : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                      }`}
                      style={isActive ? { color: 'rgb(15 23 42)' } : {}}
                    >
                      <Icon className="w-4 h-4 mr-2" style={isActive ? { color: 'rgb(15 23 42)' } : {}} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Right side */}
            <div className="flex items-center space-x-4">
            {/* Offline/Online Status */}
            <div className="flex items-center space-x-2">
              {isOnline ? (
                <div 
                  className="w-2.5 h-2.5 rounded-full bg-green-400" 
                  title="Online"
                />
              ) : (
                <div className="flex items-center space-x-2">
                  <div 
                    className="w-2.5 h-2.5 rounded-full bg-amber-400" 
                    title="Offline"
                  />
                  {pendingCount > 0 && (
                    <Badge variant="warning" className="text-xs bg-amber-500/20 text-amber-300 border-amber-500/30">
                      {pendingCount} pending
                    </Badge>
                  )}
                </div>
              )}
            </div>

              {/* Notification Bell */}
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNotificationPanelOpen(!notificationPanelOpen)}
                  className="text-slate-300 hover:text-white hover:bg-slate-800/50 relative"
                  title="Notifications"
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Button>
              </div>

              {/* View As Selector (SuperAdmin only) */}
              {isSuperAdmin && (
                <div className="hidden lg:flex items-center gap-2">
                  <Eye className="w-4 h-4 text-slate-400" />
                  <Select value={viewAsRole} onValueChange={(value) => {
                    setViewAsRole(value as ViewAsRole);
                    // Refresh page to apply new view
                    setTimeout(() => window.location.reload(), 100);
                  }}>
                    <SelectTrigger className="w-[140px] h-8 bg-slate-800/50 border-slate-600 text-slate-300 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="actual">Actual Role</SelectItem>
                      <SelectItem value="employee">View as Employee</SelectItem>
                      <SelectItem value="manager">View as Manager</SelectItem>
                      <SelectItem value="admin">View as Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Sign Out button only */}
              <div className="hidden md:flex items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSignOut}
                  className="text-slate-300 hover:text-white hover:bg-slate-800/50"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>

              {/* Mobile menu button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 rounded-md text-slate-300 hover:bg-slate-800/50 hover:text-white"
              >
                {mobileMenuOpen ? (
                  <X className="w-6 h-6" />
                ) : (
                  <Menu className="w-6 h-6" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-700/50 bg-slate-900/95 backdrop-blur-xl">
            <div className="px-2 pt-2 pb-3 space-y-1">
              {/* Dashboard */}
              {dashboardNav.map((item) => {
                const Icon = item.icon;
                const isActive = pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center px-3 py-2 text-base font-medium rounded-md ${
                      isActive
                        ? 'bg-avs-yellow'
                        : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                    }`}
                    style={isActive ? { color: 'rgb(15 23 42)' } : {}}
                  >
                    <Icon className="w-5 h-5 mr-3" style={isActive ? { color: 'rgb(15 23 42)' } : {}} />
                    {item.label}
                  </Link>
                );
              })}
              
              {/* Employee Navigation */}
              {employeeNav.map((item) => {
                const Icon = item.icon;
                const isActive = pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center px-3 py-2 text-base font-medium rounded-md ${
                      isActive
                        ? 'bg-avs-yellow'
                        : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                    }`}
                    style={isActive ? { color: 'rgb(15 23 42)' } : {}}
                  >
                    <Icon className="w-5 h-5 mr-3" style={isActive ? { color: 'rgb(15 23 42)' } : {}} />
                    {item.label}
                  </Link>
                );
              })}
              
              {/* Manager/Admin Section (Mobile) */}
              {isManager && (
                <>
                  <div className="my-3 border-t border-slate-700/50"></div>
                  
                  {/* Management Section */}
                  <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Management
                  </div>
                  {managerLinks.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname?.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center px-3 py-2 text-base font-medium rounded-md ${
                          isActive
                            ? 'bg-avs-yellow'
                            : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                        }`}
                        style={isActive ? { color: 'rgb(15 23 42)' } : {}}
                      >
                        <Icon className="w-5 h-5 mr-3" style={isActive ? { color: 'rgb(15 23 42)' } : {}} />
                        {item.label}
                      </Link>
                    );
                  })}
                  
                  {/* Admin Links */}
                  {isAdmin && (
                    <>
                      <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider mt-4">
                        Administration
                      </div>
                      {adminLinks.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname?.startsWith(item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMobileMenuOpen(false)}
                            className={`flex items-center px-3 py-2 text-base font-medium rounded-md ${
                              isActive
                                ? 'bg-avs-yellow'
                                : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                            }`}
                            style={isActive ? { color: 'rgb(15 23 42)' } : {}}
                          >
                            <Icon className="w-5 h-5 mr-3" style={isActive ? { color: 'rgb(15 23 42)' } : {}} />
                            {item.label}
                          </Link>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </div>
            <div className="pt-4 pb-3 border-t border-slate-700/50">
              <div className="px-2 space-y-2">
                {/* SuperAdmin Tools (Mobile) */}
                {isSuperAdmin && (
                  <>
                    <div className="px-2 py-2">
                      <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
                        View As
                      </label>
                      <Select value={viewAsRole} onValueChange={(value) => {
                        setViewAsRole(value as ViewAsRole);
                        setMobileMenuOpen(false);
                        // Refresh page to apply new view
                        setTimeout(() => window.location.reload(), 100);
                      }}>
                        <SelectTrigger className="w-full bg-slate-800/50 border-slate-600 text-slate-300">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="actual">Actual Role</SelectItem>
                          <SelectItem value="employee">View as Employee</SelectItem>
                          <SelectItem value="manager">View as Manager</SelectItem>
                          <SelectItem value="admin">View as Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="border-t border-slate-700/50 my-2"></div>
                  </>
                )}
                
                <Button
                  variant="ghost"
                  className="w-full justify-start text-slate-300 hover:text-white hover:bg-slate-800/50"
                  onClick={handleSignOut}
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Notification Panel */}
        <NotificationPanel
          open={notificationPanelOpen}
          onClose={() => {
            setNotificationPanelOpen(false);
            // Refresh unread count after closing
            fetch('/api/messages/notifications')
              .then(res => res.json())
              .then(data => {
                if (data.success) {
                  setUnreadCount(data.unread_count || 0);
                }
              })
              .catch(console.error);
          }}
        />
      </nav>
    </>
  );
}
