import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import {
  ORGANOGRAM_MANAGER_ROLES,
  ORGANOGRAM_PEOPLE,
} from './organogram-config';
import { CANONICAL_TEAMS, inferTargetTeamFromLegacy } from '../../lib/utils/role-team-migration';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

type ProfileRow = {
  id: string;
  full_name: string | null;
  role_id: string | null;
};

type RoleRow = {
  id: string;
  name: string;
};

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

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

async function ensureManagerRoles(client: pg.Client): Promise<Map<string, string>> {
  const { rows: existingRoles } = await client.query<RoleRow>(`
    SELECT id, name
    FROM roles
  `);
  const existingByName = new Map(existingRoles.map((row) => [row.name, row.id]));

  for (const role of ORGANOGRAM_MANAGER_ROLES) {
    if (existingByName.has(role.name)) continue;
    const inserted = await client.query<{ id: string }>(
      `
      INSERT INTO roles (name, display_name, description, role_class, is_manager_admin, is_super_admin)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
      `,
      [role.name, role.display_name, role.description, role.role_class, role.is_manager_admin, role.is_super_admin]
    );
    existingByName.set(role.name, inserted.rows[0].id);
    console.log(`Created missing manager role: ${role.name}`);
  }

  return existingByName;
}

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1) Ensure team catalog is seeded with canonical Org V2 IDs
    for (const team of CANONICAL_TEAMS) {
      await client.query(
        `
        INSERT INTO org_teams (id, name, code, active)
        VALUES ($1, $2, $3, TRUE)
        ON CONFLICT (id)
        DO UPDATE SET
          name = EXCLUDED.name,
          code = EXCLUDED.code,
          active = TRUE,
          updated_at = NOW()
        `,
        [team.id, team.name, team.id]
      );
    }

    // 2) Ensure manager role set exists
    await ensureManagerRoles(client);

    // 3) Resolve profiles from manual mapping (strict block on mismatch)
    const { rows: profileRows } = await client.query<ProfileRow>(`
      SELECT id, full_name, role_id
      FROM profiles
      WHERE full_name IS NOT NULL
    `);

    const profileByExactName = new Map<string, ProfileRow>();
    const profileByNormalizedName = new Map<string, ProfileRow>();
    for (const row of profileRows) {
      if (!row.full_name) continue;
      profileByExactName.set(row.full_name, row);
      profileByNormalizedName.set(normalizeName(row.full_name), row);
    }

    const unresolvedPeople: string[] = [];
    const unresolvedManagers: string[] = [];
    const resolvedPeople = ORGANOGRAM_PEOPLE.map((person) => {
      const profile =
        profileByExactName.get(person.fullName) ||
        profileByNormalizedName.get(normalizeName(person.fullName));
      if (!profile) {
        unresolvedPeople.push(person.fullName);
      }

      let primaryManagerId: string | null = null;
      if (person.primaryManagerName) {
        const manager =
          profileByExactName.get(person.primaryManagerName) ||
          profileByNormalizedName.get(normalizeName(person.primaryManagerName));
        if (!manager) {
          unresolvedManagers.push(`${person.fullName} -> ${person.primaryManagerName}`);
        } else {
          primaryManagerId = manager.id;
        }
      }

      let secondaryManagerId: string | null = null;
      if (person.secondaryManagerName) {
        const manager =
          profileByExactName.get(person.secondaryManagerName) ||
          profileByNormalizedName.get(normalizeName(person.secondaryManagerName));
        if (!manager) {
          unresolvedManagers.push(`${person.fullName} -> ${person.secondaryManagerName}`);
        } else {
          secondaryManagerId = manager.id;
        }
      }

      const canonicalTeam = inferTargetTeamFromLegacy({ team_id: person.teamId });

      return {
        person,
        canonicalTeamId: canonicalTeam.teamId,
        profileId: profile?.id || null,
        primaryManagerId,
        secondaryManagerId,
      };
    });

    if (unresolvedPeople.length > 0) {
      throw new Error(
        `Strict-block failed. Unresolved people: ${unresolvedPeople.join(', ')}`
      );
    }
    if (unresolvedManagers.length > 0) {
      throw new Error(
        `Strict-block failed. Unresolved managers: ${unresolvedManagers.join(', ')}`
      );
    }

    // 4) Upsert reporting lines + team memberships + bridge columns
    for (const resolved of resolvedPeople) {
      if (!resolved.profileId) continue;

      const teamId = resolved.canonicalTeamId;

      await client.query(
        `
        UPDATE profile_team_memberships
        SET valid_to = NOW(), updated_at = NOW()
        WHERE profile_id = $1
          AND valid_to IS NULL
          AND team_id <> $2
        `,
        [resolved.profileId, teamId]
      );

      await client.query(
        `
        INSERT INTO profile_team_memberships (profile_id, team_id, is_primary, valid_from)
        SELECT $1, $2, TRUE, NOW()
        WHERE NOT EXISTS (
          SELECT 1
          FROM profile_team_memberships
          WHERE profile_id = $1
            AND team_id = $2
            AND is_primary = TRUE
            AND valid_to IS NULL
        )
        `,
        [resolved.profileId, teamId]
      );

      await client.query(
        `
        UPDATE profiles
        SET
          team_id = $2,
          line_manager_id = $3,
          secondary_manager_id = $4
        WHERE id = $1
        `,
        [resolved.profileId, teamId, resolved.primaryManagerId, resolved.secondaryManagerId]
      );

      await client.query(
        `
        UPDATE profile_reporting_lines
        SET valid_to = NOW(), updated_at = NOW()
        WHERE profile_id = $1
          AND relation_type = 'primary'
          AND valid_to IS NULL
          AND ($2::UUID IS NULL OR manager_profile_id <> $2)
        `,
        [resolved.profileId, resolved.primaryManagerId]
      );

      if (resolved.primaryManagerId) {
        await client.query(
          `
          INSERT INTO profile_reporting_lines (profile_id, manager_profile_id, relation_type, valid_from)
          SELECT $1, $2, 'primary', NOW()
          WHERE NOT EXISTS (
            SELECT 1
            FROM profile_reporting_lines
            WHERE profile_id = $1
              AND manager_profile_id = $2
              AND relation_type = 'primary'
              AND valid_to IS NULL
          )
          `,
          [resolved.profileId, resolved.primaryManagerId]
        );
      }

      await client.query(
        `
        UPDATE profile_reporting_lines
        SET valid_to = NOW(), updated_at = NOW()
        WHERE profile_id = $1
          AND relation_type = 'secondary'
          AND valid_to IS NULL
          AND ($2::UUID IS NULL OR manager_profile_id <> $2)
        `,
        [resolved.profileId, resolved.secondaryManagerId]
      );

      if (resolved.secondaryManagerId) {
        await client.query(
          `
          INSERT INTO profile_reporting_lines (profile_id, manager_profile_id, relation_type, valid_from)
          SELECT $1, $2, 'secondary', NOW()
          WHERE NOT EXISTS (
            SELECT 1
            FROM profile_reporting_lines
            WHERE profile_id = $1
              AND manager_profile_id = $2
              AND relation_type = 'secondary'
              AND valid_to IS NULL
          )
          `,
          [resolved.profileId, resolved.secondaryManagerId]
        );
      }
    }

    // 5) Ensure absence workflow remains on Org V2 for canonical teams
    for (const team of CANONICAL_TEAMS) {
      await client.query(
        `
        INSERT INTO org_team_feature_modes (team_id, workflow_name, mode, effective_from)
        VALUES ($1, 'absence_leave', 'org_v2', NOW())
        ON CONFLICT (team_id, workflow_name)
        DO UPDATE SET
          mode = EXCLUDED.mode,
          effective_from = EXCLUDED.effective_from,
          updated_at = NOW()
        `,
        [team.id]
      );
    }

    await client.query('COMMIT');
    console.log(`Backfill complete. Teams: ${CANONICAL_TEAMS.length}, People mapped: ${resolvedPeople.length}`);
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
