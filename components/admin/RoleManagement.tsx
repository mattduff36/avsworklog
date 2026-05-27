'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Check, ChevronLeft, ChevronRight, Loader2, LockKeyhole, Minus } from 'lucide-react';
import { toast } from 'sonner';
import { adminNavItems, employeeNavItems, managerNavItems } from '@/lib/config/navigation';
import { getRoleSortPriority } from '@/lib/config/roles-core';
import type {
  ModuleName,
  PermissionAccessLevel,
  PermissionsAuditInfo,
  PermissionModuleMatrixColumn,
  PermissionTierRole,
  TeamPermissionMatrixRow,
  UpdateUserPermissionLevelsRequest,
  UserPermissionMatrixRow,
} from '@/types/roles';
import { MODULE_CSS_VAR, PERMISSION_LEVEL_LABELS } from '@/types/roles';
import { cn } from '@/lib/utils';

/** Vertical rule between job-role tier columns; matches matrix wrapper border (header + full height). */
const TIER_DIVIDER_CLASS = 'border-l border-slate-700';
const MODULE_GROUP_DIVIDER_CLASS = 'border-l border-slate-600/20';
const PERMISSION_LEVELS: PermissionAccessLevel[] = [0, 1, 2, 3, 4, 5];
const NAVBAR_OFFSET_PX = 68;
const USER_COLUMN_WIDTH_PX = 280;
const MODULE_COLUMN_WIDTH_PX = 42;
const MODULE_HEADER_HEIGHT_PX = 118;
const DASHBOARD_MODULE_ORDER = [
  ...employeeNavItems,
  ...managerNavItems,
  ...adminNavItems,
]
  .map((item) => item.module)
  .filter((moduleName, index, allModules): moduleName is ModuleName =>
    Boolean(moduleName && allModules.indexOf(moduleName) === index)
  );

type PendingUserLevelChange = {
  userId: string;
  userName: string;
  moduleName: ModuleName;
  moduleDisplayName: string;
  fromLevel: PermissionAccessLevel;
  toLevel: PermissionAccessLevel;
  requiresSensitivePin: boolean;
};

interface RoleManagementProps {
  mode?: 'users' | 'team-fallback';
}

function getModuleColor(mod: ModuleName): string {
  return `hsl(var(${MODULE_CSS_VAR[mod]}))`;
}

function getModuleColorAlpha(mod: ModuleName, alpha: number): string {
  return `hsl(var(${MODULE_CSS_VAR[mod]}) / ${alpha})`;
}

function isYellowModule(mod: ModuleName): boolean {
  return MODULE_CSS_VAR[mod] === '--avs-yellow';
}

function getLevelOverlayClass(level: PermissionAccessLevel): string {
  if (level === 1) return 'bg-white/20';
  if (level === 2) return 'bg-white/10';
  if (level === 4) return 'bg-black/10';
  return '';
}

function getUserPermissionRolePriority(user: UserPermissionMatrixRow): number {
  if (user.is_locked_admin || user.role_class === 'admin' || user.role_name === 'admin') {
    return getRoleSortPriority('admin');
  }
  return getRoleSortPriority(user.role_name || user.role_class || '');
}

function getUserPermissionTeamSortName(user: UserPermissionMatrixRow): string {
  return user.team_name || user.team_id || 'ZZZ Unassigned';
}

function formatEmployeeIdBadge(employeeId: string): string {
  return employeeId.length > 6 ? `${employeeId.slice(0, 6)}...` : employeeId;
}

