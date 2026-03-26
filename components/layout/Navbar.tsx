'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { 
  Menu, 
  X, 
  LogOut,
  Bell,
  Bug,
  HelpCircle,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { NotificationPanel } from '@/components/messages/NotificationPanel';
import { TabletModeToggleActions } from '@/components/layout/TabletModeToggleActions';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { SidebarNav } from './SidebarNav';
import { createClient } from '@/lib/supabase/client';
import { usePermissionSnapshot } from '@/lib/hooks/usePermissionSnapshot';
import { usePendingAbsenceCount, useRamsAssignmentSummary } from '@/lib/hooks/useNavMetrics';
import { 
  dashboardNavItem, 
  getFilteredEmployeeNav, 
  getFilteredNavByPermissions,
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
  // Van Inspections - Orange
  if (href.startsWith('/van-inspections')) {
    return { bg: 'bg-inspection', text: 'text-white' };
  }
  // Plant Inspections - Darker Orange
  if (href.startsWith('/plant-inspections')) {
    return { bg: 'bg-plant-inspection', text: 'text-white' };
  }
  // HGV Inspections - Orange
  if (href.startsWith('/hgv-inspections')) {
    return { bg: 'bg-inspection', text: 'text-white' };
  }
  // Projects (formerly RAMS) - Green
  if (href.startsWith('/projects') || href.startsWith('/rams')) {
    return { bg: 'bg-rams', text: 'text-white' };
  }
  // Absence - Purple
  if (href.startsWith('/absence')) {
    return { bg: 'bg-absence', text: 'text-white' };
  }
  // Maintenance - Red
  if (href.startsWith('/maintenance')) {
    return { bg: 'bg-maintenance', text: 'text-white' };
  }
  // Fleet - Rust/brick
  if (href.startsWith('/fleet')) {
    return { bg: 'bg-fleet', text: 'text-white' };
  }
  // Workshop - Brown/rust
  if (href.startsWith('/workshop')) {
    return { bg: 'bg-workshop', text: 'text-white' };
  }
  // Reports - Brand yellow (management tool)
  if (href.startsWith('/reports')) {
    return { bg: 'bg-avs-yellow', text: 'text-slate-900' };
  }
  // Default - Brand yellow
  return { bg: 'bg-avs-yellow', text: 'text-slate-900' };
}

/**
 * Get module brand color for inactive icon state.
 */
function getNavItemIconColor(href: string): string {
  if (href === '/dashboard' || href === '/help') return 'text-avs-yellow';
  if (href.startsWith('/timesheets')) return 'text-timesheet';
  if (href.startsWith('/van-inspections')) return 'text-inspection';
  if (href.startsWith('/plant-inspections')) return 'text-plant-inspection';
  if (href.startsWith('/hgv-inspections')) return 'text-inspection';
  if (href.startsWith('/projects') || href.startsWith('/rams')) return 'text-rams';
  if (href.startsWith('/absence')) return 'text-absence';
  if (href.startsWith('/maintenance')) return 'text-maintenance';
  if (href.startsWith('/fleet')) return 'text-fleet';
  if (href.startsWith('/workshop')) return 'text-workshop';
  if (href.startsWith('/reports')) return 'text-avs-yellow';
  return 'text-avs-yellow';
}

