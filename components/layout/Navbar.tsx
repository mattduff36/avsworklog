'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  Menu, 
  X, 
  LogOut,
  Bell,
  Bug,
  ChevronDown,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { NotificationPanel } from '@/components/messages/NotificationPanel';
import { SidebarNav } from './SidebarNav';
import { createClient } from '@/lib/supabase/client';
import type { ModuleName } from '@/types/roles';
import { 
  dashboardNavItem, 
  getFilteredEmployeeNav, 
  managerNavItems, 
  adminNavItems 
} from '@/lib/config/navigation';

/**
 * Get the module-specific active color classes for a nav item
 * Each module gets its own color when the link is active
 */
function getNavItemActiveColors(href: string): { bg: string; text: string } {
  // Dashboard and Help use brand yellow (with dark text)
  if (href === '/dashboard' || href === '/help') {
    return { bg: 'bg-avs-yellow', text: 'text-slate-900' };
  }
  // Timesheets - Blue
  if (href.startsWith('/timesheets')) {
    return { bg: 'bg-timesheet', text: 'text-white' };
  }
  // Plant Inspections - Darker Orange
  if (href.startsWith('/plant-inspections')) {
    return { bg: 'bg-plant-inspection', text: 'text-white' };
  }
  // Inspections - Orange
  if (href.startsWith('/inspections')) {
    return { bg: 'bg-inspection', text: 'text-white' };
  }
  // RAMS - Green
  if (href.startsWith('/rams')) {
    return { bg: 'bg-rams', text: 'text-white' };
  }
  // Absence - Purple
  if (href.startsWith('/absence')) {
    return { bg: 'bg-absence', text: 'text-white' };
  }
  // Fleet/Maintenance - Red
  if (href.startsWith('/fleet') || href.startsWith('/maintenance')) {
    return { bg: 'bg-maintenance', text: 'text-white' };
  }
  // Workshop - Brown/rust
  if (href.startsWith('/workshop')) {
    return { bg: 'bg-workshop', text: 'text-white' };
  }
  // Reports - Teal
  if (href.startsWith('/reports')) {
    return { bg: 'bg-report', text: 'text-white' };
  }
  // Default - Brand yellow
  return { bg: 'bg-avs-yellow', text: 'text-slate-900' };
}

