import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260212_add_audit_log_created_at_index.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running audit_log index migration...\n');

  const url = new URL(connectionString);

  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
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
    console.log('Connected!\n');

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');

    console.log('Executing migration...');
    await client.query(migrationSQL);

    console.log('\nMIGRATION COMPLETED SUCCESSFULLY!');
    console.log('  - Added idx_audit_log_created_at (created_at DESC)');
    console.log('  - Added idx_audit_log_user_id (user_id)');
    console.log('  - This fixes the statement timeout on the debug page audit logs query\n');

    // Verify indexes exist
    const { rows } = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'audit_log'
      ORDER BY indexname;
    `);

    console.log('Current audit_log indexes:');
    for (const row of rows) {
      console.log(`  ${row.indexname}`);
    }
    console.log('');

    // Show table size for context
    const { rows: sizeRows } = await client.query(`
      SELECT COUNT(*) as row_count
      FROM audit_log;
    `);
    console.log(`audit_log table has ${sizeRows[0].row_count} rows`);

  } catch (error: unknown) {
    const pgError = error as { message: string; detail?: string; hint?: string };
    console.error('\nMIGRATION FAILED');
    console.error('Error:', pgError.message);
    if (pgError.detail) console.error('Details:', pgError.detail);
    if (pgError.hint) console.error('Hint:', pgError.hint);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
