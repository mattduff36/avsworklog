import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260427_timesheet_entry_leave_snapshots.sql';

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
        AND table_name = 'timesheet_entry_leave_snapshots';
    `);

    if (tableRows.length !== 1) {
      throw new Error('Verification failed: timesheet_entry_leave_snapshots table was not created');
    }

    const { rows: columnRows } = await client.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'timesheet_entry_leave_snapshots'
        AND column_name IN (
          'absence_id',
          'timesheet_id',
          'timesheet_entry_id',
          'day_of_week',
          'original_entry',
          'original_job_numbers',
          'applied_entry'
        );
    `);

    if (columnRows.length !== 7) {
      throw new Error('Verification failed: required snapshot columns are missing');
    }

    console.log('Migration applied and verified successfully.');
  } catch (error) {
    const pgError = error as { message?: string; detail?: string; hint?: string };
    console.error('Migration failed:', pgError.message || String(error));
    if (pgError.detail) console.error('Details:', pgError.detail);
    if (pgError.hint) console.error('Hint:', pgError.hint);
    process.exit(1);
  } finally {
    await client.end();
  }
}

void runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