export function RoleManagement({ mode = 'users' }: RoleManagementProps) {
  const [roles, setRoles] = useState<PermissionTierRole[]>([]);
  const [modules, setModules] = useState<PermissionModuleMatrixColumn[]>([]);
  const [teams, setTeams] = useState<TeamPermissionMatrixRow[]>([]);
  const [users, setUsers] = useState<UserPermissionMatrixRow[]>([]);
  const [audit, setAudit] = useState<PermissionsAuditInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [userMatrixLoading, setUserMatrixLoading] = useState(true);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [pendingUserChanges, setPendingUserChanges] = useState<Record<string, PendingUserLevelChange>>({});
  const [confirmUserSaveOpen, setConfirmUserSaveOpen] = useState(false);
  const [savingUserLevels, setSavingUserLevels] = useState(false);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [movingModules, setMovingModules] = useState<Set<string>>(new Set());
  const userMatrixViewportRef = useRef<HTMLDivElement | null>(null);
  const userMatrixHeaderRef = useRef<HTMLTableSectionElement | null>(null);
  const floatingHeaderRef = useRef<HTMLDivElement | null>(null);
  const floatingHeaderModulesViewportRef = useRef<HTMLDivElement | null>(null);
  const floatingHeaderTrackRef = useRef<HTMLDivElement | null>(null);
  const floatingHeaderFrameRef = useRef<number | null>(null);
  const abortControllers = useRef<Map<string, AbortController>>(new Map());
  const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingCells = useRef<Map<string, Set<string>>>(new Map());
  const inflightCellKeys = useRef<Map<string, Set<string>>>(new Map());
  const teamsRef = useRef(teams);
  const modulesRef = useRef(modules);
  teamsRef.current = teams;
  modulesRef.current = modules;

  const fetchMatrix = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/permissions/matrix', { cache: 'no-store' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch team permission matrix');
      }

      setRoles(data.roles ?? []);
      setModules(data.modules ?? []);
      setTeams(data.teams ?? []);
    } catch (error) {
      console.error('Error fetching team permission matrix:', error);
      toast.error('Failed to load team permission matrix');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUserMatrix = useCallback(async () => {
    try {
      setUserMatrixLoading(true);
      const response = await fetch('/api/admin/permissions/users', { cache: 'no-store' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch user permission matrix');
      }

      setUsers(data.users ?? []);
      setAudit(data.audit ?? null);
      setPendingUserChanges({});
    } catch (error) {
      console.error('Error fetching user permission matrix:', error);
      toast.error('Failed to load user permission matrix');
    } finally {
      setUserMatrixLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMatrix();
    if (mode === 'users') {
      fetchUserMatrix();
    }
  }, [fetchMatrix, fetchUserMatrix, mode]);

  const groupedModules = useMemo(
    () =>
      roles
        .map((role) => ({
          role,
          modules: modules.filter((module) => module.minimum_role_id === role.id),
        }))
        .filter((group) => group.modules.length > 0),
    [roles, modules]
  );

  const orderedUserModules = useMemo(() => {
    const byModuleName = new Map(modules.map((module) => [module.module_name, module]));
    const ordered = DASHBOARD_MODULE_ORDER
      .map((moduleName) => byModuleName.get(moduleName))
      .filter((module): module is PermissionModuleMatrixColumn => Boolean(module));
    const orderedNames = new Set(ordered.map((module) => module.module_name));
    const remaining = modules.filter((module) => !orderedNames.has(module.module_name));

    return [...ordered, ...remaining];
  }, [modules]);

  const filteredUsers = useMemo(() => {
    const query = userSearchQuery.trim().toLowerCase();
    const nextUsers = query
      ? users.filter((user) =>
          [
            user.full_name,
            user.employee_id,
            user.team_name,
            user.role_display_name,
          ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query))
        )
      : users;

    return [...nextUsers].sort((a, b) => {
      const byTeam = getUserPermissionTeamSortName(a).localeCompare(getUserPermissionTeamSortName(b));
      if (byTeam !== 0) return byTeam;

      const byRole = getUserPermissionRolePriority(a) - getUserPermissionRolePriority(b);
      if (byRole !== 0) return byRole;

      return (a.full_name || a.employee_id || '').localeCompare(b.full_name || b.employee_id || '');
    });
  }, [users, userSearchQuery]);

  const pendingUserChangeList = useMemo(
    () => Object.values(pendingUserChanges),
    [pendingUserChanges]
  );

  const updateFloatingHeaderNow = useCallback(() => {
    const viewport = userMatrixViewportRef.current;
    const header = userMatrixHeaderRef.current;
    const overlay = floatingHeaderRef.current;
    const moduleViewport = floatingHeaderModulesViewportRef.current;
    const track = floatingHeaderTrackRef.current;
    if (mode !== 'users' || !viewport || !header || !overlay || !moduleViewport || !track) {
      if (overlay) overlay.style.display = 'none';
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const visible =
      headerRect.bottom <= NAVBAR_OFFSET_PX &&
      viewportRect.bottom > NAVBAR_OFFSET_PX + MODULE_HEADER_HEIGHT_PX &&
      viewportRect.top < window.innerHeight;

    if (!visible) {
      overlay.style.display = 'none';
      return;
    }

    const left = Math.max(viewportRect.left, 0);
    const width = Math.min(viewportRect.width, window.innerWidth - left);
    overlay.style.display = 'block';
    overlay.style.left = `${left}px`;
    overlay.style.width = `${width}px`;
    moduleViewport.style.width = `${Math.max(width - USER_COLUMN_WIDTH_PX, 0)}px`;
    track.style.transform = `translate3d(-${viewport.scrollLeft}px, 0, 0)`;
  }, [mode]);

  const scheduleFloatingHeaderUpdate = useCallback(() => {
    if (floatingHeaderFrameRef.current !== null) return;

    floatingHeaderFrameRef.current = window.requestAnimationFrame(() => {
      floatingHeaderFrameRef.current = null;
      updateFloatingHeaderNow();
    });
  }, [updateFloatingHeaderNow]);

  useEffect(() => {
    if (mode !== 'users') return;

    const viewport = userMatrixViewportRef.current;
    const overlay = floatingHeaderRef.current;
    scheduleFloatingHeaderUpdate();

    window.addEventListener('scroll', scheduleFloatingHeaderUpdate, { passive: true });
    window.addEventListener('resize', scheduleFloatingHeaderUpdate);
    viewport?.addEventListener('scroll', scheduleFloatingHeaderUpdate, { passive: true });

    return () => {
      window.removeEventListener('scroll', scheduleFloatingHeaderUpdate);
      window.removeEventListener('resize', scheduleFloatingHeaderUpdate);
      viewport?.removeEventListener('scroll', scheduleFloatingHeaderUpdate);
      if (floatingHeaderFrameRef.current !== null) {
        window.cancelAnimationFrame(floatingHeaderFrameRef.current);
        floatingHeaderFrameRef.current = null;
      }
      if (overlay) {
        overlay.style.display = 'none';
      }
    };
  }, [mode, orderedUserModules.length, filteredUsers.length, scheduleFloatingHeaderUpdate]);

  const flushTeamPermissions = useCallback(
    async (teamId: string) => {
      const cellsForTeam = pendingCells.current.get(teamId);
      if (!cellsForTeam || cellsForTeam.size === 0) return;

      const prevController = abortControllers.current.get(teamId);
      if (prevController) prevController.abort();

      const controller = new AbortController();
      abortControllers.current.set(teamId, controller);

      const currentTeam = teamsRef.current.find((team) => team.id === teamId);
      if (!currentTeam) return;

      const cellKeys = new Set(cellsForTeam);
      const prevInflight = inflightCellKeys.current.get(teamId);
      if (prevInflight) {
        prevInflight.forEach((cellKey) => cellKeys.add(cellKey));
      }
      inflightCellKeys.current.set(teamId, cellKeys);
      pendingCells.current.delete(teamId);

      try {
        const permissionsArray = modulesRef.current.map((module) => ({
          module_name: module.module_name,
          enabled: currentTeam.permissions[module.module_name],
        }));

        const response = await fetch(`/api/admin/permissions/matrix/${teamId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissions: permissionsArray }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to update team permissions');
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;

        toast.error(`Failed to update permissions for ${currentTeam.name}`);
        fetchMatrix();
      } finally {
        if (abortControllers.current.get(teamId) === controller) {
          setSavingCells((prev) => {
            const next = new Set(prev);
            cellKeys.forEach((cellKey) => next.delete(cellKey));
            return next;
          });
          abortControllers.current.delete(teamId);
          inflightCellKeys.current.delete(teamId);
        }
      }
    },
    [fetchMatrix]
  );

  const handleTogglePermission = useCallback(
    (team: TeamPermissionMatrixRow, moduleName: ModuleName, newValue: boolean) => {
      const cellKey = `${team.id}:${moduleName}`;

      setTeams((prev) =>
        prev.map((row) =>
          row.id === team.id
            ? {
                ...row,
                permissions: {
                  ...row.permissions,
                  [moduleName]: newValue,
                },
              }
            : row
        )
      );

      setSavingCells((prev) => new Set(prev).add(cellKey));

      if (!pendingCells.current.has(team.id)) {
        pendingCells.current.set(team.id, new Set());
      }
      pendingCells.current.get(team.id)!.add(cellKey);

      const existingTimer = pendingTimers.current.get(team.id);
      if (existingTimer) clearTimeout(existingTimer);

      pendingTimers.current.set(
        team.id,
        setTimeout(() => {
          pendingTimers.current.delete(team.id);
          flushTeamPermissions(team.id);
        }, 300)
      );
    },
    [flushTeamPermissions]
  );

  const handleShiftModule = useCallback(
    async (module: PermissionModuleMatrixColumn, direction: 'left' | 'right') => {
      setMovingModules((prev) => new Set(prev).add(module.module_name));

      try {
        const response = await fetch(`/api/admin/permissions/modules/${module.module_name}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction }),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to move module');
        }

        toast.success(
          `${module.display_name} moved ${direction === 'left' ? 'left' : 'right'} into ${data.module.minimum_role_name}`
        );
        await fetchMatrix();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to move module');
      } finally {
        setMovingModules((prev) => {
          const next = new Set(prev);
          next.delete(module.module_name);
          return next;
        });
      }
    },
    [fetchMatrix]
  );

  const handleToggleSensitivePin = useCallback(
    async (module: PermissionModuleMatrixColumn) => {
      const nextValue = !module.requires_sensitive_pin;
      setMovingModules((prev) => new Set(prev).add(module.module_name));

      try {
        const response = await fetch(`/api/admin/permissions/modules/${module.module_name}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requires_sensitive_pin: nextValue }),
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to update sensitive PIN requirement');
        }

        setModules((previous) =>
          previous.map((entry) =>
            entry.module_name === module.module_name
              ? { ...entry, requires_sensitive_pin: nextValue }
              : entry
          )
        );
        toast.success(
          `${module.display_name} sensitive PIN ${nextValue ? 'enabled' : 'disabled'}`
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to update sensitive PIN requirement');
      } finally {
        setMovingModules((prev) => {
          const next = new Set(prev);
          next.delete(module.module_name);
          return next;
        });
      }
    },
    []
  );

  const handleUserLevelChange = useCallback(
    (user: UserPermissionMatrixRow, module: PermissionModuleMatrixColumn, nextLevel: PermissionAccessLevel) => {
      if (user.is_locked_admin) return;

      const currentLevel = user.permissions[module.module_name] ?? 0;
      if (currentLevel === nextLevel) return;

      const changeKey = `${user.id}:${module.module_name}`;
      setUsers((previous) =>
        previous.map((entry) =>
          entry.id === user.id
            ? {
                ...entry,
                permissions: {
                  ...entry.permissions,
                  [module.module_name]: nextLevel,
                },
              }
            : entry
        )
      );

      setPendingUserChanges((previous) => {
        const existing = previous[changeKey];
        const fromLevel = existing?.fromLevel ?? currentLevel;
        const next = { ...previous };

        if (fromLevel === nextLevel) {
          delete next[changeKey];
          return next;
        }

        next[changeKey] = {
          userId: user.id,
          userName: user.full_name || user.email || user.id,
          moduleName: module.module_name,
          moduleDisplayName: module.display_name,
          fromLevel,
          toLevel: nextLevel,
          requiresSensitivePin: module.requires_sensitive_pin,
        };
        return next;
      });
    },
    []
  );

  const handleCycleUserLevel = useCallback(
    (user: UserPermissionMatrixRow, module: PermissionModuleMatrixColumn) => {
      const currentLevel = user.permissions[module.module_name] ?? 0;
      const currentIndex = PERMISSION_LEVELS.indexOf(currentLevel);
      const nextLevel = PERMISSION_LEVELS[(currentIndex + 1) % PERMISSION_LEVELS.length] ?? 0;
      handleUserLevelChange(user, module, nextLevel);
    },
    [handleUserLevelChange]
  );

  const handleSaveUserLevels = useCallback(async () => {
    if (pendingUserChangeList.length === 0) return;

    try {
      setSavingUserLevels(true);
      const body: UpdateUserPermissionLevelsRequest = {
        updates: pendingUserChangeList.map((change) => ({
          user_id: change.userId,
          module_name: change.moduleName,
          access_level: change.toLevel,
        })),
      };

      const response = await fetch('/api/admin/permissions/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update user permission levels');
      }

      toast.success('User permission levels updated');
      setConfirmUserSaveOpen(false);
      await fetchUserMatrix();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update user permission levels');
    } finally {
      setSavingUserLevels(false);
    }
  }, [fetchUserMatrix, pendingUserChangeList]);

  function getModuleWarnings(module: PermissionModuleMatrixColumn): string[] {
    if (!audit) return [];
    const moduleNeedles = [module.module_name, module.display_name, module.short_name]
      .map((value) => value.toLowerCase())
      .filter(Boolean);

    return audit.prdRelevantMismatches.filter((warning) => {
      const normalized = warning.toLowerCase();
      return moduleNeedles.some((needle) => normalized.includes(needle));
    });
  }

  function renderModuleHeader(module: PermissionModuleMatrixColumn, isFirstInTierGroup: boolean) {
    const currentIndex = roles.findIndex((role) => role.id === module.minimum_role_id);
    const canMoveLeft = currentIndex > 0;
    const canMoveRight = currentIndex >= 0 && currentIndex < roles.length - 1;
    const isMoving = movingModules.has(module.module_name);

    return (
      <th
        key={module.module_name}
        className={cn('p-0 align-bottom group relative', isFirstInTierGroup && TIER_DIVIDER_CLASS)}
        style={{ width: 34, minWidth: 34, maxWidth: 34, height: 110 }}
      >
        <div className="flex items-end justify-center h-full pb-2 relative">
          {canMoveLeft && (
            <button
              type="button"
              disabled={isMoving}
              onClick={() => handleShiftModule(module, 'left')}
              className="absolute left-0.5 top-1 opacity-0 group-hover:opacity-100 transition-opacity rounded bg-slate-900/90 border border-slate-700 p-0.5 text-slate-200 hover:text-white disabled:opacity-40"
              title={`Move ${module.display_name} into the next lower tier`}
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
          )}
          {canMoveRight && (
            <button
              type="button"
              disabled={isMoving}
              onClick={() => handleShiftModule(module, 'right')}
              className="absolute right-0.5 top-1 opacity-0 group-hover:opacity-100 transition-opacity rounded bg-slate-900/90 border border-slate-700 p-0.5 text-slate-200 hover:text-white disabled:opacity-40"
              title={`Move ${module.display_name} into the next higher tier`}
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            disabled={isMoving}
            onClick={() => handleToggleSensitivePin(module)}
            className={cn(
              'absolute left-1/2 top-1 -translate-x-1/2 rounded border p-0.5 transition-colors disabled:opacity-40',
              module.requires_sensitive_pin
                ? 'border-amber-400/80 bg-amber-500/20 text-amber-200'
                : 'border-slate-700 bg-slate-900/90 text-slate-500 opacity-0 group-hover:opacity-100'
            )}
            title={`${module.requires_sensitive_pin ? 'Disable' : 'Enable'} sensitive PIN for ${module.display_name}`}
          >
            <LockKeyhole className="h-3 w-3" />
          </button>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="cursor-default text-[11px] font-medium tracking-wide whitespace-nowrap"
                  style={{
                    writingMode: 'vertical-rl',
                    transform: 'rotate(180deg)',
                    color: getModuleColor(module.module_name),
                  }}
                >
                  {isMoving ? '...' : module.short_name}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {module.display_name}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </th>
    );
  }

  function renderPermissionCell(
    team: TeamPermissionMatrixRow,
    moduleName: ModuleName,
    isFirstInTierGroup: boolean
  ) {
    const cellKey = `${team.id}:${moduleName}`;
    const isSaving = savingCells.has(cellKey);
    const isEnabled = team.permissions[moduleName];
    const color = getModuleColor(moduleName);

    return (
      <td
        key={moduleName}
        className={cn('px-0 py-0.5 text-center', isFirstInTierGroup && TIER_DIVIDER_CLASS)}
      >
        <button
          type="button"
          disabled={isSaving}
          onClick={() => handleTogglePermission(team, moduleName, !isEnabled)}
          className="h-6 w-6 rounded flex items-center justify-center mx-auto transition-all duration-150 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          style={
            isSaving
              ? { backgroundColor: 'hsl(215 20% 18%)', border: '1.5px solid hsl(215 20% 30%)' }
              : isEnabled
                ? { backgroundColor: color, boxShadow: `0 0 6px ${getModuleColorAlpha(moduleName, 0.25)}` }
                : { backgroundColor: 'transparent', border: '1.5px solid hsl(215 20% 30%)' }
          }
          aria-label={`${moduleName} for ${team.name}: ${isSaving ? 'saving' : isEnabled ? 'enabled' : 'disabled'}`}
        >
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 text-slate-400 animate-spin" />
          ) : isEnabled ? (
            <Check className="h-3.5 w-3.5 text-white" />
          ) : (
            <Minus className="h-3 w-3 text-slate-600" />
          )}
        </button>
      </td>
    );
  }

  function renderUserModuleHeader(module: PermissionModuleMatrixColumn, showModuleGroupDivider: boolean) {
    return (
      <th
        key={module.module_name}
        className={cn(
          'p-0 align-bottom group relative bg-slate-900/95',
          showModuleGroupDivider && MODULE_GROUP_DIVIDER_CLASS
        )}
        style={{ width: 42, minWidth: 42, maxWidth: 42, height: 118 }}
      >
        <div className="flex items-end justify-center h-full pb-2 relative">
          {module.requires_sensitive_pin && (
            <span
              className="absolute left-1/2 top-1 -translate-x-1/2 rounded border border-amber-400/80 bg-amber-500/20 p-0.5 text-amber-200"
              title={`${module.display_name} requires sensitive PIN unlock after access is granted`}
            >
              <LockKeyhole className="h-3 w-3" />
            </span>
          )}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="cursor-default text-[11px] font-medium tracking-wide whitespace-nowrap"
                  style={{
                    writingMode: 'vertical-rl',
                    transform: 'rotate(180deg)',
                    color: getModuleColor(module.module_name),
                  }}
                >
                  {module.short_name}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-sm text-xs">
                <div className="space-y-1">
                  <div className="font-medium">{module.display_name}</div>
                  <div>{module.description}</div>
                  {module.requires_sensitive_pin && (
                    <div className="text-amber-200">Sensitive PIN required after access is granted.</div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </th>
    );
  }

  function renderFloatingModuleHeader(module: PermissionModuleMatrixColumn, showModuleGroupDivider: boolean) {
    return (
      <div
        key={module.module_name}
        className={cn(
          'relative flex shrink-0 items-end justify-center bg-slate-900/95 pb-2',
          showModuleGroupDivider && MODULE_GROUP_DIVIDER_CLASS
        )}
        style={{ width: MODULE_COLUMN_WIDTH_PX, height: MODULE_HEADER_HEIGHT_PX }}
      >
        {module.requires_sensitive_pin && (
          <span className="absolute left-1/2 top-1 -translate-x-1/2 rounded border border-amber-400/80 bg-amber-500/20 p-0.5 text-amber-200">
            <LockKeyhole className="h-3 w-3" />
          </span>
        )}
        <span
          className="text-[11px] font-medium tracking-wide whitespace-nowrap"
          style={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            color: getModuleColor(module.module_name),
          }}
        >
          {module.short_name}
        </span>
      </div>
    );
  }

  function renderUserLevelCell(
    user: UserPermissionMatrixRow,
    module: PermissionModuleMatrixColumn,
    showModuleGroupDivider: boolean
  ) {
    const level = user.permissions[module.module_name] ?? 0;
    const pendingKey = `${user.id}:${module.module_name}`;
    const isPending = Boolean(pendingUserChanges[pendingKey]);
    const color = level > 0 ? getModuleColor(module.module_name) : undefined;
    const overlayClass = !user.is_locked_admin && !isPending ? getLevelOverlayClass(level) : '';
    const useDarkText = !user.is_locked_admin && !isPending && level > 0 && isYellowModule(module.module_name);

    return (
      <td
        key={module.module_name}
        className={cn('px-0 py-1 text-center', showModuleGroupDivider && MODULE_GROUP_DIVIDER_CLASS)}
      >
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={user.is_locked_admin}
                onClick={() => handleCycleUserLevel(user, module)}
                className={cn(
                  'relative h-7 w-9 overflow-hidden rounded mx-auto flex items-center justify-center text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  user.is_locked_admin
                    ? 'cursor-not-allowed border border-amber-500/50 bg-amber-500/15 text-amber-100'
                    : isPending
                      ? 'border border-avs-yellow bg-avs-yellow/20 text-avs-yellow shadow-[0_0_0_1px_rgba(250,204,21,0.25)]'
                      : level > 0
                        ? useDarkText ? 'text-slate-900' : 'text-white'
                        : 'border border-slate-700 bg-transparent text-slate-500 hover:border-slate-500 hover:text-slate-300'
                )}
                style={
                  !user.is_locked_admin && level > 0 && !isPending
                    ? { backgroundColor: color, boxShadow: `0 0 6px ${getModuleColorAlpha(module.module_name, 0.2)}` }
                    : undefined
                }
                aria-label={`${module.display_name} for ${user.full_name || user.email || user.id}: Level ${level}`}
              >
                {overlayClass && <span aria-hidden="true" className={cn('absolute inset-0', overlayClass)} />}
                <span className="relative z-10">{level === 0 ? '-' : level}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              {user.is_locked_admin ? (
                <div>
                  Admin-role users always have Level 5. Change this user&apos;s job role to non-admin before editing module permissions.
                </div>
              ) : (
                <div className="space-y-1">
                  <div>
                    {module.display_name}: <span className="font-semibold">{PERMISSION_LEVEL_LABELS[level]}</span>
                  </div>
                  <div>Click to cycle through permission levels.</div>
                  {module.requires_sensitive_pin && (
                    <div className="text-amber-200">This module still requires sensitive PIN unlock.</div>
                  )}
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </td>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (mode === 'team-fallback') {
    return (
      <Card className="border-red-500/60 bg-red-950/30 shadow-[0_0_0_1px_rgba(239,68,68,0.15)]">
        <CardHeader>
          <div>
            <CardTitle className="text-red-100">Superadmin Legacy Team Permission Matrix</CardTitle>
            <CardDescription className="text-red-200/80">
              Fallback defaults only. Live permissions are now controlled from the user permission levels tab.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {teams.length === 0 || modules.length === 0 ? (
            <div className="text-center py-8 text-red-200/80">
              Team permission matrix is not configured yet.
            </div>
          ) : (
            <div className="border border-red-500/40 rounded-lg overflow-auto bg-slate-950/70">
              <table className="w-full text-sm table-fixed min-w-max">
                <colgroup>
                  <col style={{ width: 150 }} />
                  {modules.map((module) => (
                    <col key={module.module_name} style={{ width: 34 }} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="bg-red-950/50">
                    <th
                      rowSpan={2}
                      className="sticky left-0 z-10 bg-red-950 px-3 py-2 text-left text-xs font-medium text-red-100 uppercase tracking-wider align-bottom border-b border-red-500/40"
                    >
                      Team Name
                    </th>
                    {groupedModules.map((group) => (
                      <th
                        key={group.role.id}
                        colSpan={group.modules.length}
                        className={cn(
                          'px-1 py-1 text-center text-[10px] font-semibold text-red-200/80 uppercase tracking-widest',
                          'border-l border-red-500/40'
                        )}
                      >
                        {group.role.display_name}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-red-500/40">
                    {groupedModules.flatMap((group) =>
                      group.modules.map((module, idx) => renderModuleHeader(module, idx === 0))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => (
                    <tr
                      key={team.id}
                      className="border-b border-red-500/20 hover:bg-red-950/30 transition-colors"
                    >
                      <td className="sticky left-0 z-10 bg-red-950/95 px-3 py-1 font-medium text-red-50 whitespace-nowrap">
                        <div className="text-sm truncate">{team.name}</div>
                        <div className="text-[11px] text-red-200/70 font-mono mt-0.5">{team.id}</div>
                      </td>
                      {groupedModules.flatMap((group) =>
                        group.modules.map((module, idx) =>
                          renderPermissionCell(team, module.module_name, idx === 0)
                        )
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div
        ref={floatingHeaderRef}
        className="pointer-events-none fixed top-[68px] z-[55] hidden overflow-hidden rounded-t-lg border border-slate-700 bg-slate-900/95 shadow-xl backdrop-blur"
        style={{ height: MODULE_HEADER_HEIGHT_PX }}
      >
        <div
          className="absolute left-0 top-0 z-10 flex items-end bg-slate-800 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
          style={{ width: USER_COLUMN_WIDTH_PX, height: MODULE_HEADER_HEIGHT_PX }}
        >
          User
        </div>
        <div
          ref={floatingHeaderModulesViewportRef}
          className="overflow-hidden"
          style={{
            marginLeft: USER_COLUMN_WIDTH_PX,
            height: MODULE_HEADER_HEIGHT_PX,
          }}
        >
          <div
            ref={floatingHeaderTrackRef}
            className="flex will-change-transform"
            style={{
              width: orderedUserModules.length * MODULE_COLUMN_WIDTH_PX,
            }}
          >
            {orderedUserModules.map((module, index) =>
              renderFloatingModuleHeader(module, index > 0 && index % 3 === 0)
            )}
          </div>
        </div>
      </div>

      <Card className="border-border">
        <CardHeader>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <CardTitle className="text-white">User Permission Levels</CardTitle>
              <CardDescription className="text-muted-foreground">
                Set module access per user. The selected level controls the user&apos;s module access and equivalent in-module behavior.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={userSearchQuery}
                onChange={(event) => setUserSearchQuery(event.target.value)}
                placeholder="Search users, teams, roles..."
                className="min-w-[260px] bg-slate-900/50 border-slate-700 text-white"
              />
              <Button
                type="button"
                disabled={pendingUserChangeList.length === 0}
                onClick={() => setConfirmUserSaveOpen(true)}
                className="bg-avs-yellow text-slate-900 hover:bg-avs-yellow-hover disabled:opacity-50"
              >
                Save Changes
                {pendingUserChangeList.length > 0 ? ` (${pendingUserChangeList.length})` : ''}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 rounded-lg border border-slate-700 bg-slate-950/40 p-3 text-xs text-slate-300 md:grid-cols-3">
            {PERMISSION_LEVELS.map((level) => (
              <div key={level} className="flex items-center gap-2">
                <Badge
                  variant={level === 0 ? 'outline' : level >= 4 ? 'warning' : 'secondary'}
                  className={cn(level === 0 && 'border-slate-600 text-slate-300')}
                >
                  {level === 0 ? '-' : level}
                </Badge>
                <span>{PERMISSION_LEVEL_LABELS[level]}</span>
              </div>
            ))}
          </div>

          {audit?.matrixRule && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm text-muted-foreground">
              {audit.matrixRule}
            </div>
          )}

          {userMatrixLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : filteredUsers.length === 0 || orderedUserModules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {userSearchQuery ? 'No users found matching your search.' : 'User permission matrix is not configured yet.'}
            </div>
          ) : (
            <div ref={userMatrixViewportRef} className="border border-slate-700 rounded-lg overflow-x-auto">
              <table className="w-full text-sm table-fixed min-w-max">
                <colgroup>
                  <col style={{ width: 280 }} />
                  {orderedUserModules.map((module) => (
                    <col key={module.module_name} style={{ width: 42 }} />
                  ))}
                </colgroup>
                <thead ref={userMatrixHeaderRef} className="bg-slate-900/95">
                  <tr className="border-b border-slate-700">
                    <th
                      className="sticky left-0 z-40 bg-slate-800 px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider align-bottom border-b border-slate-700"
                      style={{ height: 118 }}
                    >
                      User
                    </th>
                    {orderedUserModules.map((module, index) =>
                      renderUserModuleHeader(module, index > 0 && index % 3 === 0)
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user, index) => {
                    const currentTeamKey = user.team_id || 'unassigned';
                    const previousTeamKey =
                      index > 0 ? (filteredUsers[index - 1]?.team_id || 'unassigned') : null;
                    const startsNewTeam = index === 0 || currentTeamKey !== previousTeamKey;
                    const teamLabel = user.team_name || 'Unassigned';

                    return (
                      <Fragment key={user.id}>
                        {startsNewTeam && (
                          <tr className="border-b border-slate-700 bg-slate-950/60 hover:bg-slate-950/60">
                            <td
                              colSpan={orderedUserModules.length + 1}
                              className="sticky left-0 z-20 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400"
                            >
                              {teamLabel}
                            </td>
                          </tr>
                        )}
                        <tr className="border-b border-slate-700/50 hover:bg-slate-800/40 transition-colors">
                          <td className="sticky left-0 z-10 bg-slate-900/95 px-3 py-2 font-medium text-white">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm">{user.full_name || user.employee_id || 'Unnamed User'}</div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <Badge variant={user.is_locked_admin ? 'destructive' : 'secondary'} className="text-[10px]">
                                    {user.role_display_name || 'No Role'}
                                  </Badge>
                                  {user.employee_id && (
                                    <Badge variant="outline" className="border-slate-600 text-[10px] text-slate-300">
                                      {formatEmployeeIdBadge(user.employee_id)}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              {user.is_locked_admin && (
                                <TooltipProvider delayDuration={200}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <LockKeyhole className="mt-1 h-4 w-4 shrink-0 text-amber-300" />
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="w-[40rem] max-w-[calc(100vw-2rem)] text-xs">
                                      Admin-role users are locked at Level 5. Change their job role to non-admin to edit module levels.
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                          </td>
                          {orderedUserModules.map((module, moduleIndex) =>
                            renderUserLevelCell(user, module, moduleIndex > 0 && moduleIndex % 3 === 0)
                          )}
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmUserSaveOpen} onOpenChange={setConfirmUserSaveOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Confirm User Permission Level Changes</DialogTitle>
            <DialogDescription>
              Review the changed module levels before saving. Sensitive PIN protection remains a separate unlock step.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            <div className="rounded-lg border border-slate-700 bg-slate-950/50">
              {pendingUserChangeList.slice(0, 20).map((change) => {
                const changedModule = modules.find((entry) => entry.module_name === change.moduleName);
                const warnings = changedModule ? getModuleWarnings(changedModule) : [];

                return (
                  <div key={`${change.userId}:${change.moduleName}`} className="border-b border-slate-700/60 p-3 last:border-b-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-white">{change.userName}</div>
                        <div className="text-xs text-muted-foreground">{change.moduleDisplayName}</div>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="border-slate-600 text-slate-300">
                          {change.fromLevel === 0 ? '-' : change.fromLevel} {PERMISSION_LEVEL_LABELS[change.fromLevel]}
                        </Badge>
                        <span className="text-muted-foreground">to</span>
                        <Badge variant={change.toLevel >= 4 ? 'warning' : change.toLevel === 0 ? 'outline' : 'secondary'}>
                          {change.toLevel === 0 ? '-' : change.toLevel} {PERMISSION_LEVEL_LABELS[change.toLevel]}
                        </Badge>
                      </div>
                    </div>

                    {change.requiresSensitivePin && change.toLevel > 0 && (
                      <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-100">
                        This module requires sensitive PIN setup/unlock after access is granted.
                      </div>
                    )}

                    {warnings.length > 0 && (
                      <div className="mt-2 space-y-1 text-xs text-slate-300">
                        {warnings.map((warning) => (
                          <div key={warning} className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1">
                            {warning}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {pendingUserChangeList.length > 20 && (
                <div className="p-3 text-xs text-muted-foreground">
                  Plus {pendingUserChangeList.length - 20} more changes.
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmUserSaveOpen(false)}
              disabled={savingUserLevels}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveUserLevels()}
              disabled={savingUserLevels}
              className="bg-avs-yellow text-slate-900 hover:bg-avs-yellow-hover"
            >
              {savingUserLevels && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Permission Levels
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
