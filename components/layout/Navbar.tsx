'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useOfflineSync } from '@/lib/hooks/useOfflineSync';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  Menu, 
  X, 
  Home, 
  FileText, 
  ClipboardCheck, 
  BarChart3, 
  Users, 
  LogOut,
  WifiOff,
  Wifi,
  CheckSquare,
  ListTodo,
  FolderOpen,
  ChevronDown,
  Truck,
  FileCheck2,
  Calendar,
  Bell,
  MessageSquare
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { NotificationPanel } from '@/components/messages/NotificationPanel';

export function Navbar() {
  const pathname = usePathname();
  const { profile, signOut, isAdmin, isManager } = useAuth();
  const { isOnline, pendingCount } = useOfflineSync();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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

  // Split navigation for proper ordering with Forms dropdown
  const dashboardNav = [
    { href: '/dashboard', label: 'Dashboard', icon: Home },
  ];
  
  const employeeNav = !isManager ? [
    { href: '/timesheets', label: 'Timesheets', icon: FileText },
    { href: '/inspections', label: 'Inspections', icon: ClipboardCheck },
    { href: '/absence', label: 'Absence & Leave', icon: Calendar },
  ] : [];
  
  const managerNav = isManager ? [
    { href: '/approvals', label: 'Approvals', icon: CheckSquare },
    { href: '/actions', label: 'Actions', icon: ListTodo },
    { href: '/toolbox-talks', label: 'Toolbox Talks', icon: MessageSquare },
    { href: '/reports', label: 'Reports', icon: BarChart3 },
  ] : [];
  
  const adminNav = isAdmin ? [
    { href: '/admin/users', label: 'Users', icon: Users },
    { href: '/admin/vehicles', label: 'Vehicles', icon: Truck },
  ] : [];

  return (
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

            {/* Desktop Navigation */}
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
              
              {/* Employee Navigation (Timesheets/Inspections) */}
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
              
              {/* Forms Dropdown - Manager/Admin only */}
              {isManager && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        pathname?.startsWith('/timesheets') || pathname?.startsWith('/inspections') || pathname?.startsWith('/rams') || pathname?.startsWith('/absence')
                          ? 'bg-avs-yellow text-slate-900'
                          : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                      }`}
                    >
                      <FolderOpen className="w-4 h-4 mr-2" />
                      Forms
                      <ChevronDown className="w-4 h-4 ml-1" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48 bg-slate-800 border-slate-700">
                    <DropdownMenuItem asChild>
                      <Link href="/timesheets" className="flex items-center cursor-pointer">
                        <FileText className="w-4 h-4 mr-2" />
                        Timesheets
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/inspections" className="flex items-center cursor-pointer">
                        <ClipboardCheck className="w-4 h-4 mr-2" />
                        Inspections
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/rams" className="flex items-center cursor-pointer">
                        <FileCheck2 className="w-4 h-4 mr-2" />
                        RAMS Documents
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/absence" className="flex items-center cursor-pointer">
                        <Calendar className="w-4 h-4 mr-2" />
                        Absence & Leave
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              
              {/* Manager/Admin Navigation */}
              {[...managerNav, ...adminNav].map((item) => {
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
                <Wifi className="w-4 h-4 text-green-400" />
              ) : (
                <div className="flex items-center space-x-2">
                  <WifiOff className="w-4 h-4 text-amber-400" />
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
            
            {/* Forms Section - Manager/Admin only (Mobile) */}
            {isManager && (
              <>
                <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Forms
                </div>
                <Link
                  href="/timesheets"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center px-3 py-2 pl-6 text-base font-medium rounded-md ${
                    pathname?.startsWith('/timesheets')
                      ? 'bg-avs-yellow text-slate-900'
                      : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                  }`}
                >
                  <FileText className="w-5 h-5 mr-3" />
                  Timesheets
                </Link>
                <Link
                  href="/inspections"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center px-3 py-2 pl-6 text-base font-medium rounded-md ${
                    pathname?.startsWith('/inspections')
                      ? 'bg-avs-yellow text-slate-900'
                      : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                  }`}
                >
                  <ClipboardCheck className="w-5 h-5 mr-3" />
                  Inspections
                </Link>
                <Link
                  href="/rams"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center px-3 py-2 pl-6 text-base font-medium rounded-md ${
                    pathname?.startsWith('/rams')
                      ? 'bg-avs-yellow text-slate-900'
                      : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                  }`}
                >
                  <FileCheck2 className="w-5 h-5 mr-3" />
                  RAMS Documents
                </Link>
                <Link
                  href="/absence"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center px-3 py-2 pl-6 text-base font-medium rounded-md ${
                    pathname?.startsWith('/absence')
                      ? 'bg-avs-yellow text-slate-900'
                      : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                  }`}
                >
                  <Calendar className="w-5 h-5 mr-3" />
                  Absence & Leave
                </Link>
              </>
            )}
            
            {/* Manager/Admin Navigation */}
            {[...managerNav, ...adminNav].map((item) => {
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
  );
}

