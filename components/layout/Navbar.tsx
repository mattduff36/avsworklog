'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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
  WifiOff,
  Wifi,
  CheckSquare
} from 'lucide-react';
import { useState } from 'react';

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut, isAdmin, isManager } = useAuth();
  const { isOnline, pendingCount } = useOfflineSync();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: Home },
    { href: '/timesheets', label: 'Timesheets', icon: FileText },
    { href: '/inspections', label: 'Inspections', icon: ClipboardCheck },
    ...(isManager ? [{ href: '/approvals', label: 'Approvals', icon: CheckSquare }] : []),
    ...(isManager ? [{ href: '/reports', label: 'Reports', icon: BarChart3 }] : []),
    ...(isAdmin ? [{ href: '/admin/users', label: 'Users', icon: Users }] : []),
  ];

  return (
    <nav className="bg-slate-900/50 backdrop-blur-xl border-b border-slate-700/50 sticky top-0 z-50">
      {/* AVS Yellow accent strip */}
      <div className="h-1 bg-gradient-to-r from-avs-yellow via-avs-yellow to-avs-yellow-hover"></div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link href="/dashboard" className="flex items-center space-x-2 group">
              <div className="text-xl font-bold text-white group-hover:text-avs-yellow transition-colors">
                Squires
              </div>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex md:ml-10 md:space-x-4">
              {navItems.map((item) => {
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

            {/* User info */}
            <div className="hidden md:flex items-center space-x-4">
              <div className="text-sm">
                <div className="font-medium text-white">{profile?.full_name}</div>
                <div className="text-slate-400 capitalize">
                  {profile?.role}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                className="text-slate-300 hover:text-white hover:bg-slate-800/50"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
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
            {navItems.map((item) => {
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
            <div className="px-4 space-y-1">
              <div className="text-base font-medium text-white">{profile?.full_name}</div>
              <div className="text-sm text-slate-400 capitalize">
                {profile?.role}
              </div>
            </div>
            <div className="mt-3 px-2">
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
    </nav>
  );
}

