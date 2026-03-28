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
import { useCallback, useEffect, useState, useRef } from 'react';
import { usePermissionSnapshot } from '@/lib/hooks/usePermissionSnapshot';
import { usePendingAbsenceCount } from '@/lib/hooks/useNavMetrics';
import { managerNavItems, adminNavItems, getFilteredNavByPermissions } from '@/lib/config/navigation';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import {
  clearViewAsSelection,
  getViewAsSelection,
  setViewAsSelection,
} from '@/lib/utils/view-as-cookie';

interface RoleOption {
  id: string;
  name: string;
  display_name: string;
  is_super_admin: boolean;
  is_manager_admin: boolean;
}

interface TeamOption {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
}

interface SidebarNavProps {
  open: boolean;
  onToggle: () => void;
}

const HOVER_EXPAND_DELAY_MS = 1000;

export function SidebarNav({ open, onToggle }: SidebarNavProps) {
  const pathname = usePathname();
  const { isAdmin, isManager, effectiveRole, isViewingAs, isActualSuperAdmin } = useAuth();
  const { tabletModeEnabled } = useTabletMode();
  const [viewAsRoleId, setViewAsRoleIdState] = useState<string>('');
  const [viewAsTeamId, setViewAsTeamIdState] = useState<string>('');
  const [draftRoleId, setDraftRoleId] = useState<string>('');
  const [draftTeamId, setDraftTeamId] = useState<string>('');
  const [allRoles, setAllRoles] = useState<RoleOption[]>([]);
  const [allTeams, setAllTeams] = useState<TeamOption[]>([]);
  const [viewAsMenuOpen, setViewAsMenuOpen] = useState(false);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [viewAsMenuPosition, setViewAsMenuPosition] = useState({ left: 0, bottom: 12, maxHeight: 320 });
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const viewAsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const viewAsMenuRef = useRef<HTMLDivElement | null>(null);
  const hoverExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { enabledModuleSet: userPermissions } = usePermissionSnapshot();
  const { count: pendingAbsenceCount } = usePendingAbsenceCount(isManager || isAdmin);
  const isExpanded = open || hoverExpanded;

  const clearHoverExpandTimer = useCallback(() => {
    if (hoverExpandTimerRef.current) {
      clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }
  }, []);

  const isInsideSidebarHoverZone = useCallback((target: Node | null) => {
    if (!target) return false;

    return Boolean(
      sidebarRef.current?.contains(target) ||
      viewAsMenuRef.current?.contains(target)
    );
  }, []);

  const handleSidebarMouseEnter = useCallback(() => {
    if (open || hoverExpanded || hoverExpandTimerRef.current) return;

    hoverExpandTimerRef.current = setTimeout(() => {
      setHoverExpanded(true);
      hoverExpandTimerRef.current = null;
    }, HOVER_EXPAND_DELAY_MS);
  }, [open, hoverExpanded]);

  const handleSidebarMouseLeave = useCallback((relatedTarget: Node | null) => {
    clearHoverExpandTimer();
    if (isInsideSidebarHoverZone(relatedTarget) || open) return;

    setHoverExpanded(false);
    setViewAsMenuOpen(false);
  }, [clearHoverExpandTimer, isInsideSidebarHoverZone, open]);

  const handleViewAsMenuMouseLeave = useCallback((relatedTarget: Node | null) => {
    if (isInsideSidebarHoverZone(relatedTarget) || open) return;

    clearHoverExpandTimer();
    setHoverExpanded(false);
    setViewAsMenuOpen(false);
  }, [isInsideSidebarHoverZone, open, clearHoverExpandTimer]);

  const handleNavLinkClick = useCallback(() => {
    clearHoverExpandTimer();
    setHoverExpanded(false);
    setViewAsMenuOpen(false);
  }, [clearHoverExpandTimer]);

  const handleBackdropClick = useCallback(() => {
    if (open) {
      onToggle();
      return;
    }

    clearHoverExpandTimer();
    setHoverExpanded(false);
    setViewAsMenuOpen(false);
  }, [open, onToggle, clearHoverExpandTimer]);

  // Fetch user email, all roles, and current view-as selection
  useEffect(() => {
    if (tabletModeEnabled) return;

    async function fetchViewAsOptions() {
      try {
        const response = await fetch('/api/superadmin/view-as/options', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to load view-as options');
        }

        queueMicrotask(() => {
          setAllRoles((data.roles || []) as RoleOption[]);
          setAllTeams((data.teams || []) as TeamOption[]);
        });
      } catch {
        queueMicrotask(() => {
          setAllRoles([]);
          setAllTeams([]);
        });
      }
    }
    fetchViewAsOptions();

    // Read current selection from cookie (or legacy localStorage)
    const { roleId, teamId } = getViewAsSelection();
    queueMicrotask(() => {
      setViewAsRoleIdState(roleId);
      setViewAsTeamIdState(teamId);
      setDraftRoleId(roleId);
      setDraftTeamId(teamId);
    });
    if (!roleId) {
      // Migrate legacy localStorage value if present
      const legacy = localStorage.getItem('viewAsRole');
      if (legacy && legacy !== 'actual') {
        // Can't auto-map old string names to UUIDs – just clear
        localStorage.removeItem('viewAsRole');
      }
    }
  }, [effectiveRole?.name, effectiveRole?.is_super_admin, isViewingAs, isManager, isAdmin, tabletModeEnabled]);

  useEffect(
    () => () => {
      clearHoverExpandTimer();
    },
    [clearHoverExpandTimer]
  );

  // Keep transient hover state clean on route changes
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      setViewAsMenuOpen(false);
      clearHoverExpandTimer();
      setHoverExpanded(false);
    }
  }, [pathname, clearHoverExpandTimer]);

  useEffect(() => {
    if (!viewAsMenuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (viewAsTriggerRef.current?.contains(target) || viewAsMenuRef.current?.contains(target)) {
        return;
      }
      setViewAsMenuOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setViewAsMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [viewAsMenuOpen]);

  const updateViewAsMenuPosition = useCallback(() => {
    const triggerRect = viewAsTriggerRef.current?.getBoundingClientRect();
    if (!triggerRect) return;

    const viewportHeight = window.innerHeight;
    const bottomOffset = Math.max(12, Math.round(viewportHeight - triggerRect.bottom));
    const maxHeight = Math.max(240, viewportHeight - bottomOffset - 24);

    setViewAsMenuPosition({
      left: Math.round(triggerRect.right + (isExpanded ? 16 : 12)),
      bottom: bottomOffset,
      maxHeight,
    });
  }, [isExpanded]);

  useEffect(() => {
    if (!viewAsMenuOpen) return;

    updateViewAsMenuPosition();

    function syncPosition() {
      updateViewAsMenuPosition();
    }

    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);
    return () => {
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
    };
  }, [viewAsMenuOpen, isExpanded, updateViewAsMenuPosition]);

  const isSuperAdmin = isActualSuperAdmin;
  const isViewingAsOverride = isSuperAdmin && (viewAsRoleId !== '' || viewAsTeamId !== '');
  const showDeveloperTools = isSuperAdmin && !isViewingAsOverride;

  if (tabletModeEnabled) return null;

  // Find the currently-selected role object for display
  const selectedRole = allRoles.find((r) => r.id === viewAsRoleId) ?? null;
  const selectedTeam = allTeams.find((team) => team.id === viewAsTeamId) ?? null;
  const draftRole = allRoles.find((r) => r.id === draftRoleId) ?? null;
  const draftTeam = allTeams.find((team) => team.id === draftTeamId) ?? null;
  
  // Show sidebar for managers/admins or superadmins (who need View As feature)
  if (!isManager && !isAdmin && !isSuperAdmin) return null;

  const managerLinks = getFilteredNavByPermissions(managerNavItems, userPermissions, isAdmin);
  const sidebarManagerLinks = managerLinks.filter((link) => link.href !== '/absence/manage');
  const adminLinks = getFilteredNavByPermissions(adminNavItems, userPermissions, isAdmin);
  const hasAnyManagementLinks = sidebarManagerLinks.length > 0 || adminLinks.length > 0;
  const showSidebar = hasAnyManagementLinks || showDeveloperTools;

  const selectionSummary =
    selectedRole || selectedTeam
      ? [selectedRole?.display_name, selectedTeam?.name].filter(Boolean).join(' / ')
      : 'Actual Role & Team';
  const draftSummary =
    draftRole || draftTeam
      ? [draftRole?.display_name, draftTeam?.name].filter(Boolean).join(' / ')
      : 'Actual Role & Team';

  const applyViewAsSelection = () => {
    setViewAsSelection({
      roleId: draftRoleId,
      teamId: draftTeamId,
    });
    setViewAsRoleIdState(draftRoleId);
    setViewAsTeamIdState(draftTeamId);
    setTimeout(() => window.location.reload(), 100);
  };

  const viewAsPopoverContent = (
    <div className="space-y-3">
      <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#cbd5e1' }}>
        View As
      </div>
      <div className="px-2 text-xs" style={{ color: '#94a3b8' }}>
        Select both a role and team to mirror that combination.
      </div>
      <button
        type="button"
        onClick={() => {
          setDraftRoleId('');
          setDraftTeamId('');
        }}
        className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
          draftRoleId === '' && draftTeamId === '' ? 'bg-avs-yellow' : 'hover:bg-slate-800 hover:text-white'
        }`}
        style={draftRoleId === '' && draftTeamId === '' ? { color: '#0f172a' } : { color: '#e2e8f0' }}
      >
        <Crown
          className="w-4 h-4"
          style={draftRoleId === '' && draftTeamId === '' ? { color: '#0f172a' } : { color: '#e2e8f0' }}
        />
        <span
          className="flex-1 text-left"
          style={draftRoleId === '' && draftTeamId === '' ? { color: '#0f172a' } : { color: '#e2e8f0' }}
        >
          Actual Role & Team
        </span>
        {draftRoleId === '' && draftTeamId === '' && <Check className="w-4 h-4" style={{ color: '#0f172a' }} />}
      </button>

      <div className="border-t border-slate-700 pt-2">
        <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
          Role
        </div>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {allRoles.map((role) => {
            const isActive = draftRoleId === role.id;
            const RoleIcon = role.is_super_admin ? Shield : role.is_manager_admin ? Users : User;
            return (
              <button
                key={role.id}
                type="button"
                onClick={() => setDraftRoleId(role.id)}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                  isActive ? 'bg-avs-yellow' : 'hover:bg-slate-800 hover:text-white'
                }`}
                style={isActive ? { color: '#0f172a' } : { color: '#e2e8f0' }}
              >
                <RoleIcon
                  className="w-4 h-4 flex-shrink-0"
                  style={isActive ? { color: '#0f172a' } : { color: '#e2e8f0' }}
                />
                <span className="flex-1 text-left truncate" style={isActive ? { color: '#0f172a' } : { color: '#e2e8f0' }}>
                  {role.display_name}
                </span>
                {isActive && <Check className="w-4 h-4 flex-shrink-0" style={{ color: '#0f172a' }} />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-slate-700 pt-2">
        <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
          Team
        </div>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          <button
            type="button"
            onClick={() => setDraftTeamId('')}
            className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
              draftTeamId === '' ? 'bg-avs-yellow' : 'hover:bg-slate-800 hover:text-white'
            }`}
            style={draftTeamId === '' ? { color: '#0f172a' } : { color: '#e2e8f0' }}
          >
            <Users
              className="w-4 h-4 flex-shrink-0"
              style={draftTeamId === '' ? { color: '#0f172a' } : { color: '#e2e8f0' }}
            />
            <span className="flex-1 text-left">Actual Team</span>
            {draftTeamId === '' && <Check className="w-4 h-4 flex-shrink-0" style={{ color: '#0f172a' }} />}
          </button>
          {allTeams.map((team) => {
            const isActive = draftTeamId === team.id;
            return (
              <button
                key={team.id}
                type="button"
                onClick={() => setDraftTeamId(team.id)}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors ${
                  isActive ? 'bg-avs-yellow' : 'hover:bg-slate-800 hover:text-white'
                }`}
                style={isActive ? { color: '#0f172a' } : { color: '#e2e8f0' }}
              >
                <Users
                  className="w-4 h-4 flex-shrink-0"
                  style={isActive ? { color: '#0f172a' } : { color: '#e2e8f0' }}
                />
                <span className="flex-1 text-left truncate" style={isActive ? { color: '#0f172a' } : { color: '#e2e8f0' }}>
                  {team.name}
                </span>
                {isActive && <Check className="w-4 h-4 flex-shrink-0" style={{ color: '#0f172a' }} />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-slate-700 pt-3 space-y-2">
        <div className="px-2 text-xs" style={{ color: '#cbd5e1' }}>
          Pending selection: {draftSummary}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1 border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700"
            onClick={applyViewAsSelection}
          >
            Apply
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="flex-1 text-slate-300 hover:bg-slate-800 hover:text-white"
            onClick={() => {
              clearViewAsSelection();
              setViewAsRoleIdState('');
              setViewAsTeamIdState('');
              setDraftRoleId('');
              setDraftTeamId('');
              setTimeout(() => window.location.reload(), 100);
            }}
          >
            Reset
          </Button>
        </div>
      </div>
    </div>
  );

  // Sidebar has no links — show floating View As button for superadmins, nothing otherwise
  if (!showSidebar) {
    if (!isSuperAdmin) return null;

    return (
      <div className="hidden md:block fixed bottom-4 left-4 z-[70]">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`h-10 w-10 ${
                isViewingAsOverride ? 'bg-amber-600/30' : 'hover:bg-slate-800'
              }`}
              title={selectedRole || selectedTeam ? `Viewing as ${selectionSummary}` : 'View As'}
            >
              <Eye className={`w-5 h-5 ${isViewingAsOverride ? 'text-amber-300' : 'text-slate-400 hover:text-white'}`} />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-64 p-2 bg-slate-900 border border-slate-700 shadow-2xl max-h-[70vh] overflow-y-auto"
            style={{ color: '#e2e8f0' }}
          >
            {viewAsPopoverContent}
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <>
      {/* Backdrop - only show when expanded */}
      <div
        className={`fixed inset-0 bg-black/50 z-[50] transition-opacity duration-300 ${
          isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={handleBackdropClick}
      />

      {/* Sidebar - Always visible on desktop, hidden on mobile */}
      <div
        ref={sidebarRef}
        className={`hidden md:flex md:flex-col fixed left-0 top-[68px] bottom-0 bg-slate-900 border-r border-slate-700 z-[60] transition-all duration-300 ease-in-out ${
          isExpanded ? 'w-64' : 'w-16'
        }`}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={(event) => handleSidebarMouseLeave(event.relatedTarget as Node | null)}
      >
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-3 border-b border-border">
          <h2 className={`text-lg font-semibold text-white transition-opacity duration-200 ${
            isExpanded ? 'opacity-100 delay-300' : 'opacity-0 w-0 overflow-hidden'
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
            <PanelLeftClose className={`h-5 w-5 transition-transform duration-300 ${isExpanded ? '' : 'rotate-180'}`} />
          </Button>
        </div>

        {/* Navigation */}
        <div className={`overflow-y-auto py-4 ${isSuperAdmin ? 'h-[calc(100vh-10rem)]' : 'h-[calc(100vh-8.25rem)]'}`}>
          {/* Manager Links */}
          {(isManager || isAdmin) && sidebarManagerLinks.length > 0 && (
          <div className={isExpanded ? 'px-3 mb-6' : 'px-2 mb-6'}>
            <div className={`px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider transition-opacity duration-200 ${
              isExpanded ? 'opacity-100 delay-300' : 'opacity-0 h-0 overflow-hidden'
            }`}>
              Management
            </div>
            <div className="space-y-1">
              {sidebarManagerLinks.map((link) => {
                const Icon = link.icon;
                const isActive = pathname?.startsWith(link.href);
                const badgeCount = link.href === '/absence/manage' ? pendingAbsenceCount : 0;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    title={!isExpanded ? link.label : undefined}
                    onClick={handleNavLinkClick}
                    className={`flex items-center rounded-md text-sm font-medium transition-colors ${
                      isExpanded ? 'gap-3 px-3 py-2' : 'justify-center py-3'
                    } ${
                      isActive
                        ? 'bg-avs-yellow text-slate-900'
                        : 'text-muted-foreground hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <div className="relative">
                      <Icon className={isExpanded ? 'w-4 h-4' : 'w-5 h-5'} />
                      {!isExpanded && badgeCount > 0 && (
                        <span className="absolute -top-2 -right-2 min-w-[1.1rem] px-1 h-[1.1rem] rounded-full bg-red-500 text-white text-[10px] leading-none flex items-center justify-center font-semibold">
                          {badgeCount > 99 ? '99+' : badgeCount}
                        </span>
                      )}
                    </div>
                    <span className={`transition-opacity duration-200 whitespace-nowrap ${
                      isExpanded ? 'opacity-100 delay-300' : 'opacity-0 w-0 overflow-hidden'
                    }`}>
                      {link.label}
                    </span>
                    {isExpanded && badgeCount > 0 && (
                      <span className="ml-auto min-w-[1.25rem] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] leading-none flex items-center justify-center font-semibold">
                        {badgeCount > 99 ? '99+' : badgeCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
          )}

          {/* Admin Links */}
          {adminLinks.length > 0 && (
            <div className={isExpanded ? 'px-3 mb-6' : 'px-2 mb-6'}>
              <div className={`px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider transition-opacity duration-200 ${
                isExpanded ? 'opacity-100 delay-300' : 'opacity-0 h-0 overflow-hidden'
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
                      title={!isExpanded ? link.label : undefined}
                      onClick={handleNavLinkClick}
                      className={`flex items-center rounded-md text-sm font-medium transition-colors ${
                        isExpanded ? 'gap-3 px-3 py-2' : 'justify-center py-3'
                      } ${
                        isActive
                          ? 'bg-avs-yellow text-slate-900 [&>svg]:text-slate-900'
                          : 'text-muted-foreground hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <Icon className={isExpanded ? 'w-4 h-4' : 'w-5 h-5'} />
                      <span className={`transition-opacity duration-200 whitespace-nowrap ${
                        isExpanded ? 'opacity-100 delay-300' : 'opacity-0 w-0 overflow-hidden'
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
            <div className={isExpanded ? 'px-3' : 'px-2'}>
              <div className={`px-3 py-2 text-xs font-semibold text-red-500 uppercase tracking-wider transition-opacity duration-200 ${
                isExpanded ? 'opacity-100 delay-300' : 'opacity-0 h-0 overflow-hidden'
              }`}>
                Developer
              </div>
              <div className="space-y-1">
                <Link
                  href="/debug"
                  title={!isExpanded ? 'Debug Console' : undefined}
                  onClick={handleNavLinkClick}
                  className={`flex items-center rounded-md text-sm font-medium transition-colors ${
                    isExpanded ? 'gap-3 px-3 py-2' : 'justify-center py-3'
                  } ${
                    pathname === '/debug'
                      ? 'bg-red-600 text-white'
                      : 'text-red-500 hover:bg-slate-800 hover:text-red-400'
                  }`}
                >
                  <Bug className={isExpanded ? 'w-4 h-4' : 'w-5 h-5'} />
                  <span className={`transition-opacity duration-200 whitespace-nowrap ${
                    isExpanded ? 'opacity-100 delay-300' : 'opacity-0 w-0 overflow-hidden'
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
                {isExpanded ? (
                  <Button
                    ref={viewAsTriggerRef}
                    variant="outline"
                    className={`w-full justify-start gap-2 border-border text-xs h-9 ${
                      isViewingAsOverride
                        ? 'bg-amber-600/30 border-amber-500/50 text-amber-200 hover:bg-amber-600/40 hover:text-amber-100'
                        : 'bg-slate-800/50 text-muted-foreground hover:bg-slate-700 hover:text-white'
                    }`}
                    onClick={() => {
                      const nextOpen = !viewAsMenuOpen;
                      if (nextOpen) {
                        requestAnimationFrame(() => updateViewAsMenuPosition());
                      }
                      setViewAsMenuOpen(nextOpen);
                    }}
                  >
                    <Eye className="w-4 h-4 flex-shrink-0" />
                    <span className="flex-1 text-left truncate">
                      {selectionSummary}
                    </span>
                  </Button>
                ) : (
                  <Button
                    ref={viewAsTriggerRef}
                    variant="ghost"
                    size="sm"
                    className={`w-full h-10 p-0 ${isViewingAsOverride ? 'bg-amber-600/30' : 'hover:bg-slate-800'}`}
                    title="View As"
                    onClick={() => {
                      const nextOpen = !viewAsMenuOpen;
                      if (nextOpen) {
                        requestAnimationFrame(() => updateViewAsMenuPosition());
                      }
                      setViewAsMenuOpen(nextOpen);
                    }}
                  >
                    <Eye className={`w-5 h-5 ${isViewingAsOverride ? 'text-amber-300' : 'text-slate-400 hover:text-white'}`} />
                  </Button>
                )}
              </PopoverTrigger>
            </Popover>
            {viewAsMenuOpen && (
              <div
                ref={viewAsMenuRef}
                className="fixed z-[80] w-64 p-2 bg-slate-900 border border-slate-700 shadow-2xl overflow-y-auto rounded-md"
                style={{
                  left: `${viewAsMenuPosition.left}px`,
                  bottom: `${viewAsMenuPosition.bottom}px`,
                  maxHeight: `${viewAsMenuPosition.maxHeight}px`,
                  color: '#e2e8f0',
                }}
                onMouseLeave={(event) => handleViewAsMenuMouseLeave(event.relatedTarget as Node | null)}
              >
                {viewAsPopoverContent}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

