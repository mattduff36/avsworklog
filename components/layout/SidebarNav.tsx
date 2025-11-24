'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  BarChart3,
  Users,
  CheckSquare,
  ListTodo,
  Truck,
  MessageSquare,
  PanelLeftClose,
  Bug
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface SidebarNavProps {
  open: boolean;
  onToggle: () => void;
}

export function SidebarNav({ open, onToggle }: SidebarNavProps) {
  const pathname = usePathname();
  const { isAdmin, isManager } = useAuth();
  const supabase = createClient();
  const [userEmail, setUserEmail] = useState<string>('');
  const [viewAsRole, setViewAsRole] = useState<string>('actual');

  // Fetch user email and view as role
  useEffect(() => {
    async function fetchUserData() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        setUserEmail(user.email);
      }
    }
    fetchUserData();
    
    const storedViewAs = localStorage.getItem('viewAsRole');
    if (storedViewAs) {
      setViewAsRole(storedViewAs);
    }
  }, [supabase]);

  // Collapse sidebar on route change (don't close completely)
  useEffect(() => {
    if (open) {
      onToggle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!isManager) return null;

  const isSuperAdmin = userEmail === 'admin@mpdee.co.uk';
  const showDeveloperTools = isSuperAdmin && viewAsRole === 'actual';

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
      {/* Backdrop - only show when expanded */}
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onToggle}
      />

      {/* Sidebar - Always visible on desktop, hidden on mobile */}
      <div
        className={`hidden md:block fixed left-0 top-[68px] bottom-0 bg-slate-900 border-r border-slate-700 z-[70] transition-all duration-300 ease-in-out ${
          open ? 'w-64' : 'w-16'
        }`}
      >
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-3 border-b border-slate-700">
          <h2 className={`text-lg font-semibold text-white transition-opacity duration-200 ${
            open ? 'opacity-100 delay-300' : 'opacity-0 w-0 overflow-hidden'
          }`}>
            Manager Menu
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className="text-slate-300 hover:text-white hover:bg-slate-800"
            title={open ? 'Collapse menu' : 'Expand menu'}
          >
            <PanelLeftClose className={`h-5 w-5 transition-transform duration-300 ${open ? '' : 'rotate-180'}`} />
          </Button>
        </div>

        {/* Navigation */}
        <div className="overflow-y-auto h-[calc(100vh-8.25rem)] py-4">
          {/* Manager Links */}
          <div className={open ? 'px-3 mb-6' : 'px-2 mb-6'}>
            <div className={`px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider transition-opacity duration-200 ${
              open ? 'opacity-100 delay-300' : 'opacity-0 h-0 overflow-hidden'
            }`}>
              Management
            </div>
            <div className="space-y-1">
              {managerLinks.map((link) => {
                const Icon = link.icon;
                const isActive = pathname?.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    title={!open ? link.label : undefined}
                    className={`flex items-center rounded-md text-sm font-medium transition-colors ${
                      open ? 'gap-3 px-3 py-2' : 'justify-center py-3'
                    } ${
                      isActive
                        ? 'bg-avs-yellow text-slate-900'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon className={open ? 'w-4 h-4' : 'w-5 h-5'} />
                    <span className={`transition-opacity duration-200 whitespace-nowrap ${
                      open ? 'opacity-100 delay-300' : 'opacity-0 w-0 overflow-hidden'
                    }`}>
                      {link.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Admin Links */}
          {isAdmin && (
            <div className={open ? 'px-3 mb-6' : 'px-2 mb-6'}>
              <div className={`px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider transition-opacity duration-200 ${
                open ? 'opacity-100 delay-300' : 'opacity-0 h-0 overflow-hidden'
              }`}>
                Administration
              </div>
              <div className="space-y-1">
                {adminLinks.map((link) => {
                  const Icon = link.icon;
                  const isActive = pathname?.startsWith(link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      title={!open ? link.label : undefined}
                      className={`flex items-center rounded-md text-sm font-medium transition-colors ${
                        open ? 'gap-3 px-3 py-2' : 'justify-center py-3'
                      } ${
                        isActive
                          ? 'bg-avs-yellow text-slate-900'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <Icon className={open ? 'w-4 h-4' : 'w-5 h-5'} />
                      <span className={`transition-opacity duration-200 whitespace-nowrap ${
                        open ? 'opacity-100 delay-300' : 'opacity-0 w-0 overflow-hidden'
                      }`}>
                        {link.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Developer Tools - SuperAdmin Only */}
          {showDeveloperTools && (
            <div className={open ? 'px-3' : 'px-2'}>
              <div className={`px-3 py-2 text-xs font-semibold text-orange-400 uppercase tracking-wider transition-opacity duration-200 ${
                open ? 'opacity-100 delay-300' : 'opacity-0 h-0 overflow-hidden'
              }`}>
                Developer
              </div>
              <div className="space-y-1">
                <Link
                  href="/debug"
                  title={!open ? 'Debug Console' : undefined}
                  className={`flex items-center rounded-md text-sm font-medium transition-colors ${
                    open ? 'gap-3 px-3 py-2' : 'justify-center py-3'
                  } ${
                    pathname === '/debug'
                      ? 'bg-orange-500 text-white'
                      : 'text-orange-300 hover:bg-slate-800 hover:text-orange-200'
                  }`}
                >
                  <Bug className={open ? 'w-4 h-4' : 'w-5 h-5'} />
                  <span className={`transition-opacity duration-200 whitespace-nowrap ${
                    open ? 'opacity-100 delay-300' : 'opacity-0 w-0 overflow-hidden'
                  }`}>
                    Debug Console
                  </span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

