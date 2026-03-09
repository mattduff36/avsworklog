'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Shield, Loader2, Check, Minus } from 'lucide-react';
import type { RoleMatrixRow, ModuleName } from '@/types/roles';
import {
  ALL_MODULES,
  STANDARD_MODULES,
  MANAGEMENT_MODULES,
  MODULE_SHORT_NAMES,
  MODULE_DISPLAY_NAMES,
  MODULE_CSS_VAR,
} from '@/types/roles';
import { toast } from 'sonner';

function getModuleColor(mod: ModuleName): string {
  const cssVar = MODULE_CSS_VAR[mod];
  return `hsl(var(${cssVar}))`;
}

function getModuleColorAlpha(mod: ModuleName, alpha: number): string {
  const cssVar = MODULE_CSS_VAR[mod];
  return `hsl(var(${cssVar}) / ${alpha})`;
}

export function RoleManagement() {
  const [matrixRoles, setMatrixRoles] = useState<RoleMatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const abortControllers = useRef<Map<string, AbortController>>(new Map());
  const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingCells = useRef<Map<string, Set<string>>>(new Map());
  const inflightCellKeys = useRef<Map<string, Set<string>>>(new Map());
  const matrixRolesRef = useRef(matrixRoles);
  matrixRolesRef.current = matrixRoles;

  useEffect(() => {
    fetchRoles();
  }, []);

  async function fetchRoles() {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/roles');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch roles');
      }

      setMatrixRoles(data.matrix ?? []);
    } catch (error) {
      console.error('Error fetching roles:', error);
      toast.error('Failed to load roles');
    } finally {
      setLoading(false);
    }
  }

  const flushRolePermissions = useCallback(
    async (roleId: string) => {
      const cellsForRole = pendingCells.current.get(roleId);
      if (!cellsForRole || cellsForRole.size === 0) return;

      const prevController = abortControllers.current.get(roleId);
      if (prevController) prevController.abort();

      const controller = new AbortController();
      abortControllers.current.set(roleId, controller);

      const currentRole = matrixRolesRef.current.find((r) => r.id === roleId);
      if (!currentRole) return;

      const cellKeys = new Set(cellsForRole);
      const prevInflight = inflightCellKeys.current.get(roleId);
      if (prevInflight) {
        prevInflight.forEach((k) => cellKeys.add(k));
      }
      inflightCellKeys.current.set(roleId, cellKeys);
      pendingCells.current.delete(roleId);

      try {
        const permissionsArray = ALL_MODULES.map((m) => ({
          module_name: m,
          enabled: currentRole.permissions[m],
        }));

        const response = await fetch(`/api/admin/roles/${roleId}/permissions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissions: permissionsArray }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to update permissions');
        }

        toast.success(
          `Permissions updated for ${currentRole.display_name}`,
          { duration: 2000 }
        );
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;

        toast.error(`Failed to update permissions for ${currentRole.display_name}`);
        fetchRoles();
      } finally {
        if (abortControllers.current.get(roleId) === controller) {
          setSavingCells((prev) => {
            const next = new Set(prev);
            cellKeys.forEach((k) => next.delete(k));
            return next;
          });
          abortControllers.current.delete(roleId);
          inflightCellKeys.current.delete(roleId);
        }
      }
    },
    []
  );

  const handleTogglePermission = useCallback(
    (role: RoleMatrixRow, mod: ModuleName, newValue: boolean) => {
      const cellKey = `${role.id}:${mod}`;
      const roleId = role.id;

      setMatrixRoles((prev) =>
        prev.map((r) =>
          r.id === roleId ? { ...r, permissions: { ...r.permissions, [mod]: newValue } } : r
        )
      );

      setSavingCells((prev) => new Set(prev).add(cellKey));

      if (!pendingCells.current.has(roleId)) {
        pendingCells.current.set(roleId, new Set());
      }
      pendingCells.current.get(roleId)!.add(cellKey);

      const existingTimer = pendingTimers.current.get(roleId);
      if (existingTimer) clearTimeout(existingTimer);

      pendingTimers.current.set(
        roleId,
        setTimeout(() => {
          pendingTimers.current.delete(roleId);
          flushRolePermissions(roleId);
        }, 300)
      );
    },
    [flushRolePermissions]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const isProtectedRole = (role: RoleMatrixRow) =>
    role.is_super_admin || role.name === 'admin';

  const isEmployeeRole = (role: RoleMatrixRow) => role.name.startsWith('employee-');

  function renderModuleColumns(modules: ModuleName[]) {
    return modules.map((mod) => (
      <th
        key={mod}
        className="p-0 align-bottom"
        style={{ width: 30, minWidth: 30, maxWidth: 30, height: 100 }}
      >
        <div className="flex items-end justify-center h-full pb-2">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="cursor-default text-[11px] font-medium tracking-wide whitespace-nowrap"
                  style={{
                    writingMode: 'vertical-rl',
                    transform: 'rotate(180deg)',
                    color: getModuleColor(mod),
                  }}
                >
                  {MODULE_SHORT_NAMES[mod]}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {MODULE_DISPLAY_NAMES[mod]}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </th>
    ));
  }

  function renderPermissionCell(role: RoleMatrixRow, mod: ModuleName) {
    const cellKey = `${role.id}:${mod}`;
    const isSaving = savingCells.has(cellKey);
    const isEnabled = role.permissions[mod];
    const isProtected = isProtectedRole(role);
    const isEmployeeManagementModule = isEmployeeRole(role) && MANAGEMENT_MODULES.includes(mod);
    const color = getModuleColor(mod);

    if (isProtected) {
      return (
        <td key={mod} className="px-0 py-0.5 text-center">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-center">
                  <div
                    className="h-6 w-6 rounded flex items-center justify-center"
                    style={{ backgroundColor: `color-mix(in srgb, ${color} 25%, transparent)` }}
                  >
                    <Check className="h-3.5 w-3.5" style={{ color }} />
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {role.is_super_admin ? 'Super Admin' : 'Admin'} — full access
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </td>
      );
    }

    if (isEmployeeManagementModule) {
      return (
        <td key={mod} className="px-0 py-0.5 text-center">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-center">
                  <div className="h-6 w-6 rounded border border-slate-700 flex items-center justify-center">
                    <Minus className="h-3 w-3 text-slate-600" />
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Employee roles cannot be granted management modules
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </td>
      );
    }

    return (
      <td key={mod} className="px-0 py-0.5 text-center">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => handleTogglePermission(role, mod, !isEnabled)}
                className="h-6 w-6 rounded flex items-center justify-center mx-auto transition-all duration-150 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                style={
                  isSaving
                    ? { backgroundColor: 'hsl(215 20% 18%)', border: '1.5px solid hsl(215 20% 30%)' }
                    : isEnabled
                      ? { backgroundColor: color, boxShadow: `0 0 6px ${getModuleColorAlpha(mod, 0.25)}` }
                      : { backgroundColor: 'transparent', border: '1.5px solid hsl(215 20% 30%)' }
                }
                aria-label={`${MODULE_DISPLAY_NAMES[mod]} for ${role.display_name}: ${isSaving ? 'saving' : isEnabled ? 'enabled' : 'disabled'}`}
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
              {MODULE_DISPLAY_NAMES[mod]}: {isSaving ? 'Saving…' : isEnabled ? 'Enabled' : 'Disabled'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </td>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <div>
            <CardTitle className="text-white">Module Permissions</CardTitle>
            <CardDescription className="text-muted-foreground">
              Toggle module access per role. Changes save instantly. Manage roles on the Roles tab.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {matrixRoles.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No roles configured yet.
            </div>
          ) : (
            <div className="border border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col style={{ width: 140 }} />
                  {STANDARD_MODULES.map((m) => (
                    <col key={m} style={{ width: 30 }} />
                  ))}
                  {MANAGEMENT_MODULES.map((m) => (
                    <col key={m} style={{ width: 30 }} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="bg-slate-800/60">
                    <th
                      rowSpan={2}
                      className="sticky left-0 z-10 bg-slate-800 px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider align-bottom border-b border-slate-700"
                    >
                      Role Name
                    </th>
                    <th
                      colSpan={STANDARD_MODULES.length}
                      className="px-1 py-1 text-center text-[10px] font-semibold text-slate-400 uppercase tracking-widest border-l border-slate-700/50"
                    >
                      Standard Modules
                    </th>
                    <th
                      colSpan={MANAGEMENT_MODULES.length}
                      className="px-1 py-1 text-center text-[10px] font-semibold text-slate-400 uppercase tracking-widest border-l border-slate-700/50"
                    >
                      Management
                    </th>
                  </tr>
                  <tr className="border-b border-slate-700">
                    {renderModuleColumns(STANDARD_MODULES)}
                    {renderModuleColumns(MANAGEMENT_MODULES)}
                  </tr>
                </thead>
                <tbody>
                  {matrixRoles.map((role) => (
                    <tr
                      key={role.id}
                      className="border-b border-slate-700/50 hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="sticky left-0 z-10 bg-slate-900/95 px-3 py-1 font-medium text-white whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {role.is_super_admin && (
                            <Shield className="h-3.5 w-3.5 text-purple-500 flex-shrink-0" />
                          )}
                          <span className="text-sm truncate">{role.display_name}</span>
                          {role.is_super_admin && (
                            <Badge variant="outline" className="text-purple-500 border-purple-500 text-[9px] px-1 py-0 flex-shrink-0">
                              Super Admin
                            </Badge>
                          )}
                          {role.name === 'admin' && !role.is_super_admin && (
                            <Badge variant="destructive" className="text-[9px] px-1 py-0 flex-shrink-0">
                              Admin
                            </Badge>
                          )}
                          {role.name === 'manager' && !role.is_super_admin && (
                            <Badge variant="warning" className="text-[9px] px-1 py-0 flex-shrink-0">
                              Manager
                            </Badge>
                          )}
                        </div>
                      </td>

                      {STANDARD_MODULES.map((mod) => renderPermissionCell(role, mod))}
                      {MANAGEMENT_MODULES.map((mod) => renderPermissionCell(role, mod))}
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
