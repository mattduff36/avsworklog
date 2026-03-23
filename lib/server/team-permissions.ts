import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  ALL_MODULES,
  createEmptyModulePermissionRecord,
  MODULE_CSS_VAR,
  MODULE_DESCRIPTIONS,
  MODULE_DISPLAY_NAMES,
  MODULE_SHORT_NAMES,
  type ModuleName,
  type PermissionModuleMatrixColumn,
  type PermissionTierRole,
  type TeamPermissionMatrixRow,
} from '@/types/roles';

type SupabaseAdminClient = SupabaseClient;

type RoleRow = {
  id: string;
  name: string;
  display_name: string;
  role_class: 'admin' | 'manager' | 'employee';
  hierarchy_rank: number | null;
  is_super_admin: boolean;
  is_manager_admin: boolean;
};

type PermissionModuleRow = {
  module_name: ModuleName;
  minimum_role_id: string;
  sort_order: number;
};

type TeamPermissionRow = {
  team_id: string;
  module_name: ModuleName;
  enabled: boolean;
};

type TeamRow = {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
};

export function buildTeamPermissionRecord(
  modules: Array<Pick<PermissionModuleMatrixColumn, 'module_name'>>,
  enabledMap?: Map<ModuleName, boolean>
): Record<ModuleName, boolean> {
  const permissionRecord = createEmptyModulePermissionRecord();

  modules.forEach((module) => {
    permissionRecord[module.module_name] = enabledMap?.get(module.module_name) ?? false;
  });

  return permissionRecord;
}

export function isFullAccessRole(role: Pick<RoleRow, 'name' | 'is_super_admin'>): boolean {
  return role.is_super_admin || role.name === 'admin';
}

export function getAdjacentTierRole(
  roles: PermissionTierRole[],
  currentRoleId: string,
  direction: 'left' | 'right'
): PermissionTierRole | null {
  const currentIndex = roles.findIndex((role) => role.id === currentRoleId);
  if (currentIndex === -1) {
    return null;
  }

  const nextIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
  return roles[nextIndex] || null;
}

export function resolveModulesForRoleRank(params: {
  role: Pick<RoleRow, 'name' | 'is_super_admin' | 'hierarchy_rank'>;
  modules: PermissionModuleMatrixColumn[];
  enabledByModule: Map<ModuleName, boolean>;
}): Set<ModuleName> {
  if (isFullAccessRole(params.role)) {
    return new Set<ModuleName>(ALL_MODULES);
  }

  if (typeof params.role.hierarchy_rank !== 'number') {
    return new Set<ModuleName>();
  }

  const enabledModules = new Set<ModuleName>();
  params.modules.forEach((module) => {
    if (
      (params.enabledByModule.get(module.module_name) ?? false) &&
      params.role.hierarchy_rank! >= module.minimum_hierarchy_rank
    ) {
      enabledModules.add(module.module_name);
    }
  });

  return enabledModules;
}

export function isMissingTeamPermissionSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message =
    'message' in error ? String((error as { message?: unknown }).message || '').toLowerCase() : '';

  return (
    code === '42P01' ||
    code === '42703' ||
    message.includes('permission_modules') ||
    message.includes('team_module_permissions') ||
    message.includes('hierarchy_rank') ||
    message.includes('minimum_role_id') ||
    message.includes('does not exist')
  );
}

export async function getPermissionTierRoles(
  supabaseAdmin: SupabaseAdminClient = createAdminClient()
): Promise<PermissionTierRole[]> {
  const { data, error } = await supabaseAdmin
    .from('roles')
    .select('id, name, display_name, role_class, hierarchy_rank, is_super_admin, is_manager_admin')
    .not('hierarchy_rank', 'is', null)
    .order('hierarchy_rank', { ascending: true })
    .order('display_name', { ascending: true });

  if (error) {
    throw error;
  }

  return ((data || []) as RoleRow[])
    .filter((role) => !role.is_super_admin && role.name !== 'admin')
    .map((role) => ({
      id: role.id,
      name: role.name,
      display_name: role.display_name,
      role_class: role.role_class,
      hierarchy_rank: role.hierarchy_rank || 0,
      is_super_admin: role.is_super_admin,
      is_manager_admin: role.is_manager_admin,
    }));
}

