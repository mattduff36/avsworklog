import pg from 'pg';
import {
  getModuleEnforcedMinimumAccessLevel,
  isPermissionLevelAllowedForModule,
  moduleRequiresFullAccessRole,
} from '@/lib/config/permission-access-rules';
import { MODULE_DISPLAY_NAMES } from '@/types/roles';
import type { ModuleName, PermissionAccessLevel } from '@/types/roles';
import {
  getAccessLevelForRole,
  InvalidPermissionLevelError,
} from '@/lib/server/team-permissions';
import { hasRoleFullAccess } from '@/lib/utils/role-access';

const { Client } = pg;

interface PermissionMatrixPgResult<Row = Record<string, unknown>> {
  rows: Row[];
}

export interface PermissionMatrixPgClient {
  connect(): Promise<void>;
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<PermissionMatrixPgResult<Row>>;
  end(): Promise<void>;
}

export type PermissionMatrixPgClientFactory = () => PermissionMatrixPgClient;

interface PermissionModuleRow {
  module_name: ModuleName;
  minimum_hierarchy_rank: number;
}

interface PermissionProfileRow {
  id: string;
  team_id: string | null;
  role_id: string;
  role_name: string;
  role_class: 'admin' | 'manager' | 'employee';
  hierarchy_rank: number | null;
  is_super_admin: boolean;
}

interface TeamDefaultRow {
  team_id: string;
  module_name: ModuleName;
  enabled: boolean;
}

interface UserPermissionRow {
  user_id: string;
  module_name: ModuleName;
  access_level: number;
}

export interface PermissionMatrixMutationInput {
  actorUserId: string;
  userUpdates: Array<{
    user_id: string;
    module_name: ModuleName;
    access_level: PermissionAccessLevel;
  }>;
  teamDefaultUpdates: Array<{
    team_id: string;
    module_name: ModuleName;
    enabled: boolean;
  }>;
}

function createPermissionMatrixPgClient(): PermissionMatrixPgClient {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('Missing database connection string for permission updates');
  }

  const url = new URL(connectionString);
  return new Client({
    host: url.hostname,
    port: Number.parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: { rejectUnauthorized: false },
  }) as PermissionMatrixPgClient;
}

function getModuleRule(module: PermissionModuleRow) {
  return {
    module_name: module.module_name,
    enforced_minimum_access_level: getModuleEnforcedMinimumAccessLevel(
      module.module_name,
      module.minimum_hierarchy_rank
    ),
    requires_full_access_role: moduleRequiresFullAccessRole(module.module_name),
  };
}

function getRoleDefaultLevel(
  profile: PermissionProfileRow,
  module: PermissionModuleRow,
  enabled: boolean
): PermissionAccessLevel {
  if (hasRoleFullAccess({
    name: profile.role_name,
    role_class: profile.role_class,
    is_super_admin: profile.is_super_admin,
  })) {
    return 5;
  }

  const moduleRule = getModuleRule(module);
  const roleLevel = getAccessLevelForRole({
    name: profile.role_name,
    role_class: profile.role_class,
    hierarchy_rank: profile.hierarchy_rank,
    is_super_admin: profile.is_super_admin,
  });

  if (!enabled || profile.hierarchy_rank === null) return 0;
  if (moduleRule.requires_full_access_role) return 0;
  if (profile.hierarchy_rank < moduleRule.enforced_minimum_access_level) return 0;
  return roleLevel;
}

