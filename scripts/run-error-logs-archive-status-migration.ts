/**
 * Migration Runner: error_logs archive status
 *
 * Usage: npx tsx scripts/run-error-logs-archive-status-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING;
const sqlFile = 'supabase/migrations/20260820_error_logs_archive_status.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING is set in .env.local');
  process.exit(1);
}

function getConnectionString(): string {
  if (!connectionString) {
    throw new Error('Missing database connection string');
  }

  return connectionString;
}

async function runMigration() {
  console.log('🛡️ Running error_logs archive status migration...\n');

  const url = new URL(getConnectionString());

  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    console.log('📄 Executing error_logs archive status migration...');
    await client.query(migrationSQL);

    const columns = await client.query<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(`
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'error_logs'
        AND column_name IN ('status', 'archived_at')
      ORDER BY column_name
    `);

    const constraints = await client.query<{ conname: string }>(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public.error_logs'::regclass
        AND conname IN (
          'error_logs_status_check',
          'error_logs_status_archived_at_consistency'
        )
      ORDER BY conname
    `);

    const indexes = await client.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'error_logs'
        AND indexname IN (
          'idx_error_logs_active_created_at',
          'idx_error_logs_active_timestamp'
        )
      ORDER BY indexname
    `);

    const policies = await client.query<{
      policyname: string;
      cmd: string;
      qual: string | null;
      with_check: string | null;
    }>(`
      SELECT policyname, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'error_logs'
        AND policyname = 'SuperAdmin can update error logs'
    `);

    const statusColumn = columns.rows.find((row) => row.column_name === 'status');
    const archivedAtColumn = columns.rows.find((row) => row.column_name === 'archived_at');
    const updatePolicy = policies.rows[0];

    if (
      !statusColumn ||
      statusColumn.is_nullable !== 'NO' ||
      !statusColumn.column_default?.includes('active') ||
      !archivedAtColumn ||
      constraints.rows.length !== 2 ||
      indexes.rows.length !== 2 ||
      !updatePolicy ||
      updatePolicy.cmd !== 'UPDATE' ||
      !updatePolicy.qual ||
      !updatePolicy.with_check
    ) {
      throw new Error('error_logs archive status migration verification failed');
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('✅ Verified status, archived_at, checks, indexes, and UPDATE RLS\n');
    for (const row of columns.rows) {
      console.log(`- column ${row.column_name} nullable=${row.is_nullable}`);
    }
    for (const row of constraints.rows) {
      console.log(`- constraint ${row.conname}`);
    }
    for (const row of indexes.rows) {
      console.log(`- index ${row.indexname}`);
    }
    console.log(`- policy ${updatePolicy.policyname} (${updatePolicy.cmd})`);
    console.log('');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('\n❌ Migration failed:');
    console.error(message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