export async function ensureTeamPermissionRows(
  teamId: string,
  supabaseAdmin: SupabaseAdminClient = createAdminClient()
): Promise<void> {
  const [{ data: modules, error: modulesError }, { data: existingRows, error: existingError }] =
    await Promise.all([
      supabaseAdmin.from('permission_modules').select('module_name'),
      supabaseAdmin.from('team_module_permissions').select('module_name').eq('team_id', teamId),
    ]);

  if (modulesError) {
    throw modulesError;
  }
  if (existingError) {
    throw existingError;
  }

  const existing = new Set(
    ((existingRows || []) as Array<{ module_name: ModuleName }>).map((row) => row.module_name)
  );
  const missingRows = ((modules || []) as Array<{ module_name: ModuleName }>)
    .filter((row) => !existing.has(row.module_name))
    .map((row) => ({
      team_id: teamId,
      module_name: row.module_name,
      enabled: false,
    }));

  if (!missingRows.length) {
    return;
  }

  const { error } = await supabaseAdmin
    .from('team_module_permissions')
    .upsert(missingRows, { onConflict: 'team_id,module_name' });

  if (error) {
    throw error;
  }
}

export async function getPermissionModules(
  supabaseAdmin: SupabaseAdminClient = createAdminClient()
): Promise<PermissionModuleMatrixColumn[]> {
  const [roles, modulesResult] = await Promise.all([
    getPermissionTierRoles(supabaseAdmin),
    supabaseAdmin
      .from('permission_modules')
      .select('module_name, minimum_role_id, sort_order')
      .order('sort_order', { ascending: true }),
  ]);

  if (modulesResult.error) {
    throw modulesResult.error;
  }

  const rolesById = new Map(roles.map((role) => [role.id, role]));

  return ((modulesResult.data || []) as PermissionModuleRow[])
    .filter((row) => ALL_MODULES.includes(row.module_name))
    .map((row) => {
      const role = rolesById.get(row.minimum_role_id);
      if (!role) {
        throw new Error(`Permission module ${row.module_name} points to an unknown tier role.`);
      }

      return {
        module_name: row.module_name,
        display_name: MODULE_DISPLAY_NAMES[row.module_name],
        short_name: MODULE_SHORT_NAMES[row.module_name],
        description: MODULE_DESCRIPTIONS[row.module_name],
        color_var: MODULE_CSS_VAR[row.module_name],
        minimum_role_id: row.minimum_role_id,
        minimum_role_name: role.display_name,
        minimum_hierarchy_rank: role.hierarchy_rank,
        sort_order: row.sort_order,
      };
    });
}

export async function getTeamPermissionMatrix(
  supabaseAdmin: SupabaseAdminClient = createAdminClient()
): Promise<{
  roles: PermissionTierRole[];
  modules: PermissionModuleMatrixColumn[];
  teams: TeamPermissionMatrixRow[];
}> {
  const [roles, modules, teamsResult, permissionsResult] = await Promise.all([
    getPermissionTierRoles(supabaseAdmin),
    getPermissionModules(supabaseAdmin),
    supabaseAdmin
      .from('org_teams')
      .select('id, name, code, active')
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('team_module_permissions')
      .select('team_id, module_name, enabled'),
  ]);

  if (teamsResult.error) {
    throw teamsResult.error;
  }
  if (permissionsResult.error) {
    throw permissionsResult.error;
  }

  const permissionRows = (permissionsResult.data || []) as TeamPermissionRow[];
  const enabledByTeam = new Map<string, Map<ModuleName, boolean>>();

  permissionRows.forEach((row) => {
    if (!enabledByTeam.has(row.team_id)) {
      enabledByTeam.set(row.team_id, new Map<ModuleName, boolean>());
    }
    enabledByTeam.get(row.team_id)!.set(row.module_name, !!row.enabled);
  });

  const teams = ((teamsResult.data || []) as TeamRow[])
    .filter((team) => team.active)
    .map((team) => {
      const enabledMap = enabledByTeam.get(team.id) || new Map<ModuleName, boolean>();

      return {
        id: team.id,
        name: team.name,
        code: team.code,
        active: team.active,
        permissions: buildTeamPermissionRecord(modules, enabledMap),
      };
    });

  return { roles, modules, teams };
}