export async function applyPermissionMatrixUpdatesAtomically(
  input: PermissionMatrixMutationInput,
  createClient: PermissionMatrixPgClientFactory = createPermissionMatrixPgClient
): Promise<void> {
  if (!input.userUpdates.length && !input.teamDefaultUpdates.length) return;

  const client = createClient();
  await client.connect();

  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');

    const moduleNames = Array.from(new Set([
      ...input.userUpdates.map((update) => update.module_name),
      ...input.teamDefaultUpdates.map((update) => update.module_name),
    ]));
    const teamIds = Array.from(new Set(input.teamDefaultUpdates.map((update) => update.team_id)));
    const targetUserIds = Array.from(new Set(input.userUpdates.map((update) => update.user_id)));

    const moduleResult = await client.query<PermissionModuleRow>(
      `
        SELECT
          pm.module_name,
          minimum_role.hierarchy_rank AS minimum_hierarchy_rank
        FROM public.permission_modules pm
        INNER JOIN public.roles minimum_role ON minimum_role.id = pm.minimum_role_id
        WHERE pm.module_name = ANY($1::text[])
        FOR UPDATE OF pm
      `,
      [moduleNames]
    );
    const modulesByName = new Map(
      moduleResult.rows.map((module) => [module.module_name, module])
    );
    const missingModule = moduleNames.find((moduleName) => !modulesByName.has(moduleName));
    if (missingModule) {
      throw new InvalidPermissionLevelError(
        `Module ${missingModule} is not configured for the permission matrix.`
      );
    }

    const profileResult = await client.query<PermissionProfileRow>(
      `
        SELECT
          profile.id,
          profile.team_id,
          profile.role_id,
          role.name AS role_name,
          role.role_class,
          role.hierarchy_rank,
          role.is_super_admin
        FROM public.profiles profile
        INNER JOIN public.roles role ON role.id = profile.role_id
        WHERE profile.id = ANY($1::uuid[])
           OR profile.team_id = ANY($2::uuid[])
        FOR UPDATE OF profile
      `,
      [targetUserIds, teamIds]
    );
    const profilesById = new Map(profileResult.rows.map((profile) => [profile.id, profile]));

    const missingUserId = targetUserIds.find((userId) => !profilesById.has(userId));
    if (missingUserId) {
      throw new Error(`User ${missingUserId} was not found.`);
    }

    input.userUpdates.forEach((update) => {
      const profile = profilesById.get(update.user_id)!;
      if (hasRoleFullAccess({
        name: profile.role_name,
        role_class: profile.role_class,
        is_super_admin: profile.is_super_admin,
      })) {
        throw new Error(
          'Admin users always have Level 5 access. Change their job role before editing module levels.'
        );
      }

      const permissionModule = modulesByName.get(update.module_name)!;
      const moduleRule = getModuleRule(permissionModule);
      if (!isPermissionLevelAllowedForModule(moduleRule, update.access_level, {
        hasFullAccessRole: false,
      })) {
        const reason = moduleRule.requires_full_access_role
          ? 'it requires an Admin/Super Admin job role'
          : `use Level ${moduleRule.enforced_minimum_access_level} or higher`;
        throw new InvalidPermissionLevelError(
          `${MODULE_DISPLAY_NAMES[update.module_name]} cannot be set to Level ${update.access_level}; ${reason}.`
        );
      }
    });

    const defaultResult = teamIds.length
      ? await client.query<TeamDefaultRow>(
          `
            SELECT team_id, module_name, enabled
            FROM public.team_module_permissions
            WHERE team_id = ANY($1::uuid[])
              AND module_name = ANY($2::text[])
            FOR UPDATE
          `,
          [teamIds, moduleNames]
        )
      : { rows: [] };
    const existingDefaults = new Map(
      defaultResult.rows.map((row) => [`${row.team_id}:${row.module_name}`, row.enabled])
    );

    const candidateProfiles = profileResult.rows.filter((profile) => (
      profile.team_id
      && teamIds.includes(profile.team_id)
      && !hasRoleFullAccess({
        name: profile.role_name,
        role_class: profile.role_class,
        is_super_admin: profile.is_super_admin,
      })
    ));
    const candidateUserIds = candidateProfiles.map((profile) => profile.id);
    const existingUserResult = candidateUserIds.length
      ? await client.query<UserPermissionRow>(
          `
            SELECT user_id, module_name, access_level
            FROM public.user_module_permissions
            WHERE user_id = ANY($1::uuid[])
              AND module_name = ANY($2::text[])
            FOR UPDATE
          `,
          [candidateUserIds, moduleNames]
        )
      : { rows: [] };
    const existingUserLevels = new Map(
      existingUserResult.rows.map((row) => [
        `${row.user_id}:${row.module_name}`,
        row.access_level as PermissionAccessLevel,
      ])
    );

    const cascadeRows: Array<{
      userId: string;
      moduleName: ModuleName;
      accessLevel: PermissionAccessLevel;
    }> = [];
    input.teamDefaultUpdates.forEach((update) => {
      const permissionModule = modulesByName.get(update.module_name)!;
      const oldEnabled = existingDefaults.get(`${update.team_id}:${update.module_name}`) ?? false;

      candidateProfiles
        .filter((profile) => profile.team_id === update.team_id)
        .forEach((profile) => {
          const oldDefault = getRoleDefaultLevel(profile, permissionModule, oldEnabled);
          const currentLevel = existingUserLevels.get(`${profile.id}:${update.module_name}`)
            ?? oldDefault;
          if (currentLevel !== oldDefault) return;

          cascadeRows.push({
            userId: profile.id,
            moduleName: update.module_name,
            accessLevel: getRoleDefaultLevel(profile, permissionModule, update.enabled),
          });
        });
    });

    for (const update of input.teamDefaultUpdates) {
      await client.query(
        `
          INSERT INTO public.team_module_permissions (
            team_id,
            module_name,
            enabled,
            updated_at
          )
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (team_id, module_name)
          DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()
        `,
        [update.team_id, update.module_name, update.enabled]
      );
    }

    for (const row of cascadeRows) {
      await client.query(
        `
          INSERT INTO public.user_module_permissions (
            user_id,
            module_name,
            access_level,
            updated_by,
            updated_at
          )
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (user_id, module_name)
          DO UPDATE SET
            access_level = EXCLUDED.access_level,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
        `,
        [row.userId, row.moduleName, row.accessLevel, input.actorUserId]
      );
    }

    for (const update of input.userUpdates) {
      await client.query(
        `
          INSERT INTO public.user_module_permissions (
            user_id,
            module_name,
            access_level,
            updated_by,
            updated_at
          )
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (user_id, module_name)
          DO UPDATE SET
            access_level = EXCLUDED.access_level,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
        `,
        [
          update.user_id,
          update.module_name,
          update.access_level,
          input.actorUserId,
        ]
      );
    }

    // Minimum audit trail for permission matrix changes (includes Admin Settings Level 5 grants).
    await client.query(
      `
        INSERT INTO public.audit_log (
          table_name,
          record_id,
          user_id,
          action,
          changes
        )
        VALUES (
          'user_module_permissions',
          $1::text,
          $2::uuid,
          'permission_matrix_update',
          $3::jsonb
        )
      `,
      [
        input.actorUserId,
        input.actorUserId,
        JSON.stringify({
          user_updates: input.userUpdates,
          team_default_updates: input.teamDefaultUpdates,
          cascaded_user_updates: cascadeRows.map((row) => ({
            user_id: row.userId,
            module_name: row.moduleName,
            access_level: row.accessLevel,
          })),
        }),
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
