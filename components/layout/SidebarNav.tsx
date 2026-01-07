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
  const [popoverOpen, setPopoverOpen] = useState(false);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);

  // Debug logging for sidebar state
  useEffect(() => {
    console.log('[SidebarNav] Sidebar state changed:', { open });
  }, [open]);

  // Debug logging for popover state
  useEffect(() => {
    console.log('[SidebarNav] Popover state changed:', { popoverOpen });
  }, [popoverOpen]);

  // Fetch user email and view as role
  useEffect(() => {
    async function fetchUserData() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        setUserEmail(user.email);
        console.log('[SidebarNav] User email fetched:', user.email);
      }
    }
    fetchUserData();
    
    const storedViewAs = localStorage.getItem('viewAsRole');
    if (storedViewAs) {
      setViewAsRole(storedViewAs);
      console.log('[SidebarNav] View as role loaded from storage:', storedViewAs);
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
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ pointerEvents: popoverOpen ? 'none' : (open ? 'auto' : 'none') }}
        onClick={(e) => {
          console.log('[SidebarNav] Backdrop clicked:', {
            sidebarOpen: open,
            target: e.target,
            currentTarget: e.currentTarget
          });
          onToggle();
        }}
        onMouseMove={(e) => {
          // Only log occasionally to avoid spam
          if (Math.random() < 0.01) {
            const elementAtCursor = document.elementFromPoint(e.clientX, e.clientY);
            console.log('[SidebarNav] Mouse over backdrop area, element at cursor:', {
              element: elementAtCursor,
              className: elementAtCursor?.className,
              x: e.clientX,
              y: e.clientY
            });
          }
        }}
      />

      {/* Sidebar - Always visible on desktop, hidden on mobile */}
      <div
        className={`hidden md:flex md:flex-col fixed left-0 top-[68px] bottom-0 bg-slate-900 border-r border-slate-700 z-[70] transition-all duration-300 ease-in-out ${
          open ? 'w-64' : 'w-16'
        }`}
        style={{ pointerEvents: popoverOpen ? 'none' : 'auto' }}
      >
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-3 border-b border-slate-700">
          <h2 className={`text-lg font-semibold text-white transition-opacity duration-200 ${
            open ? 'opacity-100 delay-300' : 'opacity-0 w-0 overflow-hidden'
          }`}>
            {isManager ? 'Manager Menu' : 'Admin Tools'}
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
        <div 
          className={`overflow-y-auto py-4 ${isSuperAdmin ? 'h-[calc(100vh-10rem)]' : 'h-[calc(100vh-8.25rem)]'}`}
          style={{ pointerEvents: popoverOpen ? 'none' : 'auto' }}
        >
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
                        ? 'bg-avs-yellow text-slate-900 [&>svg]:text-slate-900'
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

        {/* View As Selector - SuperAdmin Only (Bottom) */}
        {isSuperAdmin && (
          <div 
            className="border-t border-slate-700 p-3 mt-auto relative z-[75]"
            style={{ pointerEvents: 'auto' }}
            onClick={(e) => {
              console.log('[SidebarNav] Container clicked:', {
                target: e.target,
                currentTarget: e.currentTarget,
                sidebarOpen: open,
                popoverOpen
              });
            }}
            onMouseEnter={() => {
              console.log('[SidebarNav] Container mouse enter - checking z-index');
              const container = document.querySelector('.border-t.border-slate-700.p-3.mt-auto');
              if (container) {
                const styles = window.getComputedStyle(container);
                console.log('[SidebarNav] Container computed styles:', {
                  zIndex: styles.zIndex,
                  position: styles.position,
                  pointerEvents: styles.pointerEvents
                });
              }
            }}
          >
            <Popover 
              open={popoverOpen} 
              onOpenChange={(isOpen) => {
                console.log('[SidebarNav] Popover onOpenChange called:', {
                  newState: isOpen,
                  oldState: popoverOpen,
                  sidebarOpen: open
                });
                setPopoverOpen(isOpen);
              }}
              modal={false}
            >
              <PopoverTrigger asChild>
                {open ? (
                  <Button
                    ref={triggerButtonRef}
                    variant="outline"
                    className="w-full justify-start gap-2 bg-slate-800/50 border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white text-xs h-9"
                    onClick={(e) => {
                      console.log('[SidebarNav] Button clicked (expanded mode):', {
                        event: e,
                        sidebarOpen: open,
                        popoverOpen,
                        button: e.currentTarget
                      });
                      
                      // If popover is already open, prevent the toggle and keep it open
                      if (popoverOpen) {
                        console.log('[SidebarNav] Popover already open - preventing toggle');
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                      }
                      
                      // Check if button is actually clickable
                      const rect = e.currentTarget.getBoundingClientRect();
                      console.log('[SidebarNav] Button position:', {
                        top: rect.top,
                        left: rect.left,
                        width: rect.width,
                        height: rect.height,
                        bottom: rect.bottom,
                        right: rect.right
                      });
                      // Check what element is actually at this position
                      const elementAtPoint = document.elementFromPoint(
                        rect.left + rect.width / 2,
                        rect.top + rect.height / 2
                      );
                      console.log('[SidebarNav] Element at button center:', elementAtPoint);
                    }}
                    onMouseEnter={(e) => {
                      console.log('[SidebarNav] Button mouse enter (expanded)');
                      const styles = window.getComputedStyle(e.currentTarget);
                      console.log('[SidebarNav] Button computed styles:', {
                        zIndex: styles.zIndex,
                        position: styles.position,
                        pointerEvents: styles.pointerEvents
                      });
                    }}
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
                    ref={triggerButtonRef}
                    variant="ghost"
                    size="sm"
                    className="w-full h-10 p-0 hover:bg-slate-800"
                    title="View As"
                    onClick={(e) => {
                      console.log('[SidebarNav] Button clicked (collapsed mode):', {
                        event: e,
                        sidebarOpen: open,
                        popoverOpen
                      });
                      
                      // If popover is already open, prevent the toggle
                      if (popoverOpen) {
                        console.log('[SidebarNav] Popover already open - preventing toggle');
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                      }
                    }}
                  >
                    <Eye className="w-5 h-5 text-slate-400 hover:text-white" />
                  </Button>
                )}
              </PopoverTrigger>
              <PopoverContent 
                side={open ? "top" : "right"} 
                align={open ? "center" : "start"}
                sideOffset={open ? 8 : 12}
                alignOffset={open ? 0 : -8}
                className="w-56 p-2 bg-slate-900 border-slate-700 z-[9999]"
                onOpenAutoFocus={(e) => {
                  console.log('[SidebarNav] Popover auto focus event');
                  e.preventDefault();
                }}
                onInteractOutside={(e) => {
                  const target = e.target as HTMLElement;
                  console.log('[SidebarNav] Popover interact outside:', target);
                  console.log('[SidebarNav] Trigger button ref:', triggerButtonRef.current);
                  
                  // Check if the interaction is with the trigger button or its children
                  if (triggerButtonRef.current?.contains(target)) {
                    console.log('[SidebarNav] ✅ Interaction is with trigger button - PREVENTING CLOSE');
                    e.preventDefault();
                  } else {
                    console.log('[SidebarNav] ❌ Interaction is outside - allowing close');
                  }
                }}
                onEscapeKeyDown={(e) => {
                  console.log('[SidebarNav] Popover escape key pressed');
                }}
                style={{ pointerEvents: 'auto', zIndex: 9999 }}
              >
                <div className="space-y-1">
                  <div className="px-2 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
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
                        onClick={(e) => {
                          console.log('[SidebarNav] Role option clicked:', role.value);
                          e.preventDefault();
                          e.stopPropagation();
                          setViewAsRole(role.value as ViewAsRole);
                          localStorage.setItem('viewAsRole', role.value);
                          // Refresh page to apply new view
                          setTimeout(() => window.location.reload(), 100);
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-avs-yellow text-slate-900'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="flex-1 text-left">{role.label}</span>
                        {isActive && <Check className="w-4 h-4" />}
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