export async function updateTeamModulePermissions(
  supabaseAdmin: SupabaseAdminClient,
  teamId: string,
  permissions: Array<{ module_name: ModuleName; enabled: boolean }>
): Promise<void> {
  if (!permissions.length) {
    return;
  }

  const rows = permissions.map((permission) => ({
    team_id: teamId,
    module_name: permission.module_name,
    enabled: permission.enabled,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from('team_module_permissions')
    .upsert(rows, { onConflict: 'team_id,module_name' });

  if (error) {
    throw error;
  }
}

export async function shiftPermissionModuleTier(
  supabaseAdmin: SupabaseAdminClient,
  moduleName: ModuleName,
  direction: 'left' | 'right'
): Promise<PermissionModuleMatrixColumn> {
  const [roles, modules] = await Promise.all([
    getPermissionTierRoles(supabaseAdmin),
    getPermissionModules(supabaseAdmin),
  ]);

  const targetModule = modules.find((entry) => entry.module_name === moduleName);
  if (!targetModule) {
    throw new Error(`Module ${moduleName} is not configured for the permission matrix.`);
  }

  const nextRole = getAdjacentTierRole(roles, targetModule.minimum_role_id, direction);
  if (!roles.find((role) => role.id === targetModule.minimum_role_id)) {
    throw new Error(`Module ${moduleName} is assigned to an unknown tier role.`);
  }
  if (!nextRole) {
    throw new Error(`Module ${moduleName} cannot move ${direction} any further.`);
  }

  const { error } = await supabaseAdmin
    .from('permission_modules')
    .update({
      minimum_role_id: nextRole.id,
      updated_at: new Date().toISOString(),
    })
    .eq('module_name', moduleName);

  if (error) {
    throw error;
  }

  return {
    ...targetModule,
    minimum_role_id: nextRole.id,
    minimum_role_name: nextRole.display_name,
    minimum_hierarchy_rank: nextRole.hierarchy_rank,
  };
}

export async function getPermissionSetForUser(
  userId: string,
  effectiveRoleId?: string | null,
  supabaseAdmin: SupabaseAdminClient = createAdminClient(),
  effectiveTeamId?: string | null
): Promise<Set<ModuleName>> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, team_id, role_id')
    .eq('id', userId)
    .single();

  if (error) {
    throw error;
  }

  const profile = data as {
    team_id?: string | null;
    role_id?: string | null;
  } | null;

  const resolvedRoleId = effectiveRoleId || profile?.role_id || null;

  if (!resolvedRoleId) {
    return new Set<ModuleName>();
  }

  const { data: roleData, error: roleError } = await supabaseAdmin
    .from('roles')
    .select('id, name, display_name, role_class, hierarchy_rank, is_super_admin, is_manager_admin')
    .eq('id', resolvedRoleId)
    .single();

  if (roleError) {
    throw roleError;
  }

  const role = roleData as RoleRow | null;

  if (!role) {
    return new Set<ModuleName>();
  }

  const teamId = effectiveTeamId || profile?.team_id || null;
  if (!teamId) {
    return resolveModulesForRoleRank({
      role,
      modules: [],
      enabledByModule: new Map<ModuleName, boolean>(),
    });
  }

  const [modules, teamPermissionsResult] = await Promise.all([
    getPermissionModules(supabaseAdmin),
    supabaseAdmin
      .from('team_module_permissions')
      .select('module_name, enabled')
      .eq('team_id', teamId),
  ]);

  if (teamPermissionsResult.error) {
    throw teamPermissionsResult.error;
  }

  const enabledByModule = new Map<ModuleName, boolean>();
  ((teamPermissionsResult.data || []) as Array<{ module_name: ModuleName; enabled: boolean }>).forEach(
    (row) => {
      enabledByModule.set(row.module_name, !!row.enabled);
    }
  );

  return resolveModulesForRoleRank({
    role,
    modules,
    enabledByModule,
  });
}

export async function getPermissionMapForUser(
  userId: string,
  effectiveRoleId?: string | null,
  supabaseAdmin: SupabaseAdminClient = createAdminClient(),
  effectiveTeamId?: string | null
): Promise<Record<ModuleName, boolean>> {
  const permissionSet = await getPermissionSetForUser(
    userId,
    effectiveRoleId,
    supabaseAdmin,
    effectiveTeamId
  );
  const permissionMap = createEmptyModulePermissionRecord();

  permissionSet.forEach((moduleName) => {
    permissionMap[moduleName] = true;
  });

  return permissionMap;
}
