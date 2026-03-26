import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { Client } from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260327_absence_year_undo_close_flow.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

const resolvedConnectionString = connectionString;

async function runMigration() {
  console.log('Running absence undo-close migration...\n');

  const url = new URL(resolvedConnectionString);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected.\n');

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    console.log(`Executing migration file: ${sqlFile}`);
    await client.query(migrationSQL);
    console.log('Migration executed.\n');

    const snapshotTable = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'absence_financial_year_close_snapshots'
      LIMIT 1;
    `);
    const snapshotRowsTable = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'absence_financial_year_close_snapshot_rows'
      LIMIT 1;
    `);
    const undoFunction = await client.query(`
      SELECT proname
      FROM pg_proc
      WHERE proname = 'undo_close_absence_financial_year_bookings'
      LIMIT 1;
    `);
    const undoStatusFunction = await client.query(`
      SELECT proname
      FROM pg_proc
      WHERE proname = 'get_latest_absence_close_undo_status'
      LIMIT 1;
    `);

    if (snapshotTable.rowCount === 0) {
      throw new Error('Verification failed: absence_financial_year_close_snapshots table not found');
    }
    if (snapshotRowsTable.rowCount === 0) {
      throw new Error('Verification failed: absence_financial_year_close_snapshot_rows table not found');
    }
    if (undoFunction.rowCount === 0) {
      throw new Error('Verification failed: undo_close_absence_financial_year_bookings function not found');
    }
    if (undoStatusFunction.rowCount === 0) {
      throw new Error('Verification failed: get_latest_absence_close_undo_status function not found');
    }

    console.log('Verified snapshot header table exists');
    console.log('Verified snapshot row table exists');
    console.log('Verified undo-close function exists');
    console.log('Verified undo-status function exists\n');
    console.log('Absence undo-close migration completed successfully.');
  } catch (error) {
    const pgError = error as { message?: string; detail?: string; hint?: string };
    console.error('Migration failed:', pgError.message || error);
    if (pgError.detail) {
      console.error('Details:', pgError.detail);
    }
    if (pgError.hint) {
      console.error('Hint:', pgError.hint);
    }
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
