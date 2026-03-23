import { config } from 'dotenv';
import { resolve, join } from 'path';
import fs from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260322_team_manager_slots_and_placeholders.sql';

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not set in .env.local');
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
  try {
    const sqlPath = join(process.cwd(), MIGRATION_FILE);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log(`Applying ${MIGRATION_FILE}...`);
    await client.query(sql);

    const { rows: teamColumns } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'org_teams'
        AND column_name IN ('manager_1_profile_id', 'manager_2_profile_id')
      ORDER BY column_name
    `);
    if (teamColumns.length !== 2) {
      throw new Error(`Expected 2 manager slot columns on org_teams, found ${teamColumns.length}`);
    }

    const { rows: profileColumns } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'profiles'
        AND column_name IN ('is_placeholder', 'placeholder_key')
      ORDER BY column_name
    `);
    if (profileColumns.length !== 2) {
      throw new Error(`Expected 2 placeholder columns on profiles, found ${profileColumns.length}`);
    }

    console.log('Team manager slot / placeholder migration applied and verified.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