export function Navbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, profile, signOut, isAdmin, isManager, isActualSuperAdmin, isViewingAs } = useAuth();
  const { tabletModeEnabled } = useTabletMode();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // Sidebar starts collapsed
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isMounted, setIsMounted] = useState(false); // Track client hydration
  const [isCompact, setIsCompact] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const isCompactRef = useRef(false);
  const expandedWidthRef = useRef(0);
  const supabase = createClient();

  // useAuth now provides effective role flags (respecting View As cookie)
  const effectiveIsManager = isManager;
  const effectiveIsAdmin = isAdmin;

  const { enabledModuleSet: userPermissions } = usePermissionSnapshot();
  const { data: ramsSummary } = useRamsAssignmentSummary(profile?.id);
  const { count: pendingAbsenceCount } = usePendingAbsenceCount(
    Boolean(profile?.id) && (effectiveIsManager || effectiveIsAdmin)
  );
  const hasRAMSAssignments = ramsSummary?.hasAssignments || false;

  // Set mounted state after hydration to prevent hydration mismatches
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!tabletModeEnabled) return;
    setMobileMenuOpen(false);
    setSidebarOpen(false);
    setNotificationPanelOpen(false);
  }, [tabletModeEnabled]);

  // Auto-compact: switch to icon-only when labels would overflow the nav container
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;

    const check = () => {
      if (!isCompactRef.current) {
        if (el.scrollWidth > el.clientWidth + 2) {
          expandedWidthRef.current = el.scrollWidth;
          isCompactRef.current = true;
          setIsCompact(true);
        }
      } else {
        if (el.clientWidth >= expandedWidthRef.current + 16) {
          isCompactRef.current = false;
          setIsCompact(false);
        }
      }
    };

    const observer = new ResizeObserver(check);
    observer.observe(el);
    check();

    return () => observer.disconnect();
  }, []);

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

    // Refresh badge when a notification is dismissed (e.g. from ReminderModal)
    const handleNotificationDismissed = () => {
      fetchNotificationCount();
    };
    window.addEventListener('notification-dismissed', handleNotificationDismissed);
    
    // Poll every 60 seconds for new notifications (badge updates when received)
    const interval = setInterval(fetchNotificationCount, 60000);
    return () => {
      clearInterval(interval);
      window.removeEventListener('notification-dismissed', handleNotificationDismissed);
    };
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
    // Match exact path OR nested paths (e.g., /fleet matches /fleet/vans/123)
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
  const managerLinks = getFilteredNavByPermissions(
    managerNavItems,
    userPermissions,
    effectiveIsAdmin
  );
  const adminLinks = getFilteredNavByPermissions(
    adminNavItems,
    userPermissions,
    effectiveIsAdmin
  );

  return (
    <>
      {/* Sidebar for Manager/Admin (desktop) */}
      {!tabletModeEnabled && <SidebarNav open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />}

      <nav 
        className="bg-slate-900/50 backdrop-blur-xl border-b border-border/50 sticky top-0 z-50"
        style={{ '--top-nav-h': '68px' } as React.CSSProperties}
      >
        {/* AVS Yellow accent strip */}
        <div className="h-1 bg-gradient-to-r from-avs-yellow via-avs-yellow to-avs-yellow-hover"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {tabletModeEnabled ? (
            <div className="flex items-center h-16">
              <Link
                href="/dashboard"
                className="flex items-center group"
              >
                <div className="text-xl font-bold text-white group-hover:text-avs-yellow transition-colors">
                  SQUIRES
                </div>
              </Link>
              <div className="ml-auto hidden md:flex items-center">
                <TabletModeToggleActions />
              </div>
            </div>
          ) : (
          <div className="flex items-center h-16">
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

            {/* Desktop Navigation - Centered, auto-compacts to icon-only when space is tight */}
            <div ref={navRef} className="hidden md:flex flex-1 items-center justify-center space-x-1 overflow-hidden">
              {[...dashboardNav, ...employeeNav.filter(item => item.href !== '/help')].map((item) => {
                const Icon = item.icon;
                const isActive = isLinkActive(item.href);
                const activeColors = getNavItemActiveColors(item.href);
                const iconColorClass = getNavItemIconColor(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={item.label}
                    className={`group inline-flex items-center py-2 font-medium rounded-md transition-all duration-[225ms] ${
                      isActive
                        ? `${activeColors.bg} ${activeColors.text} text-sm px-3`
                        : isCompact
                          ? 'text-muted-foreground hover:bg-slate-800/50 hover:text-white px-3 text-sm'
                          : 'text-muted-foreground hover:bg-slate-800/50 hover:text-white text-[8px] hover:text-sm px-2 hover:px-3'
                    }`}
                  >
                    <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? '' : iconColorClass}`} />
                    <span className={
                      isCompact
                        ? `overflow-hidden whitespace-nowrap transition-all duration-[225ms] ${
                            isActive
                              ? 'ml-2 max-w-[120px] opacity-100'
                              : 'max-w-0 opacity-0 group-hover:ml-2 group-hover:max-w-[120px] group-hover:opacity-100'
                          }`
                        : 'ml-1.5 whitespace-nowrap'
                    }>
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>

            {/* Right side */}
            <div className="flex items-center space-x-2 ml-auto">
              {/* Tablet Mode toggle */}
              <div className="hidden md:flex items-center">
                <TabletModeToggleActions />
              </div>

              {/* Help link (desktop only) */}
              <Link
                href="/help"
                title="Help"
                className={`hidden md:inline-flex items-center justify-center rounded-md p-2 text-sm transition-colors ${
                  isLinkActive('/help')
                    ? 'bg-avs-yellow text-slate-900'
                    : 'text-muted-foreground hover:text-white hover:bg-slate-800/50'
                }`}
              >
                <HelpCircle className="w-4 h-4" />
              </Link>

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

              {/* Sign Out button (desktop only) */}
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
          )}
        </div>

        {/* Mobile menu */}
        {!tabletModeEnabled && mobileMenuOpen && (
          <div className="md:hidden border-t border-border/50 bg-slate-900/95 backdrop-blur-xl">
            <div className="px-2 pt-2 pb-3 space-y-1">
              {/* Dashboard + Employee Navigation */}
              {[...dashboardNav, ...employeeNav].map((item) => {
                const Icon = item.icon;
                const isActive = isLinkActive(item.href);
                const activeColors = getNavItemActiveColors(item.href);
                const iconColorClass = getNavItemIconColor(item.href);
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
                    <Icon className={`w-5 h-5 mr-3 ${isActive ? '' : iconColorClass}`} />
                    {item.label}
                  </Link>
                );
              })}
              
              {/* Manager/Admin Section (Mobile) */}
              {(managerLinks.length > 0 || adminLinks.length > 0) && (
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
                    const iconColorClass = getNavItemIconColor(item.href);
                    const badgeCount = item.href === '/absence/manage' ? pendingAbsenceCount : 0;
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
                        <Icon className={`w-5 h-5 mr-3 ${isActive ? '' : iconColorClass}`} />
                        <span>{item.label}</span>
                        {badgeCount > 0 && (
                          <span className="ml-auto min-w-[1.25rem] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] leading-none flex items-center justify-center font-semibold">
                            {badgeCount > 99 ? '99+' : badgeCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                  
                  {/* Admin Links */}
                  {adminLinks.length > 0 && (
                    <>
                      <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider mt-4">
                        Administration
                      </div>
                      {adminLinks.map((item) => {
                        const Icon = item.icon;
                        const isActive = isLinkActive(item.href);
                        const activeColors = getNavItemActiveColors(item.href);
                        const iconColorClass = getNavItemIconColor(item.href);
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
                            <Icon className={`w-5 h-5 mr-3 ${isActive ? '' : iconColorClass}`} />
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
        {!tabletModeEnabled && (
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
        )}
      </nav>
    </>
  );
}
