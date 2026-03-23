import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { isRetiredRoleName } from '../../lib/config/roles-core';
import {
  CANONICAL_TEAMS,
  inferTargetRoleNameFromLegacy,
  inferTargetTeamFromLegacy,
} from '../../lib/utils/role-team-migration';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

type RoleRow = {
  id: string;
  name: string;
  role_class: 'admin' | 'manager' | 'employee';
  hierarchy_rank?: number | null;
  is_super_admin: boolean;
  is_manager_admin: boolean;
};

type ProfileWithRole = {
  id: string;
  full_name: string | null;
  team_id: string | null;
  role_id: string | null;
  role_name: string | null;
  role_class: 'admin' | 'manager' | 'employee' | null;
  is_super_admin: boolean | null;
  is_manager_admin: boolean | null;
};

const CORE_ROLES: Array<{
  name: 'employee' | 'contractor' | 'supervisor' | 'manager' | 'admin';
  display_name: string;
  description: string;
  role_class: 'employee' | 'manager' | 'admin';
  hierarchy_rank: number;
  is_manager_admin: boolean;
}> = [
  {
    name: 'employee',
    display_name: 'Employee',
    description: 'Standard employee role.',
    role_class: 'employee',
    hierarchy_rank: 2,
    is_manager_admin: false,
  },
  {
    name: 'contractor',
    display_name: 'Contractor',
    description: 'Contractor role.',
    role_class: 'employee',
    hierarchy_rank: 1,
    is_manager_admin: false,
  },
  {
    name: 'supervisor',
    display_name: 'Supervisor',
    description: 'Supervisor role for tiered module access.',
    role_class: 'employee',
    hierarchy_rank: 3,
    is_manager_admin: false,
  },
  {
    name: 'manager',
    display_name: 'Manager',
    description: 'Manager role with approval capabilities.',
    role_class: 'manager',
    hierarchy_rank: 4,
    is_manager_admin: true,
  },
  {
    name: 'admin',
    display_name: 'Admin',
    description: 'Administrator role.',
    role_class: 'admin',
    hierarchy_rank: 999,
    is_manager_admin: true,
  },
];

async function getClient(): Promise<pg.Client> {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL is not set in .env.local');
  }

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  return client;
}

async function ensureCanonicalTeams(client: pg.Client): Promise<void> {
  for (const team of CANONICAL_TEAMS) {
    await client.query(
      `
      INSERT INTO org_teams (id, name, code, active)
      VALUES ($1, $2, $1, TRUE)
      ON CONFLICT (id)
      DO UPDATE SET name = EXCLUDED.name, active = TRUE, updated_at = NOW()
      `,
      [team.id, team.name]
    );
  }

  await client.query(
    `
    UPDATE org_teams
    SET active = FALSE, updated_at = NOW()
    WHERE id <> ALL($1::text[])
    `,
    [CANONICAL_TEAMS.map((team) => team.id)]
  );

  for (const team of CANONICAL_TEAMS) {
    await client.query(
      `
      INSERT INTO org_team_feature_modes (team_id, workflow_name, mode, effective_from)
      VALUES ($1, 'absence_leave', 'org_v2', NOW())
      ON CONFLICT (team_id, workflow_name)
      DO UPDATE SET mode = 'org_v2', effective_from = NOW(), updated_at = NOW()
      `,
      [team.id]
    );
  }
}

