import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260326_absence_year_closure_carryover_flow.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

const resolvedConnectionString = connectionString;

async function runMigration() {
  console.log('🚀 Running absence year-close and carryover migration...\n');

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
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    console.log(`📄 Executing migration file: ${sqlFile}`);
    await client.query(migrationSQL);
    console.log('✅ Migration executed.\n');

    const closureTable = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'absence_financial_year_closures'
      LIMIT 1;
    `);

    const closureFunction = await client.query(`
      SELECT proname
      FROM pg_proc
      WHERE proname = 'close_absence_financial_year_bookings'
      LIMIT 1;
    `);

    const carryoverConstraint = await client.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conname = 'absence_allowance_carryovers_non_negative'
      LIMIT 1;
    `);

    if (closureTable.rowCount === 0) {
      throw new Error('Verification failed: absence_financial_year_closures table not found');
    }
    if (closureFunction.rowCount === 0) {
      throw new Error('Verification failed: close_absence_financial_year_bookings function not found');
    }
    if (carryoverConstraint.rowCount !== 0) {
      throw new Error('Verification failed: non-negative carryover constraint still exists');
    }

    console.log('✅ Verified closure table exists');
    console.log('✅ Verified close-year function exists');
    console.log('✅ Verified negative carryovers are allowed\n');
    console.log('🎉 Absence year-close migration completed successfully.');
  } catch (error) {
    const pgError = error as { message?: string; detail?: string; hint?: string };
    console.error('❌ Migration failed:', pgError.message || error);
    if (pgError.detail) {
      console.error('Details:', pgError.detail);
    }
    if (pgError.hint) {
      console.error('Hint:', pgError.hint);
    }
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
