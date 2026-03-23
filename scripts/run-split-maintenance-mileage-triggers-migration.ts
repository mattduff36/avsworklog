import { config } from 'dotenv';
import { resolve, join } from 'path';
import fs from 'fs';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;
const MIGRATION_FILE = 'supabase/migrations/20260322_split_maintenance_mileage_triggers.sql';

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

    const { rows: functionRows } = await client.query(`
      SELECT proname
      FROM pg_proc
      WHERE proname IN (
        'update_van_maintenance_mileage',
        'update_hgv_maintenance_mileage',
        'update_plant_maintenance_hours'
      )
      ORDER BY proname
    `);
    if (functionRows.length !== 3) {
      throw new Error(`Expected 3 maintenance trigger functions, found ${functionRows.length}`);
    }

    const { rows: triggerRows } = await client.query(`
      SELECT tgname
      FROM pg_trigger
      WHERE tgname IN (
        'trigger_update_maintenance_mileage',
        'trigger_update_maintenance_mileage_plant',
        'trigger_update_maintenance_mileage_hgv'
      )
        AND NOT tgisinternal
      ORDER BY tgname
    `);
    if (triggerRows.length !== 3) {
      throw new Error(`Expected 3 maintenance sync triggers, found ${triggerRows.length}`);
    }

    console.log('Split maintenance mileage trigger migration applied and verified.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
