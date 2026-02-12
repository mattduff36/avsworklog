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
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { managerNavItems, adminNavItems } from '@/lib/config/navigation';
import { getViewAsRoleId, setViewAsRoleId } from '@/lib/utils/view-as-cookie';

interface RoleOption {
  id: string;
  name: string;
  display_name: string;
  is_super_admin: boolean;
  is_manager_admin: boolean;
}

interface SidebarNavProps {
  open: boolean;
  onToggle: () => void;
}

export function SidebarNav({ open, onToggle }: SidebarNavProps) {
  const pathname = usePathname();
  const { isAdmin, isManager } = useAuth();
  const supabase = createClient();
  const [userEmail, setUserEmail] = useState<string>('');
  const [viewAsRoleId, setViewAsRoleIdState] = useState<string>('');
  const [allRoles, setAllRoles] = useState<RoleOption[]>([]);

  // Fetch user email, all roles, and current view-as selection
  useEffect(() => {
    async function fetchUserData() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        setUserEmail(user.email);
      }
    }
    fetchUserData();

    // Fetch all roles for the View As menu
    async function fetchRoles() {
      const { data, error } = await supabase
        .from('roles')
        .select('id, name, display_name, is_super_admin, is_manager_admin')
        .order('is_super_admin', { ascending: false })
        .order('is_manager_admin', { ascending: false })
        .order('display_name', { ascending: true });
      if (!error && data) {
        setAllRoles(data);
      }
    }
    fetchRoles();

    // Read current selection from cookie (or legacy localStorage)
    const cookieVal = getViewAsRoleId();
    if (cookieVal) {
      setViewAsRoleIdState(cookieVal);
    } else {
      // Migrate legacy localStorage value if present
      const legacy = localStorage.getItem('viewAsRole');
      if (legacy && legacy !== 'actual') {
        // Can't auto-map old string names to UUIDs – just clear
        localStorage.removeItem('viewAsRole');
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
  const isViewingAsOtherRole = isSuperAdmin && viewAsRoleId !== '';
  const showDeveloperTools = isSuperAdmin && !isViewingAsOtherRole;

  // Find the currently-selected role object for display
  const selectedRole = allRoles.find((r) => r.id === viewAsRoleId) ?? null;
  
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
                    className={`w-full justify-start gap-2 border-border text-xs h-9 ${
                      isViewingAsOtherRole
                        ? 'bg-amber-600/30 border-amber-500/50 text-amber-200 hover:bg-amber-600/40 hover:text-amber-100'
                        : 'bg-slate-800/50 text-muted-foreground hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    <Eye className="w-4 h-4 flex-shrink-0" />
                    <span className="flex-1 text-left truncate">
                      {selectedRole ? `View as ${selectedRole.display_name}` : 'Actual Role'}
                    </span>
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`w-full h-10 p-0 ${isViewingAsOtherRole ? 'bg-amber-600/30' : 'hover:bg-slate-800'}`}
                    title="View As"
                  >
                    <Eye className={`w-5 h-5 ${isViewingAsOtherRole ? 'text-amber-300' : 'text-slate-400 hover:text-white'}`} />
                  </Button>
                )}
              </PopoverTrigger>
              <PopoverContent 
                side="right"
                align="start"
                sideOffset={12}
                className="w-64 p-2 bg-slate-900 border border-slate-700 shadow-2xl max-h-[70vh] overflow-y-auto"
                style={{ zIndex: 999999, color: '#e2e8f0' }}
              >
                <div className="space-y-1">
                  <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#cbd5e1' }}>
                    View As Role
                  </div>
                  {/* Actual Role (reset) */}
                  <button
                    type="button"
                    onClick={() => {
                      setViewAsRoleIdState('');
                      setViewAsRoleId('');
                      setTimeout(() => window.location.reload(), 100);
                    }}
                    className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                      viewAsRoleId === '' ? 'bg-avs-yellow' : 'hover:bg-slate-800 hover:text-white'
                    }`}
                    style={viewAsRoleId === '' ? { color: '#0f172a' } : { color: '#e2e8f0' }}
                  >
                    <Crown className="w-4 h-4" style={viewAsRoleId === '' ? { color: '#0f172a' } : { color: '#e2e8f0' }} />
                    <span className="flex-1 text-left" style={viewAsRoleId === '' ? { color: '#0f172a' } : { color: '#e2e8f0' }}>
                      Actual Role (SuperAdmin)
                    </span>
                    {viewAsRoleId === '' && <Check className="w-4 h-4" style={{ color: '#0f172a' }} />}
                  </button>

                  <div className="border-t border-slate-700 my-1" />

                  {/* All roles from database */}
                  {allRoles.map((role) => {
                    const isActive = viewAsRoleId === role.id;
                    const RoleIcon = role.is_super_admin ? Shield : role.is_manager_admin ? Users : User;
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => {
                          setViewAsRoleIdState(role.id);
                          setViewAsRoleId(role.id);
                          setTimeout(() => window.location.reload(), 100);
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                          isActive ? 'bg-avs-yellow' : 'hover:bg-slate-800 hover:text-white'
                        }`}
                        style={isActive ? { color: '#0f172a' } : { color: '#e2e8f0' }}
                      >
                        <RoleIcon className="w-4 h-4 flex-shrink-0" style={isActive ? { color: '#0f172a' } : { color: '#e2e8f0' }} />
                        <span className="flex-1 text-left truncate" style={isActive ? { color: '#0f172a' } : { color: '#e2e8f0' }}>
                          {role.display_name}
                        </span>
                        {isActive && <Check className="w-4 h-4 flex-shrink-0" style={{ color: '#0f172a' }} />}
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

