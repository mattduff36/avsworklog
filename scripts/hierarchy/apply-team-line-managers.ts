import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import {
  getTeamLineManagers,
  normalizeManagerName,
  resolveTeamLineManagerCandidate,
} from '../../lib/config/team-line-managers';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

type ProfileRow = {
  id: string;
  full_name: string | null;
  team_id: string | null;
  role_id: string | null;
  role_name: string | null;
  role_class: 'admin' | 'manager' | 'employee' | null;
  is_placeholder: boolean | null;
};

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

async function ensureManagerRoleId(client: pg.Client): Promise<string> {
  const { rows } = await client.query<{ id: string }>(`
    SELECT id
    FROM roles
    WHERE name = 'manager'
    LIMIT 1
  `);
  const managerRoleId = rows[0]?.id;
  if (!managerRoleId) {
    throw new Error('Core manager role not found');
  }
  return managerRoleId;
}

async function main() {
  const client = await getClient();
  const teamLineManagers = getTeamLineManagers({
    includeTestTeams:
      process.env.NODE_ENV === 'test' || process.env.INCLUDE_TEST_TEAM_LINE_MANAGERS === 'true',
  });
  try {
    await client.query('BEGIN');

    const managerRoleId = await ensureManagerRoleId(client);

    const { rows: profiles } = await client.query<ProfileRow>(`
      SELECT
        p.id,
        p.full_name,
        p.team_id,
        p.role_id,
        p.is_placeholder,
        r.name AS role_name,
        r.role_class
      FROM profiles p
      LEFT JOIN roles r ON r.id = p.role_id
    `);

    const profilesByNormalizedName = new Map<string, ProfileRow[]>();
    for (const profile of profiles) {
      if (!profile.full_name) continue;
      const normalizedName = normalizeManagerName(profile.full_name);
      const candidates = profilesByNormalizedName.get(normalizedName) || [];
      candidates.push(profile);
      profilesByNormalizedName.set(normalizedName, candidates);
    }

    let promotedManagers = 0;
    let updatedAssignments = 0;

    for (const team of teamLineManagers) {
      const primaryManager = resolveTeamLineManagerCandidate(
        profilesByNormalizedName.get(normalizeManagerName(team.primaryManagerName)) || [],
        team.primaryManagerName
      ) as ProfileRow | null;
      const secondaryManager = team.secondaryManagerName
        ? (resolveTeamLineManagerCandidate(
            profilesByNormalizedName.get(normalizeManagerName(team.secondaryManagerName)) || [],
            team.secondaryManagerName
          ) as ProfileRow | null)
        : null;

      if (!primaryManager) {
        throw new Error(`Primary manager not found for ${team.teamName}: ${team.primaryManagerName}`);
      }

      const leaders = [primaryManager, secondaryManager].filter(Boolean) as ProfileRow[];

      await client.query(
        `
        UPDATE org_teams
        SET
          manager_1_profile_id = $2::uuid,
          manager_2_profile_id = $3::uuid,
          updated_at = NOW()
        WHERE id = $1
        `,
        [team.teamId, primaryManager.id, secondaryManager?.id || null]
      );

      for (const leader of leaders) {
        if (leader.team_id !== team.teamId || leader.role_class !== 'manager') {
          await client.query(
            `
            UPDATE profiles
            SET
              team_id = $2,
              role_id = CASE
                WHEN id = $1 AND (
                  SELECT role_class
                  FROM roles
                  WHERE id = profiles.role_id
                ) = 'admin'
                THEN role_id
                ELSE $3
              END
            WHERE id = $1
            `,
            [leader.id, team.teamId, managerRoleId]
          );

          const shouldCountPromotion = leader.role_class !== 'manager' && leader.role_class !== 'admin';
          if (shouldCountPromotion) {
            promotedManagers += 1;
          }
        }
      }

      const { rowCount } = await client.query(
        `
        UPDATE profiles
        SET
          line_manager_id = CASE
            WHEN COALESCE((
              SELECT r.role_class
              FROM roles r
              WHERE r.id = profiles.role_id
            ), 'employee') IN ('admin', 'manager')
              THEN NULL
            ELSE $2::uuid
          END,
          secondary_manager_id = CASE
            WHEN COALESCE((
              SELECT r.role_class
              FROM roles r
              WHERE r.id = profiles.role_id
            ), 'employee') IN ('admin', 'manager')
              THEN NULL
            ELSE $3::uuid
          END
        WHERE team_id = $1
          AND (
            line_manager_id IS DISTINCT FROM CASE
              WHEN COALESCE((
                SELECT r.role_class
                FROM roles r
                WHERE r.id = profiles.role_id
              ), 'employee') IN ('admin', 'manager')
                THEN NULL
              ELSE $2::uuid
            END
            OR secondary_manager_id IS DISTINCT FROM CASE
              WHEN COALESCE((
                SELECT r.role_class
                FROM roles r
                WHERE r.id = profiles.role_id
              ), 'employee') IN ('admin', 'manager')
                THEN NULL
              ELSE $3::uuid
            END
          )
        `,
        [team.teamId, primaryManager.id, secondaryManager?.id || null]
      );
      updatedAssignments += rowCount || 0;

      await client.query(
        `
        UPDATE profile_reporting_lines
        SET valid_to = NOW(), updated_at = NOW()
        WHERE profile_id IN (
          SELECT id
          FROM profiles
          WHERE team_id = $1
        )
          AND relation_type IN ('primary', 'secondary')
          AND valid_to IS NULL
        `,
        [team.teamId]
      );

      await client.query(
        `
        INSERT INTO profile_reporting_lines (profile_id, manager_profile_id, relation_type, valid_from)
        SELECT p.id, $2::uuid, 'primary', NOW()
        FROM profiles p
        LEFT JOIN roles r ON r.id = p.role_id
        WHERE p.team_id = $1
          AND COALESCE(r.role_class, 'employee') NOT IN ('admin', 'manager')
          AND NOT EXISTS (
            SELECT 1
            FROM profile_reporting_lines prl
            WHERE prl.profile_id = p.id
              AND prl.manager_profile_id = $2::uuid
              AND prl.relation_type = 'primary'
              AND prl.valid_to IS NULL
          )
        `,
        [team.teamId, primaryManager.id]
      );

      if (secondaryManager?.id) {
        await client.query(
          `
          INSERT INTO profile_reporting_lines (profile_id, manager_profile_id, relation_type, valid_from)
          SELECT p.id, $2::uuid, 'secondary', NOW()
          FROM profiles p
          LEFT JOIN roles r ON r.id = p.role_id
          WHERE p.team_id = $1
            AND COALESCE(r.role_class, 'employee') NOT IN ('admin', 'manager')
            AND NOT EXISTS (
              SELECT 1
              FROM profile_reporting_lines prl
              WHERE prl.profile_id = p.id
                AND prl.manager_profile_id = $2::uuid
                AND prl.relation_type = 'secondary'
                AND prl.valid_to IS NULL
            )
          `,
          [team.teamId, secondaryManager.id]
        );
      }
    }

    await client.query('COMMIT');

    const { rows: verification } = await client.query<{
      team_name: string;
      full_name: string;
      line_manager: string | null;
      secondary_manager: string | null;
      role_name: string | null;
    }>(`
      SELECT
        COALESCE(t.name, p.team_id) AS team_name,
        p.full_name,
        lm.full_name AS line_manager,
        sm.full_name AS secondary_manager,
        r.name AS role_name
      FROM profiles p
      LEFT JOIN profiles lm ON lm.id = p.line_manager_id
      LEFT JOIN profiles sm ON sm.id = p.secondary_manager_id
      LEFT JOIN roles r ON r.id = p.role_id
      LEFT JOIN org_teams t ON t.id = p.team_id
      WHERE p.team_id = ANY($1::text[])
      ORDER BY team_name, p.full_name
    `, [teamLineManagers.map((team) => team.teamId)]);

    console.log(`Promoted to manager role: ${promotedManagers}`);
    console.log(`Updated team manager assignments: ${updatedAssignments}`);
    console.table(verification);
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