async function ensureCoreRoles(client: pg.Client): Promise<Record<'employee' | 'contractor' | 'supervisor' | 'manager' | 'admin', string>> {
  const { rows: existingRoles } = await client.query<RoleRow>(`
    SELECT id, name, role_class, hierarchy_rank, is_super_admin, is_manager_admin
    FROM roles
  `);
  const roleByName = new Map(existingRoles.map((row) => [row.name, row]));

  const roleIds = {} as Record<'employee' | 'contractor' | 'supervisor' | 'manager' | 'admin', string>;

  for (const role of CORE_ROLES) {
    if (!roleByName.has(role.name)) {
      const { rows } = await client.query<{ id: string }>(
        `
        INSERT INTO roles (name, display_name, description, role_class, hierarchy_rank, is_super_admin, is_manager_admin)
        VALUES ($1, $2, $3, $4, $5, FALSE, $6)
        RETURNING id
        `,
        [role.name, role.display_name, role.description, role.role_class, role.hierarchy_rank, role.is_manager_admin]
      );
      roleIds[role.name] = rows[0].id;
      console.log(`Created core role: ${role.name}`);
    } else {
      roleIds[role.name] = roleByName.get(role.name)!.id;
      await client.query(
        `
        UPDATE roles
        SET hierarchy_rank = $2,
            updated_at = NOW()
        WHERE id = $1
          AND hierarchy_rank IS DISTINCT FROM $2
        `,
        [roleIds[role.name], role.hierarchy_rank]
      );
    }
  }

  return roleIds;
}

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    await ensureCanonicalTeams(client);
    const coreRoleIds = await ensureCoreRoles(client);

    const { rows: profiles } = await client.query<ProfileWithRole>(`
      SELECT
        p.id,
        p.full_name,
        p.team_id,
        p.role_id,
        r.name AS role_name,
        r.role_class,
        r.is_super_admin,
        r.is_manager_admin
      FROM profiles p
      LEFT JOIN roles r ON r.id = p.role_id
    `);

    await client.query(`
      CREATE TEMP TABLE IF NOT EXISTS tmp_profile_role_team_targets (
        profile_id UUID PRIMARY KEY,
        target_team_id TEXT NOT NULL,
        target_role_id UUID NOT NULL,
        reason TEXT NOT NULL
      ) ON COMMIT DROP
    `);
    await client.query(`TRUNCATE TABLE tmp_profile_role_team_targets`);

    let fallbackAssignments = 0;
    let legacyRoleAssignments = 0;

    for (const profile of profiles) {
      const teamTarget = inferTargetTeamFromLegacy(profile);
      const roleName = inferTargetRoleNameFromLegacy(profile);
      const roleId = coreRoleIds[roleName];
      if (teamTarget.reason === 'fallback:civils') fallbackAssignments += 1;
      if (isRetiredRoleName(profile.role_name || '')) legacyRoleAssignments += 1;

      await client.query(
        `
        INSERT INTO tmp_profile_role_team_targets (profile_id, target_team_id, target_role_id, reason)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (profile_id)
        DO UPDATE SET
          target_team_id = EXCLUDED.target_team_id,
          target_role_id = EXCLUDED.target_role_id,
          reason = EXCLUDED.reason
        `,
        [profile.id, teamTarget.teamId, roleId, teamTarget.reason]
      );
    }

    const { rowCount: updatedProfiles } = await client.query(
      `
      UPDATE profiles p
      SET
        team_id = t.target_team_id,
        role_id = t.target_role_id
      FROM tmp_profile_role_team_targets t
      WHERE p.id = t.profile_id
        AND (
          p.team_id IS DISTINCT FROM t.target_team_id
          OR p.role_id IS DISTINCT FROM t.target_role_id
        )
      `
    );

    await client.query(
      `
      UPDATE profile_team_memberships ptm
      SET valid_to = NOW(), updated_at = NOW()
      FROM tmp_profile_role_team_targets t
      WHERE ptm.profile_id = t.profile_id
        AND ptm.valid_to IS NULL
        AND ptm.team_id <> t.target_team_id
      `
    );

    await client.query(
      `
      INSERT INTO profile_team_memberships (profile_id, team_id, is_primary, valid_from)
      SELECT t.profile_id, t.target_team_id, TRUE, NOW()
      FROM tmp_profile_role_team_targets t
      WHERE NOT EXISTS (
        SELECT 1
        FROM profile_team_memberships ptm
        WHERE ptm.profile_id = t.profile_id
          AND ptm.team_id = t.target_team_id
          AND ptm.is_primary = TRUE
          AND ptm.valid_to IS NULL
      )
      `
    );

    await client.query(
      `
      INSERT INTO org_hierarchy_change_log (change_type, entity_name, entity_id, before_json, after_json)
      VALUES (
        'roles_teams_simplification',
        'profiles',
        'bulk',
        NULL,
        $1::jsonb
      )
      `,
      [
        JSON.stringify({
          canonical_teams: CANONICAL_TEAMS.map((team) => team.id),
          core_roles: CORE_ROLES.map((role) => role.name),
          updated_profiles: updatedProfiles || 0,
          fallback_assignments: fallbackAssignments,
          legacy_role_assignments_seen: legacyRoleAssignments,
          applied_at: new Date().toISOString(),
        }),
      ]
    );

    await client.query('COMMIT');

    const { rows: byTeam } = await client.query<{
      team_id: string;
      team_name: string;
      active: boolean;
      members: number;
    }>(`
      SELECT
        t.id AS team_id,
        t.name AS team_name,
        t.active,
        COUNT(p.id)::int AS members
      FROM org_teams t
      LEFT JOIN profiles p ON p.team_id = t.id
      GROUP BY t.id, t.name, t.active
      ORDER BY t.name
    `);

    const { rows: byRole } = await client.query<{ role_name: string; members: number }>(`
      SELECT
        r.name AS role_name,
        COUNT(p.id)::int AS members
      FROM roles r
      LEFT JOIN profiles p ON p.role_id = r.id
      WHERE r.name IN ('employee', 'contractor', 'manager', 'admin')
      GROUP BY r.name
      ORDER BY CASE r.name WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 WHEN 'employee' THEN 3 WHEN 'contractor' THEN 4 ELSE 5 END
    `);

    const { rows: unknownTeamRows } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM profiles p
      LEFT JOIN org_teams t ON t.id = p.team_id
      WHERE p.team_id IS NOT NULL
        AND t.id IS NULL
    `);

    console.log('Migration complete.');
    console.log(`Profiles updated: ${updatedProfiles || 0}`);
    console.log(`Fallback assignments to Civils: ${fallbackAssignments}`);
    console.log(`Legacy role assignments seen: ${legacyRoleAssignments}`);
    console.log('\nTeam distribution:');
    console.table(byTeam);
    console.log('\nCore role distribution:');
    console.table(byRole);
    console.log(`\nUnknown team references: ${Number(unknownTeamRows[0]?.count || '0')}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
