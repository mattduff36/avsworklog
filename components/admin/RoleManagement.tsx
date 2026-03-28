'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Check, ChevronLeft, ChevronRight, Loader2, Minus } from 'lucide-react';
import { toast } from 'sonner';
import type {
  ModuleName,
  PermissionModuleMatrixColumn,
  PermissionTierRole,
  TeamPermissionMatrixRow,
} from '@/types/roles';
import { MODULE_CSS_VAR } from '@/types/roles';
import { cn } from '@/lib/utils';

/** Vertical rule between job-role tier columns; matches matrix wrapper border (header + full height). */
const TIER_DIVIDER_CLASS = 'border-l border-slate-700';

function getModuleColor(mod: ModuleName): string {
  return `hsl(var(${MODULE_CSS_VAR[mod]}))`;
}

function getModuleColorAlpha(mod: ModuleName, alpha: number): string {
  return `hsl(var(${MODULE_CSS_VAR[mod]}) / ${alpha})`;
}

export function RoleManagement() {
  const [roles, setRoles] = useState<PermissionTierRole[]>([]);
  const [modules, setModules] = useState<PermissionModuleMatrixColumn[]>([]);
  const [teams, setTeams] = useState<TeamPermissionMatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [movingModules, setMovingModules] = useState<Set<string>>(new Set());
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

  useEffect(() => {
    fetchMatrix();
  }, [fetchMatrix]);

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
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {isSaving ? 'Saving…' : isEnabled ? 'Enabled' : 'Disabled'}
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

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <div>
            <CardTitle className="text-white">Team Permission Matrix</CardTitle>
            <CardDescription className="text-muted-foreground">
              Toggle module access per team. Modules are grouped by the minimum job role tier required to access them.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {teams.length === 0 || modules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Team permission matrix is not configured yet.
            </div>
          ) : (
            <div className="border border-slate-700 rounded-lg overflow-auto">
              <table className="w-full text-sm table-fixed min-w-max">
                <colgroup>
                  <col style={{ width: 150 }} />
                  {modules.map((module) => (
                    <col key={module.module_name} style={{ width: 34 }} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="bg-slate-800/60">
                    <th
                      rowSpan={2}
                      className="sticky left-0 z-10 bg-slate-800 px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider align-bottom border-b border-slate-700"
                    >
                      Team Name
                    </th>
                    {groupedModules.map((group) => (
                      <th
                        key={group.role.id}
                        colSpan={group.modules.length}
                        className={cn(
                          'px-1 py-1 text-center text-[10px] font-semibold text-slate-400 uppercase tracking-widest',
                          TIER_DIVIDER_CLASS
                        )}
                      >
                        {group.role.display_name}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-slate-700">
                    {groupedModules.flatMap((group) =>
                      group.modules.map((module, idx) => renderModuleHeader(module, idx === 0))
                    )}
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => (
                    <tr
                      key={team.id}
                      className="border-b border-slate-700/50 hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="sticky left-0 z-10 bg-slate-900/95 px-3 py-1 font-medium text-white whitespace-nowrap">
                        <div className="text-sm truncate">{team.name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{team.id}</div>
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
    </div>
  );
}
