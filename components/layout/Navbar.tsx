'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useOfflineSync } from '@/lib/hooks/useOfflineSync';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  MessageSquare
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { NotificationPanel } from '@/components/messages/NotificationPanel';
import { SidebarNav } from './SidebarNav';

export function Navbar() {
  const pathname = usePathname();
  const { profile, signOut, isAdmin, isManager } = useAuth();
  const { isOnline, pendingCount } = useOfflineSync();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // Sidebar starts collapsed
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch notification count
  useEffect(() => {
    async function fetchNotificationCount() {
      try {
        const response = await fetch('/api/messages/notifications');
        const data = await response.json();
        if (data.success) {
          setUnreadCount(data.unread_count || 0);
        }
      } catch (error) {
        console.error('Error fetching notification count:', error);
      }
    }

    fetchNotificationCount();
    
    // Poll every 60 seconds for new notifications
    const interval = setInterval(fetchNotificationCount, 60000);
    return () => clearInterval(interval);
  }, []);

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

  // All users see the same navigation in top bar
  const dashboardNav = [
    { href: '/dashboard', label: 'Dashboard', icon: Home },
  ];
  
  const employeeNav = [
    { href: '/timesheets', label: 'Timesheets', icon: FileText },
    { href: '/inspections', label: 'Inspections', icon: ClipboardCheck },
    { href: '/absence', label: 'Absence & Leave', icon: Calendar },
  ];

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
                          ? 'bg-avs-yellow text-slate-900'
                          : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
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
                  const isActive = pathname?.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        isActive
                          ? 'bg-avs-yellow text-slate-900'
                          : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
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
                        ? 'bg-avs-yellow text-slate-900'
                        : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
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
                const isActive = pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center px-3 py-2 text-base font-medium rounded-md ${
                      isActive
                        ? 'bg-avs-yellow text-slate-900'
                        : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
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
                            ? 'bg-avs-yellow text-slate-900'
                            : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
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
                        const isActive = pathname?.startsWith(item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMobileMenuOpen(false)}
                            className={`flex items-center px-3 py-2 text-base font-medium rounded-md ${
                              isActive
                                ? 'bg-avs-yellow text-slate-900'
                                : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                            }`}
                          >
                            <Icon className="w-5 h-5 mr-3" />
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
              <div className="px-2">
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
