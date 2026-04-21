import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260421_add_timesheet_entry_job_codes.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

const resolvedConnectionString = connectionString;

async function runMigration() {
  const url = new URL(resolvedConnectionString);
  const client = new Client({
    host: url.hostname,
    port: Number.parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log(`Applying migration: ${sqlFile}`);
    await client.connect();

    const migrationSql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(migrationSql);

    const { rows: tableRows } = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'timesheet_entry_job_codes';
    `);

    if (tableRows.length !== 1) {
      throw new Error('Verification failed: timesheet_entry_job_codes table was not created');
    }

    const { rows: columnRows } = await client.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'timesheet_entry_job_codes'
        AND column_name IN ('timesheet_entry_id', 'job_number', 'display_order')
      ORDER BY column_name;
    `);

    if (columnRows.length !== 3) {
      throw new Error('Verification failed: required timesheet_entry_job_codes columns are missing');
    }

    const { rows: backfillRows } = await client.query<{
      legacy_count: string;
      child_count: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(job_number), '') IS NOT NULL)::text AS legacy_count,
        (
          SELECT COUNT(*)::text
          FROM public.timesheet_entry_job_codes
        ) AS child_count
      FROM public.timesheet_entries;
    `);

    const legacyCount = Number.parseInt(backfillRows[0]?.legacy_count || '0', 10);
    const childCount = Number.parseInt(backfillRows[0]?.child_count || '0', 10);

    if (childCount < legacyCount) {
      throw new Error(
        `Verification failed: expected at least ${legacyCount} backfilled job code rows, found ${childCount}`
      );
    }

    console.log('Migration applied and verified successfully.');
    console.log(`Legacy entry job numbers: ${legacyCount}`);
    console.log(`Child job code rows: ${childCount}`);
  } catch (error) {
    const pgError = error as { message?: string; detail?: string; hint?: string };
    console.error('Migration failed:', pgError.message || String(error));
    if (pgError.detail) {
      console.error('Details:', pgError.detail);
    }
    if (pgError.hint) {
      console.error('Hint:', pgError.hint);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
