'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  PanelLeftClose,
  Bug,
  Eye,
  Crown,
  User,
  Users,
  Shield,
  Check
} from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { managerNavItems, adminNavItems } from '@/lib/config/navigation';

type ViewAsRole = 'actual' | 'employee' | 'manager' | 'admin';

interface SidebarNavProps {
  open: boolean;
  onToggle: () => void;
}

export function SidebarNav({ open, onToggle }: SidebarNavProps) {
  const pathname = usePathname();
  const { isAdmin, isManager } = useAuth();
  const supabase = createClient();
  const [userEmail, setUserEmail] = useState<string>('');
  const [viewAsRole, setViewAsRole] = useState<ViewAsRole>('actual');


  // Fetch user email and view as role
  useEffect(() => {
    async function fetchUserData() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        setUserEmail(user.email);
      }
    }
    fetchUserData();
    
    // Retrieve and validate stored View As preference
    const storedViewAs = localStorage.getItem('viewAsRole');
    if (storedViewAs) {
      // Validate it's a valid ViewAsRole value before using it
      const validRoles: ViewAsRole[] = ['actual', 'employee', 'manager', 'admin'];
      if (validRoles.includes(storedViewAs as ViewAsRole)) {
        setViewAsRole(storedViewAs as ViewAsRole);
      }
    }
  }, [supabase]);

  // Collapse sidebar on route change (don't close completely)
  useEffect(() => {
    if (open) {
      onToggle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const isSuperAdmin = userEmail === 'admin@mpdee.co.uk';
  const showDeveloperTools = isSuperAdmin && viewAsRole === 'actual';
  
  // Show sidebar for managers/admins or superadmins (who need View As feature)
  if (!isManager && !isSuperAdmin) return null;

  // Use shared navigation config
  const managerLinks = managerNavItems;
  const adminLinks = isAdmin ? adminNavItems : [];

  return (
    <>
      {/* Backdrop - only show when expanded */}
      <div
        className={`fixed inset-0 bg-black/50 z-[60] transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onToggle}
      />

      {/* Sidebar - Always visible on desktop, hidden on mobile */}
      <div
        className={`hidden md:flex md:flex-col fixed left-0 top-[68px] bottom-0 bg-slate-900 border-r border-slate-700 z-[70] transition-all duration-300 ease-in-out ${
          open ? 'w-64' : 'w-16'
        }`}
      >
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-3 border-b border-border">
          <h2 className={`text-lg font-semibold text-white transition-opacity duration-200 ${
            open ? 'opacity-100 delay-300' : 'opacity-0 w-0 overflow-hidden'
          }`}>
            {isManager ? 'Manager Menu' : 'Admin Tools'}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className="text-muted-foreground hover:text-white hover:bg-slate-800"
            title={open ? 'Collapse menu' : 'Expand menu'}
          >
            <PanelLeftClose className={`h-5 w-5 transition-transform duration-300 ${open ? '' : 'rotate-180'}`} />
          </Button>
        </div>

        {/* Navigation */}
        <div className={`overflow-y-auto py-4 ${isSuperAdmin ? 'h-[calc(100vh-10rem)]' : 'h-[calc(100vh-8.25rem)]'}`}>
          {/* Manager Links */}
          {isManager && (
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
                        : 'text-muted-foreground hover:bg-slate-800 hover:text-white'
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
                          ? 'bg-avs-yellow text-slate-900 [&>svg]:text-slate-900'
                          : 'text-muted-foreground hover:bg-slate-800 hover:text-white'
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
              <div className={`px-3 py-2 text-xs font-semibold text-red-500 uppercase tracking-wider transition-opacity duration-200 ${
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
                      ? 'bg-red-600 text-white'
                      : 'text-red-500 hover:bg-slate-800 hover:text-red-400'
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

        {/* View As Selector - SuperAdmin Only (Bottom) */}
        {isSuperAdmin && (
          <div className="border-t border-slate-700 p-3 mt-auto">
            <Popover>
              <PopoverTrigger asChild>
                {open ? (
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2 bg-slate-800/50 border-border text-muted-foreground hover:bg-slate-700 hover:text-white text-xs h-9"
                  >
                    <Eye className="w-4 h-4 flex-shrink-0" />
                    <span className="flex-1 text-left truncate">
                      {viewAsRole === 'actual' && 'Actual Role'}
                      {viewAsRole === 'employee' && 'View as Employee'}
                      {viewAsRole === 'manager' && 'View as Manager'}
                      {viewAsRole === 'admin' && 'View as Admin'}
                    </span>
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-10 p-0 hover:bg-slate-800"
                    title="View As"
                  >
                    <Eye className="w-5 h-5 text-slate-400 hover:text-white" />
                  </Button>
                )}
              </PopoverTrigger>
              <PopoverContent 
                side="right"
                align="start"
                sideOffset={12}
                className="w-56 p-2 bg-slate-900 border border-slate-700 shadow-2xl"
                style={{ zIndex: 999999, color: '#e2e8f0' }}
              >
                <div className="space-y-1">
                  <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#cbd5e1' }}>
                    View As
                  </div>
                  {[
                    { value: 'actual', label: 'Actual Role', icon: Crown },
                    { value: 'employee', label: 'Employee', icon: User },
                    { value: 'manager', label: 'Manager', icon: Users },
                    { value: 'admin', label: 'Admin', icon: Shield },
                  ].map((role) => {
                    const Icon = role.icon;
                    const isActive = viewAsRole === role.value;
                    return (
                      <button
                        key={role.value}
                        type="button"
                        onClick={() => {
                          setViewAsRole(role.value as ViewAsRole);
                          localStorage.setItem('viewAsRole', role.value);
                          setTimeout(() => window.location.reload(), 100);
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                          isActive
                            ? 'bg-avs-yellow'
                            : 'hover:bg-slate-800 hover:text-white'
                        }`}
                        style={isActive ? { color: '#0f172a' } : { color: '#e2e8f0' }}
                      >
                        <Icon className="w-4 h-4" style={isActive ? { color: '#0f172a' } : { color: '#e2e8f0' }} />
                        <span className="flex-1 text-left" style={isActive ? { color: '#0f172a' } : { color: '#e2e8f0' }}>{role.label}</span>
                        {isActive && <Check className="w-4 h-4" style={{ color: '#0f172a' }} />}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
    </>
  );
}

