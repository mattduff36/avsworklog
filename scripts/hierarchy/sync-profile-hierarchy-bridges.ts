import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

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

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    await client.query(`
      WITH primary_team AS (
        SELECT DISTINCT ON (ptm.profile_id)
          ptm.profile_id,
          ptm.team_id
        FROM profile_team_memberships ptm
        WHERE ptm.is_primary = TRUE
          AND ptm.valid_to IS NULL
        ORDER BY ptm.profile_id, ptm.valid_from DESC, ptm.created_at DESC
      ),
      primary_manager AS (
        SELECT DISTINCT ON (prl.profile_id)
          prl.profile_id,
          prl.manager_profile_id
        FROM profile_reporting_lines prl
        WHERE prl.relation_type = 'primary'
          AND prl.valid_to IS NULL
        ORDER BY prl.profile_id, prl.valid_from DESC, prl.created_at DESC
      ),
      secondary_manager AS (
        SELECT DISTINCT ON (prl.profile_id)
          prl.profile_id,
          prl.manager_profile_id
        FROM profile_reporting_lines prl
        WHERE prl.relation_type = 'secondary'
          AND prl.valid_to IS NULL
        ORDER BY prl.profile_id, prl.valid_from DESC, prl.created_at DESC
      )
      UPDATE profiles p
      SET
        team_id = pt.team_id,
        line_manager_id = pm.manager_profile_id,
        secondary_manager_id = sm.manager_profile_id
      FROM primary_team pt
      LEFT JOIN primary_manager pm ON pm.profile_id = pt.profile_id
      LEFT JOIN secondary_manager sm ON sm.profile_id = pt.profile_id
      WHERE p.id = pt.profile_id
    `);

    await client.query(`
      UPDATE profiles p
      SET team_id = NULL
      WHERE NOT EXISTS (
        SELECT 1
        FROM profile_team_memberships ptm
        WHERE ptm.profile_id = p.id
          AND ptm.is_primary = TRUE
          AND ptm.valid_to IS NULL
      )
    `);

    await client.query(`
      UPDATE profiles p
      SET line_manager_id = NULL
      WHERE NOT EXISTS (
        SELECT 1
        FROM profile_reporting_lines prl
        WHERE prl.profile_id = p.id
          AND prl.relation_type = 'primary'
          AND prl.valid_to IS NULL
      )
    `);

    await client.query(`
      UPDATE profiles p
      SET secondary_manager_id = NULL
      WHERE NOT EXISTS (
        SELECT 1
        FROM profile_reporting_lines prl
        WHERE prl.profile_id = p.id
          AND prl.relation_type = 'secondary'
          AND prl.valid_to IS NULL
      )
    `);

    await client.query('COMMIT');
    console.log('Synced profiles.team_id, profiles.line_manager_id, and profiles.secondary_manager_id from normalized hierarchy tables.');
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
