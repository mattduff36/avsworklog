import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { getHiddenSystemTestAccountIds } from '@/lib/server/system-test-accounts';
import { isHiddenSystemTestAccountProfile } from '@/lib/utils/system-test-accounts';
import { hasRoleFullAccess } from '@/lib/utils/role-access';
import {
  ALL_MODULES,
  createEmptyModulePermissionRecord,
  MODULE_CSS_VAR,
  MODULE_DESCRIPTIONS,
  MODULE_DISPLAY_NAMES,
  MODULE_SHORT_NAMES,
  type ModuleName,
  type PermissionAccessLevel,
  type PermissionModuleMatrixColumn,
  type PermissionTierRole,
  type TeamPermissionMatrixRow,
  type UserPermissionMatrixRow,
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
  requires_sensitive_pin?: boolean | null;
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

type UserModulePermissionRow = {
  user_id: string;
  module_name: ModuleName;
  access_level: number;
};

type ProfilePermissionRow = {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  team_id: string | null;
  role_id: string | null;
  is_placeholder?: boolean | null;
  role?: RoleRow | RoleRow[] | null;
  team?: { id?: string | null; name?: string | null } | Array<{ id?: string | null; name?: string | null }> | null;
};

type AuthUserSummary = {
  id: string;
  email?: string | null;
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

export function normalizePermissionAccessLevel(value: number | null | undefined): PermissionAccessLevel {
  if (value === 5) return 5;
  if (value === 4) return 4;
  if (value === 3) return 3;
  if (value === 2) return 2;
  if (value === 1) return 1;
  return 0;
}

export function createEmptyModuleLevelRecord(): Record<ModuleName, PermissionAccessLevel> {
  return ALL_MODULES.reduce((acc, moduleName) => {
    acc[moduleName] = 0;
    return acc;
  }, {} as Record<ModuleName, PermissionAccessLevel>);
}

export function getAccessLevelForRole(
  role: Pick<RoleRow, 'name' | 'role_class' | 'is_super_admin' | 'hierarchy_rank'> | null | undefined
): PermissionAccessLevel {
  if (!role) return 0;
  if (isFullAccessRole(role)) return 5;
  return normalizePermissionAccessLevel(role.hierarchy_rank || 0);
}

export function buildUserPermissionLevelRecord(
  modules: Array<Pick<PermissionModuleMatrixColumn, 'module_name'>>,
  levelMap?: Map<ModuleName, number>
): Record<ModuleName, PermissionAccessLevel> {
  const permissionRecord = createEmptyModuleLevelRecord();

  modules.forEach((module) => {
    permissionRecord[module.module_name] = normalizePermissionAccessLevel(levelMap?.get(module.module_name));
  });

  return permissionRecord;
}

export function isFullAccessRole(role: Pick<RoleRow, 'name' | 'role_class' | 'is_super_admin'>): boolean {
  return hasRoleFullAccess(role);
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
  role: Pick<RoleRow, 'name' | 'role_class' | 'is_super_admin' | 'hierarchy_rank'>;
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

export function resolveModuleLevelForRoleRank(params: {
  role: Pick<RoleRow, 'name' | 'role_class' | 'is_super_admin' | 'hierarchy_rank'>;
  module: PermissionModuleMatrixColumn;
  enabled: boolean;
}): PermissionAccessLevel {
  const roleLevel = getAccessLevelForRole(params.role);
  if (roleLevel === 5) return 5;
  if (!params.enabled || typeof params.role.hierarchy_rank !== 'number') return 0;
  if (params.role.hierarchy_rank < params.module.minimum_hierarchy_rank) return 0;
  return roleLevel;
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
    message.includes('user_module_permissions') ||
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
  const roles = await getPermissionTierRoles(supabaseAdmin);
  return getPermissionModulesForRoles(roles, supabaseAdmin);
}

async function getPermissionModulesForRoles(
  roles: PermissionTierRole[],
  supabaseAdmin: SupabaseAdminClient
): Promise<PermissionModuleMatrixColumn[]> {
  const modulesResult = await supabaseAdmin
    .from('permission_modules')
    .select('module_name, minimum_role_id, requires_sensitive_pin, sort_order')
    .order('sort_order', { ascending: true });

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
        requires_sensitive_pin: row.requires_sensitive_pin === true,
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
  const [roles, teamsResult, permissionsResult] = await Promise.all([
    getPermissionTierRoles(supabaseAdmin),
    supabaseAdmin
      .from('org_teams')
      .select('id, name, code, active')
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('team_module_permissions')
      .select('team_id, module_name, enabled'),
  ]);
  const modules = await getPermissionModulesForRoles(roles, supabaseAdmin);

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

async function getAuthUserEmailMap(
  userIds: string[],
  supabaseAdmin: SupabaseAdminClient
): Promise<Map<string, string | null>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const emailMap = new Map<string, string | null>();
  const adminWithAuth = supabaseAdmin as SupabaseAdminClient & {
    auth?: {
      admin?: {
        listUsers?: (params?: { page?: number; perPage?: number }) => Promise<{
          data?: { users?: AuthUserSummary[] };
          error?: { message?: string } | null;
        }>;
      };
    };
  };

  const authAdmin = adminWithAuth.auth?.admin;
  if (!authAdmin?.listUsers) {
    return emailMap;
  }

  let page = 1;
  const perPage = 1000;
  const targetIds = new Set(userIds);

  while (emailMap.size < targetIds.size) {
    const { data, error } = await authAdmin.listUsers({ page, perPage });
    if (error) {
      throw new Error(error.message || 'Failed to load user emails');
    }

    const users = data?.users || [];
    users.forEach((user) => {
      if (targetIds.has(user.id)) {
        emailMap.set(user.id, user.email || null);
      }
    });

    if (users.length < perPage) {
      break;
    }
    page += 1;
  }

  return emailMap;
}

function getProfileRole(
  profile: Pick<ProfilePermissionRow, 'role'> & { role_id?: string | null },
  rolesById?: Map<string, RoleRow>
): RoleRow | null {
  if (Array.isArray(profile.role)) {
    return profile.role[0] || null;
  }
  if (profile.role) {
    return profile.role;
  }
  return profile.role_id && rolesById ? rolesById.get(profile.role_id) || null : null;
}

function getProfileTeamName(profile: Pick<ProfilePermissionRow, 'team'>): string | null {
  if (Array.isArray(profile.team)) {
    return profile.team[0]?.name || null;
  }
  return profile.team?.name || null;
}

function isDeletedProfile(profile: Pick<ProfilePermissionRow, 'full_name'>): boolean {
  return Boolean(profile.full_name?.includes('(Deleted User)'));
}

function buildTeamEnabledMap(permissionRows: TeamPermissionRow[]): Map<string, Map<ModuleName, boolean>> {
  const enabledByTeam = new Map<string, Map<ModuleName, boolean>>();

  permissionRows.forEach((row) => {
    if (!enabledByTeam.has(row.team_id)) {
      enabledByTeam.set(row.team_id, new Map<ModuleName, boolean>());
    }

    enabledByTeam.get(row.team_id)!.set(row.module_name, !!row.enabled);
  });

  return enabledByTeam;
}

function buildUserOverrideMap(permissionRows: UserModulePermissionRow[]): Map<string, Map<ModuleName, PermissionAccessLevel>> {
  const levelsByUser = new Map<string, Map<ModuleName, PermissionAccessLevel>>();

  permissionRows.forEach((row) => {
    if (!levelsByUser.has(row.user_id)) {
      levelsByUser.set(row.user_id, new Map<ModuleName, PermissionAccessLevel>());
    }

    levelsByUser.get(row.user_id)!.set(row.module_name, normalizePermissionAccessLevel(row.access_level));
  });

  return levelsByUser;
}

function getInheritedLevelsForProfile(params: {
  profile: Pick<ProfilePermissionRow, 'team_id' | 'role' | 'role_id'>;
  role: RoleRow | null;
  modules: PermissionModuleMatrixColumn[];
  enabledByTeam: Map<string, Map<ModuleName, boolean>>;
}): Record<ModuleName, PermissionAccessLevel> {
  const levels = createEmptyModuleLevelRecord();
  if (!params.role) return levels;

  params.modules.forEach((module) => {
    const enabled = params.profile.team_id
      ? params.enabledByTeam.get(params.profile.team_id)?.get(module.module_name) ?? false
      : false;
    levels[module.module_name] = resolveModuleLevelForRoleRank({
      role: params.role!,
      module,
      enabled,
    });
  });

  return levels;
}

function getEffectiveLevelsForProfile(params: {
  profile: Pick<ProfilePermissionRow, 'id' | 'team_id' | 'role' | 'role_id'>;
  role: RoleRow | null;
  modules: PermissionModuleMatrixColumn[];
  inheritedLevels: Record<ModuleName, PermissionAccessLevel>;
  overrideLevels?: Map<ModuleName, PermissionAccessLevel>;
}): Record<ModuleName, PermissionAccessLevel> {
  if (params.role && isFullAccessRole(params.role)) {
    return ALL_MODULES.reduce((acc, moduleName) => {
      acc[moduleName] = 5;
      return acc;
    }, {} as Record<ModuleName, PermissionAccessLevel>);
  }

  const levels = { ...params.inheritedLevels };
  params.modules.forEach((module) => {
    const override = params.overrideLevels?.get(module.module_name);
    if (override !== undefined) {
      levels[module.module_name] = override;
    }
  });

  return levels;
}

export async function getUserPermissionMatrix(
  supabaseAdmin: SupabaseAdminClient = createAdminClient()
): Promise<{
  roles: PermissionTierRole[];
  modules: PermissionModuleMatrixColumn[];
  users: UserPermissionMatrixRow[];
}> {
  const [roles, profilesResult, permissionsResult, teamPermissionsResult] = await Promise.all([
    getPermissionTierRoles(supabaseAdmin),
    supabaseAdmin
      .from('profiles')
      .select(
        'id, full_name, employee_id, team_id, role_id, is_placeholder, team:org_teams!profiles_team_id_fkey(id, name), role:roles(id, name, display_name, role_class, hierarchy_rank, is_super_admin, is_manager_admin)'
      )
      .order('full_name', { ascending: true }),
    supabaseAdmin
      .from('user_module_permissions')
      .select('user_id, module_name, access_level'),
    supabaseAdmin
      .from('team_module_permissions')
      .select('team_id, module_name, enabled'),
  ]);
  const modules = await getPermissionModulesForRoles(roles, supabaseAdmin);

  if (profilesResult.error) throw profilesResult.error;
  if (permissionsResult.error) throw permissionsResult.error;
  if (teamPermissionsResult.error) throw teamPermissionsResult.error;

  const typedProfiles = (profilesResult.data || []) as unknown as ProfilePermissionRow[];
  const hiddenIds = await getHiddenSystemTestAccountIds(supabaseAdmin as Parameters<typeof getHiddenSystemTestAccountIds>[0]);
  const visibleProfiles = typedProfiles.filter(
    (profile) => !hiddenIds.has(profile.id) && !isHiddenSystemTestAccountProfile(profile) && !isDeletedProfile(profile)
  );
  const emailMap = await getAuthUserEmailMap(
    visibleProfiles.map((profile) => profile.id),
    supabaseAdmin
  );
  const levelsByUser = buildUserOverrideMap((permissionsResult.data || []) as UserModulePermissionRow[]);
  const enabledByTeam = buildTeamEnabledMap((teamPermissionsResult.data || []) as TeamPermissionRow[]);

  const users = visibleProfiles.map((profile) => {
    const role = getProfileRole(profile);
    const inheritedPermissions = getInheritedLevelsForProfile({
      profile,
      role,
      modules,
      enabledByTeam,
    });
    const permissions = getEffectiveLevelsForProfile({
      profile,
      role,
      modules,
      inheritedLevels: inheritedPermissions,
      overrideLevels: levelsByUser.get(profile.id),
    });

    return {
      id: profile.id,
      full_name: profile.full_name,
      email: emailMap.get(profile.id) || null,
      employee_id: profile.employee_id,
      team_id: profile.team_id,
      team_name: getProfileTeamName(profile),
      role_id: profile.role_id,
      role_name: role?.name || null,
      role_display_name: role?.display_name || null,
      role_class: role?.role_class || null,
      is_super_admin: role?.is_super_admin === true,
      is_manager_admin: role?.is_manager_admin === true,
      is_locked_admin: role ? isFullAccessRole(role) : false,
      permissions,
      inherited_permissions: inheritedPermissions,
    } satisfies UserPermissionMatrixRow;
  });

  return { roles, modules, users };
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

export async function updateUserModulePermissionLevels(
  supabaseAdmin: SupabaseAdminClient,
  updates: Array<{ user_id: string; module_name: ModuleName; access_level: PermissionAccessLevel }>,
  actorUserId?: string | null
): Promise<void> {
  if (!updates.length) {
    return;
  }

  const targetUserIds = Array.from(new Set(updates.map((update) => update.user_id)));
  const { data: targetProfiles, error: targetError } = await supabaseAdmin
    .from('profiles')
    .select('id, role:roles(id, name, display_name, role_class, hierarchy_rank, is_super_admin, is_manager_admin)')
    .in('id', targetUserIds);

  if (targetError) {
    throw targetError;
  }

  const profilesById = new Map(
    ((targetProfiles || []) as unknown as ProfilePermissionRow[]).map((profile) => [profile.id, profile])
  );
  const lockedAdminIds = new Set(
    Array.from(profilesById.values())
      .filter((profile) => {
        const role = getProfileRole(profile);
        return role ? isFullAccessRole(role) : false;
      })
      .map((profile) => profile.id)
  );

  const invalidTargetId = targetUserIds.find((userId) => !profilesById.has(userId));
  if (invalidTargetId) {
    throw new Error(`User ${invalidTargetId} was not found.`);
  }

  if (updates.some((update) => lockedAdminIds.has(update.user_id))) {
    throw new Error('Admin users always have Level 5 access. Change their job role before editing module levels.');
  }

  const rows = updates.map((update) => ({
    user_id: update.user_id,
    module_name: update.module_name,
    access_level: normalizePermissionAccessLevel(update.access_level),
    updated_by: actorUserId || null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from('user_module_permissions')
    .upsert(rows, { onConflict: 'user_id,module_name' });

  if (error) {
    throw error;
  }
}

export async function shiftPermissionModuleTier(
  supabaseAdmin: SupabaseAdminClient,
  moduleName: ModuleName,
  direction: 'left' | 'right'
): Promise<PermissionModuleMatrixColumn> {
  const roles = await getPermissionTierRoles(supabaseAdmin);
  const modules = await getPermissionModulesForRoles(roles, supabaseAdmin);

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

export async function updatePermissionModuleSensitivePinRequirement(
  supabaseAdmin: SupabaseAdminClient,
  moduleName: ModuleName,
  requiresSensitivePin: boolean
): Promise<PermissionModuleMatrixColumn> {
  const roles = await getPermissionTierRoles(supabaseAdmin);
  const modules = await getPermissionModulesForRoles(roles, supabaseAdmin);
  const targetModule = modules.find((entry) => entry.module_name === moduleName);

  if (!targetModule) {
    throw new Error(`Module ${moduleName} is not configured for the permission matrix.`);
  }

  const { error } = await supabaseAdmin
    .from('permission_modules')
    .update({
      requires_sensitive_pin: requiresSensitivePin,
      updated_at: new Date().toISOString(),
    })
    .eq('module_name', moduleName);

  if (error) {
    throw error;
  }

  return {
    ...targetModule,
    requires_sensitive_pin: requiresSensitivePin,
  };
}

export async function getPermissionLevelsForUser(
  userId: string,
  effectiveRoleId?: string | null,
  supabaseAdmin: SupabaseAdminClient = createAdminClient(),
  effectiveTeamId?: string | null
): Promise<Record<ModuleName, PermissionAccessLevel>> {
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
    return createEmptyModuleLevelRecord();
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
    return createEmptyModuleLevelRecord();
  }

  const teamId = effectiveTeamId || profile?.team_id || null;

  const [modules, teamPermissionsResult, userPermissionsResult] = await Promise.all([
    getPermissionModules(supabaseAdmin),
    supabaseAdmin
      .from('team_module_permissions')
      .select('module_name, enabled')
      .eq('team_id', teamId || ''),
    supabaseAdmin
      .from('user_module_permissions')
      .select('module_name, access_level')
      .eq('user_id', userId),
  ]);

  if (teamPermissionsResult.error) {
    throw teamPermissionsResult.error;
  }
  if (userPermissionsResult.error) {
    throw userPermissionsResult.error;
  }

  const enabledByModule = new Map<ModuleName, boolean>();
  ((teamPermissionsResult.data || []) as Array<{ module_name: ModuleName; enabled: boolean }>).forEach(
    (row) => {
      enabledByModule.set(row.module_name, !!row.enabled);
    }
  );

  const inheritedLevels = getInheritedLevelsForProfile({
    profile: { team_id: teamId, role_id: resolvedRoleId, role },
    modules,
    role,
    enabledByTeam: teamId
      ? new Map([[teamId, enabledByModule]])
      : new Map<string, Map<ModuleName, boolean>>(),
  });
  const overrides = new Map<ModuleName, PermissionAccessLevel>();
  ((userPermissionsResult.data || []) as Array<{ module_name: ModuleName; access_level: number }>).forEach(
    (row) => {
      overrides.set(row.module_name, normalizePermissionAccessLevel(row.access_level));
    }
  );

  return getEffectiveLevelsForProfile({
    profile: { id: userId, team_id: teamId, role_id: resolvedRoleId, role },
    role,
    modules,
    inheritedLevels,
    overrideLevels: overrides,
  });
}

export async function getPermissionSetForUser(
  userId: string,
  effectiveRoleId?: string | null,
  supabaseAdmin: SupabaseAdminClient = createAdminClient(),
  effectiveTeamId?: string | null
): Promise<Set<ModuleName>> {
  const levels = await getPermissionLevelsForUser(userId, effectiveRoleId, supabaseAdmin, effectiveTeamId);
  return new Set<ModuleName>(
    ALL_MODULES.filter((moduleName) => (levels[moduleName] || 0) > 0)
  );
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

export async function getUsersWithModuleAccess(
  moduleName: ModuleName,
  userIds?: string[],
  supabaseAdmin: SupabaseAdminClient = createAdminClient()
): Promise<Set<string>> {
  if (userIds && userIds.length === 0) {
    return new Set<string>();
  }

  const profilesQuery = supabaseAdmin.from('profiles').select('id, team_id, role_id, employee_id, full_name, is_placeholder');
  const scopedProfilesQuery = userIds?.length ? profilesQuery.in('id', userIds) : profilesQuery;

  const [{ data: profiles, error: profilesError }, { data: roles, error: rolesError }, modules] =
    await Promise.all([
      scopedProfilesQuery,
      supabaseAdmin
        .from('roles')
        .select('id, name, display_name, role_class, hierarchy_rank, is_super_admin, is_manager_admin'),
      getPermissionModules(supabaseAdmin),
    ]);

  if (profilesError) {
    throw profilesError;
  }
  if (rolesError) {
    throw rolesError;
  }

  const targetModule = modules.find((module) => module.module_name === moduleName);
  if (!targetModule) {
    return new Set<string>();
  }

  const typedProfiles = (profiles || []) as Array<{
    id: string;
    team_id: string | null;
    role_id: string | null;
    employee_id?: string | null;
    full_name?: string | null;
    is_placeholder?: boolean | null;
  }>;

  const hiddenIds = await getHiddenSystemTestAccountIds(supabaseAdmin as Parameters<typeof getHiddenSystemTestAccountIds>[0]);
  const visibleProfiles = typedProfiles.filter(
    (profile) => !hiddenIds.has(profile.id) && !isHiddenSystemTestAccountProfile(profile)
  );

  if (visibleProfiles.length === 0) {
    return new Set<string>();
  }

  const teamIds = Array.from(
    new Set(visibleProfiles.map((profile) => profile.team_id).filter((teamId): teamId is string => Boolean(teamId)))
  );

  const enabledByTeam = new Map<string, Map<ModuleName, boolean>>();
  const visibleUserIds = visibleProfiles.map((profile) => profile.id);
  const { data: userPermissionRows, error: userPermissionError } = await supabaseAdmin
    .from('user_module_permissions')
    .select('user_id, module_name, access_level')
    .in('user_id', visibleUserIds)
    .eq('module_name', moduleName);

  if (userPermissionError) {
    throw userPermissionError;
  }

  const accessLevelByUser = new Map(
    ((userPermissionRows || []) as UserModulePermissionRow[]).map((row) => [
      row.user_id,
      normalizePermissionAccessLevel(row.access_level),
    ])
  );

  if (teamIds.length > 0) {
    const { data: teamPermissions, error: teamPermissionsError } = await supabaseAdmin
      .from('team_module_permissions')
      .select('team_id, module_name, enabled')
      .in('team_id', teamIds);

    if (teamPermissionsError) {
      throw teamPermissionsError;
    }

    ((teamPermissions || []) as TeamPermissionRow[]).forEach((row) => {
      if (!enabledByTeam.has(row.team_id)) {
        enabledByTeam.set(row.team_id, new Map<ModuleName, boolean>());
      }

      enabledByTeam.get(row.team_id)!.set(row.module_name, !!row.enabled);
    });
  }

  const rolesById = new Map(((roles || []) as RoleRow[]).map((role) => [role.id, role]));
  const allowedUsers = new Set<string>();

  visibleProfiles.forEach((profile) => {
    if (!profile.role_id) {
      return;
    }

    const role = rolesById.get(profile.role_id);
    if (!role) {
      return;
    }

    if (isFullAccessRole(role)) {
      allowedUsers.add(profile.id);
      return;
    }

    const overrideLevel = accessLevelByUser.get(profile.id);
    if (overrideLevel !== undefined) {
      if (overrideLevel > 0) {
        allowedUsers.add(profile.id);
      }
      return;
    }

    if (typeof role.hierarchy_rank !== 'number' || !profile.team_id) {
      return;
    }

    if (
      (enabledByTeam.get(profile.team_id)?.get(moduleName) ?? false) &&
      role.hierarchy_rank >= targetModule.minimum_hierarchy_rank
    ) {
      allowedUsers.add(profile.id);
    }
  });

  return allowedUsers;
}
