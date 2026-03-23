import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

const LEGACY_TEAM_IDS = [
  'civils_ops',
  'civils_projects',
  'executive',
  'finance_payroll',
  'heavy_plant_earthworks',
  'workshop_yard',
] as const;

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
    const { rows: profileRefs } = await client.query<{ team_id: string; count: number }>(
      `
      SELECT team_id, COUNT(*)::int AS count
      FROM profiles
      WHERE team_id = ANY($1::text[])
      GROUP BY team_id
      `,
      [LEGACY_TEAM_IDS]
    );

    if (profileRefs.length > 0) {
      const details = profileRefs.map((row) => `${row.team_id}:${row.count}`).join(', ');
      throw new Error(`Cannot delete legacy teams; live profile references remain: ${details}`);
    }

    await client.query('BEGIN');

    const { rows: membershipRefs } = await client.query<{ team_id: string; count: number }>(
      `
      SELECT team_id, COUNT(*)::int AS count
      FROM profile_team_memberships
      WHERE team_id = ANY($1::text[])
      GROUP BY team_id
      ORDER BY team_id
      `,
      [LEGACY_TEAM_IDS]
    );

    const { rows: deletedTeams } = await client.query<{ id: string; name: string }>(
      `
      DELETE FROM org_teams
      WHERE id = ANY($1::text[])
      RETURNING id, name
      `,
      [LEGACY_TEAM_IDS]
    );

    await client.query('COMMIT');

    console.log('Deleted legacy teams:');
    console.table(deletedTeams);

    console.log('Historical memberships removed by cascade:');
    console.table(membershipRefs);

    const { rows: remainingTeams } = await client.query<{ id: string; name: string }>(
      `
      SELECT id, name
      FROM org_teams
      ORDER BY name
      `
    );

    console.log('Remaining teams:');
    console.table(remainingTeams);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure if transaction never started
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
