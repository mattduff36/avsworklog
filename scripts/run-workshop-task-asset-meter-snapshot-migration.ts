import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const migrationFile = 'supabase/migrations/20260413_add_workshop_task_asset_meter_snapshot.sql';

if (!connectionString) {
  console.error('Missing POSTGRES_URL_NON_POOLING or POSTGRES_URL in .env.local');
  process.exit(1);
}

async function runMigration() {
  const url = new URL(connectionString as string);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected');

    console.log(`Running migration: ${migrationFile}`);
    const sql = readFileSync(resolve(process.cwd(), migrationFile), 'utf-8');
    await client.query(sql);
    console.log('Migration completed');

    const { rows } = await client.query<{
      asset_meter_reading_exists: boolean;
      asset_meter_unit_exists: boolean;
    }>(`
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'actions'
            AND column_name = 'asset_meter_reading'
        ) AS asset_meter_reading_exists,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'actions'
            AND column_name = 'asset_meter_unit'
        ) AS asset_meter_unit_exists
    `);

    const verification = rows[0];
    console.log(`Verification: asset_meter_reading exists = ${verification?.asset_meter_reading_exists ? 'yes' : 'no'}`);
    console.log(`Verification: asset_meter_unit exists = ${verification?.asset_meter_unit_exists ? 'yes' : 'no'}`);
  } catch (error) {
    const pgError = error as { message?: string; detail?: string; hint?: string };
    console.error('Migration failed:', pgError.message || error);
    if (pgError.detail) console.error('Detail:', pgError.detail);
    if (pgError.hint) console.error('Hint:', pgError.hint);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

runMigration();