export function Navbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, profile, signOut, isAdmin, isManager, isActualSuperAdmin, isViewingAs, effectiveRole } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // Sidebar starts collapsed
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [userPermissions, setUserPermissions] = useState<Set<ModuleName>>(new Set());
  const [permissionsLoading, setPermissionsLoading] = useState(true);
  const [hasRAMSAssignments, setHasRAMSAssignments] = useState(false);
  const [isMounted, setIsMounted] = useState(false); // Track client hydration
  const supabase = createClient();

  // useAuth now provides effective role flags (respecting View As cookie)
  const isSuperAdmin = isActualSuperAdmin;
  const effectiveIsManager = isManager;
  const effectiveIsAdmin = isAdmin;

  // Set mounted state after hydration to prevent hydration mismatches
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Fetch user permissions (useAuth flags already respect View As mode)
  useEffect(() => {
    async function fetchPermissions() {
      if (!profile?.id) {
        setPermissionsLoading(false);
        return;
      }

      // Managers and admins have all permissions
      if (isManager || isAdmin) {
        setUserPermissions(new Set(['timesheets', 'inspections', 'plant-inspections', 'absence', 'rams', 'maintenance', 'workshop-tasks', 'approvals', 'actions', 'reports'] as ModuleName[]));
        setPermissionsLoading(false);
        return;
      }

      try {
        const enabledModules = new Set<ModuleName>();

        // When viewing as another role, fetch permissions from the EFFECTIVE role
        // (not the actual profile's role which is still admin/superadmin).
        // If viewAsRoleId is empty (stale cookie), deny to avoid privilege escalation.
        if (isViewingAs && effectiveRole) {
          const viewAsRoleId = (await import('@/lib/utils/view-as-cookie')).getViewAsRoleId();
          if (viewAsRoleId) {
            const { data: perms } = await supabase
              .from('role_permissions')
              .select('module_name, enabled')
              .eq('role_id', viewAsRoleId);
            perms?.forEach((perm: { module_name: string; enabled: boolean }) => {
              if (perm.enabled) {
                enabledModules.add(perm.module_name as ModuleName);
              }
            });
            setUserPermissions(enabledModules);
          } else {
            setUserPermissions(new Set());
          }
          setPermissionsLoading(false);
          return;
        }

        // Normal flow: fetch from profile → role → permissions
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
  }, [profile?.id, isManager, isAdmin, isViewingAs, effectiveRole, supabase]);

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

        // Only log unexpected errors, not network failures or auth errors
        // Skip: "Failed to fetch" (dev server down), "Network request failed" (offline), "401" (logged out)
        const isExpectedError = error instanceof Error && (
          error.message.includes('401') ||
          error.message.includes('Failed to fetch') ||
          error.message.includes('Network request failed')
        );
        
        if (!isExpectedError) {
          console.warn('Error fetching notifications:', errorMessage, errorDetails);
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

  // Helper function to check if a nav link is active
  const isLinkActive = (href: string): boolean => {
    if (!pathname) return false;
    
    // Parse the href to separate path and query
    const [linkPath, linkQuery] = href.split('?');
    
    // Check if pathname matches (handles nested routes consistently)
    // Match exact path OR nested paths (e.g., /fleet matches /fleet/vehicles/123)
    const pathMatches = pathname === linkPath || pathname.startsWith(linkPath + '/');
    
    if (!pathMatches) return false;
    
    // If no query params in href, path match is sufficient
    if (!linkQuery) {
      return true;
    }

    // Hydration safety: search params can differ during SSR vs client hydration.
    // Until mounted, only use path matching to keep server/client HTML identical.
    if (!isMounted) {
      return true;
    }
    
    // If href has query params, verify they all match current URL
    const linkParams = new URLSearchParams(linkQuery);
    
    // Check all link query params exist in current URL with same values
    for (const [key, value] of linkParams.entries()) {
      if (searchParams?.get(key) !== value) {
        return false;
      }
    }
    
    return true;
  };

  // Dashboard is always visible
  const dashboardNav = [dashboardNavItem];
  
  // Employee navigation - filtered by permissions (using shared config)
  const employeeNav = getFilteredEmployeeNav(
    userPermissions,
    effectiveIsManager,
    effectiveIsAdmin,
    hasRAMSAssignments
  );

  // Manager/admin links for mobile menu only (using shared config)
  const managerLinks = managerNavItems;
  const adminLinks = isAdmin ? adminNavItems : [];

  return (
    <>
      {/* Sidebar for Manager/Admin (desktop) */}
      <SidebarNav open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />

      <nav 
        className="bg-slate-900/50 backdrop-blur-xl border-b border-border/50 sticky top-0 z-50"
        style={{ '--top-nav-h': '68px' } as React.CSSProperties}
      >
        {/* AVS Yellow accent strip */}
        <div className="h-1 bg-gradient-to-r from-avs-yellow via-avs-yellow to-avs-yellow-hover"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              {/* Mobile-only text logo */}
              <Link 
                href="/dashboard" 
                className="md:hidden flex items-center mr-4 group"
                onClick={() => setMobileMenuOpen(false)}
              >
                <div className="text-xl font-bold text-white group-hover:text-avs-yellow transition-colors">
                  SQUIRES
                </div>
              </Link>

              {/* Desktop Navigation - Same for all users */}
              <div className="hidden md:flex md:space-x-4">
                {/* Dashboard */}
                {dashboardNav.map((item) => {
                  const Icon = item.icon;
                  const isActive = isLinkActive(item.href);
                  const activeColors = getNavItemActiveColors(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        isActive
                          ? `${activeColors.bg} ${activeColors.text}`
                          : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4 mr-2" />
                      {item.label}
                    </Link>
                  );
                })}
                
                {/* Employee Navigation - Same for all */}
                {employeeNav.map((item) => {
                  const Icon = item.icon;
                  
                  // Check if this item has a dropdown and user has access to multiple items
                  // CRITICAL: Only populate accessibleDropdownItems after mount to prevent hydration mismatch
                  // When !isMounted, keep empty to ensure server/client render identical link structure
                  const hasDropdown = item.dropdownItems && item.dropdownItems.length > 0;
                  const accessibleDropdownItems = hasDropdown && isMounted
                    ? item.dropdownItems!.filter(dropdownItem => {
                        if (!dropdownItem.module) return true;
                        return userPermissions.has(dropdownItem.module);
                      })
                    : []; // Always empty before mount to prevent hydration mismatch
                  const shouldShowDropdown = isMounted && accessibleDropdownItems.length > 1;
                  
                  // If dropdown should be shown, render dropdown menu
                  if (shouldShowDropdown) {
                    // Find which dropdown item is active to determine trigger colors
                    const activeDropdownItem = accessibleDropdownItems.find(dropdownItem => 
                      isLinkActive(dropdownItem.href)
                    );
                    const isAnyDropdownActive = !!activeDropdownItem;
                    const triggerColors = activeDropdownItem 
                      ? getNavItemActiveColors(activeDropdownItem.href)
                      : { bg: '', text: '' };
                    
                    return (
                      <DropdownMenu key={item.href}>
                        <DropdownMenuTrigger
                          className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                            isAnyDropdownActive
                              ? `${triggerColors.bg} ${triggerColors.text}`
                              : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white'
                          }`}
                        >
                          <Icon className="w-4 h-4 mr-2" />
                          {item.label}
                          <ChevronDown className="w-3 h-3 ml-1" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="bg-slate-800 border-slate-700">
                          {accessibleDropdownItems.map((dropdownItem) => {
                            const DropdownIcon = dropdownItem.icon;
                            const dropdownIsActive = isLinkActive(dropdownItem.href);
                            const dropdownActiveColors = getNavItemActiveColors(dropdownItem.href);
                            
                            return (
                              <DropdownMenuItem
                                key={dropdownItem.href}
                                className={`cursor-pointer ${
                                  dropdownIsActive
                                    ? `${dropdownActiveColors.bg} ${dropdownActiveColors.text}`
                                    : 'text-muted-foreground hover:bg-slate-700 hover:text-white'
                                }`}
                                asChild
                              >
                                <Link href={dropdownItem.href} className="flex items-center">
                                  <DropdownIcon className="w-4 h-4 mr-2" />
                                  {dropdownItem.label}
                                </Link>
                              </DropdownMenuItem>
                            );
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    );
                  }
                  
                  // Otherwise, render as regular link (either no dropdown or only one accessible item)
                  // CRITICAL: Use item.href consistently until after mount to prevent hydration mismatch
                  // The finalHref calculation must be identical on server and client
                  // SAFETY: Validate array is non-empty before accessing by index
                  const finalHref = isMounted && accessibleDropdownItems.length === 1 && accessibleDropdownItems[0]
                    ? accessibleDropdownItems[0].href 
                    : item.href;
                  
                  // Recalculate isActive based on finalHref to ensure correct styling
                  const isActive = isLinkActive(finalHref);
                  const activeColors = getNavItemActiveColors(finalHref);
                  
                  return (
                    <Link
                      key={item.href}
                      href={finalHref}
                      className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        isActive
                          ? `${activeColors.bg} ${activeColors.text}`
                          : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4 mr-2" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Right side */}
            <div className="flex items-center space-x-4">
              {/* Notification Bell */}
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNotificationPanelOpen(!notificationPanelOpen)}
                  className="text-muted-foreground hover:text-white hover:bg-slate-800/50 relative"
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

              {/* Sign Out button only */}
              <div className="hidden md:flex items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSignOut}
                  className="text-muted-foreground hover:text-white hover:bg-slate-800/50"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>

              {/* Mobile menu button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 rounded-md text-muted-foreground hover:bg-slate-800/50 hover:text-white"
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
          <div className="md:hidden border-t border-border/50 bg-slate-900/95 backdrop-blur-xl">
            <div className="px-2 pt-2 pb-3 space-y-1">
              {/* Dashboard */}
              {dashboardNav.map((item) => {
                const Icon = item.icon;
                const isActive = isLinkActive(item.href);
                const activeColors = getNavItemActiveColors(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center px-3 py-2 text-base font-medium rounded-md ${
                      isActive
                        ? `${activeColors.bg} ${activeColors.text}`
                        : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white'
                    }`}
                  >
                    <Icon className="w-5 h-5 mr-3" />
                    {item.label}
                  </Link>
                );
              })}
              
              {/* Employee Navigation */}
              {employeeNav.map((item) => {
                const Icon = item.icon;
                
                // Check if this item has a dropdown and user has access to multiple items
                // CRITICAL: Only populate accessibleDropdownItems after mount to prevent hydration mismatch
                // When !isMounted, keep empty to ensure server/client render identical link structure
                const hasDropdown = item.dropdownItems && item.dropdownItems.length > 0;
                const accessibleDropdownItems = hasDropdown && isMounted
                  ? item.dropdownItems!.filter(dropdownItem => {
                      if (!dropdownItem.module) return true;
                      return userPermissions.has(dropdownItem.module);
                    })
                  : []; // Always empty before mount to prevent hydration mismatch
                const shouldShowDropdown = isMounted && accessibleDropdownItems.length > 1;
                
                // If dropdown should be shown in mobile, render each dropdown item
                if (shouldShowDropdown) {
                  return (
                    <div key={item.href}>
                      {accessibleDropdownItems.map((dropdownItem) => {
                        const DropdownIcon = dropdownItem.icon;
                        const dropdownIsActive = isLinkActive(dropdownItem.href);
                        const dropdownActiveColors = getNavItemActiveColors(dropdownItem.href);
                        
                        return (
                          <Link
                            key={dropdownItem.href}
                            href={dropdownItem.href}
                            onClick={() => setMobileMenuOpen(false)}
                            className={`flex items-center px-3 py-2 text-base font-medium rounded-md ${
                              dropdownIsActive
                                ? `${dropdownActiveColors.bg} ${dropdownActiveColors.text}`
                                : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white'
                            }`}
                          >
                            <DropdownIcon className="w-5 h-5 mr-3" />
                            {dropdownItem.label}
                          </Link>
                        );
                      })}
                    </div>
                  );
                }
                
                // Otherwise, render as regular link
                // CRITICAL: Use item.href consistently until after mount to prevent hydration mismatch
                // The finalHref calculation must be identical on server and client
                // SAFETY: Validate array is non-empty before accessing by index
                const finalHref = isMounted && accessibleDropdownItems.length === 1 && accessibleDropdownItems[0]
                  ? accessibleDropdownItems[0].href 
                  : item.href;
                
                // Recalculate isActive based on finalHref to ensure correct styling
                const isActive = isLinkActive(finalHref);
                const activeColors = getNavItemActiveColors(finalHref);
                
                return (
                  <Link
                    key={item.href}
                    href={finalHref}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center px-3 py-2 text-base font-medium rounded-md ${
                      isActive
                        ? `${activeColors.bg} ${activeColors.text}`
                        : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white'
                    }`}
                  >
                    <Icon className="w-5 h-5 mr-3" />
                    {item.label}
                  </Link>
                );
              })}
              
              {/* Manager/Admin Section (Mobile) */}
              {isManager && (
                <>
                  <div className="my-3 border-t border-border/50"></div>
                  
                  {/* Management Section */}
                  <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Management
                  </div>
                  {managerLinks.map((item) => {
                    const Icon = item.icon;
                    const isActive = isLinkActive(item.href);
                    const activeColors = getNavItemActiveColors(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center px-3 py-2 text-base font-medium rounded-md ${
                          isActive
                            ? `${activeColors.bg} ${activeColors.text}`
                            : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white'
                        }`}
                      >
                        <Icon className="w-5 h-5 mr-3" />
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
                        const isActive = isLinkActive(item.href);
                        const activeColors = getNavItemActiveColors(item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMobileMenuOpen(false)}
                            className={`flex items-center px-3 py-2 text-base font-medium rounded-md ${
                              isActive
                                ? `${activeColors.bg} ${activeColors.text}`
                                : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white'
                            }`}
                          >
                            <Icon className="w-5 h-5 mr-3" />
                            {item.label}
                          </Link>
                        );
                      })}
                    </>
                  )}
                  
                  {/* Developer Tools (Mobile) - SuperAdmin Only (not when viewing as another role) */}
                  {isActualSuperAdmin && !isViewingAs && (
                    <>
                      <div className="px-3 py-2 text-xs font-semibold text-red-500 uppercase tracking-wider mt-4">
                        Developer
                      </div>
                      <Link
                        href="/debug"
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center px-3 py-2 text-base font-medium rounded-md ${
                          pathname === '/debug'
                            ? 'bg-red-600 text-white'
                            : 'text-red-500 hover:bg-slate-800/50 hover:text-red-400'
                        }`}
                      >
                        <Bug className="w-5 h-5 mr-3" />
                        Debug Console
                      </Link>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="pt-4 pb-3 border-t border-border/50">
              <div className="px-2 space-y-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start text-muted-foreground hover:text-white hover:bg-slate-800/50"
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
