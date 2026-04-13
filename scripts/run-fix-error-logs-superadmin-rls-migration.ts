import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260413_fix_error_logs_superadmin_rls.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

function getConnectionString(): string {
  if (!connectionString) {
    throw new Error('Missing database connection string');
  }

  return connectionString;
}

async function runMigration() {
  console.log('🛡️ Running Error Logs SuperAdmin RLS Fix...\n');

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

    console.log('📄 Executing error log RLS migration...');
    await client.query(migrationSQL);

    const { rows } = await client.query<{
      policyname: string;
      cmd: string;
      qual: string | null;
    }>(`
      SELECT policyname, cmd, qual
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'error_logs'
        AND policyname IN (
          'SuperAdmin can view all error logs',
          'SuperAdmin can delete error logs'
        )
      ORDER BY policyname;
    `);

    console.log('\n✅ Migration completed successfully!');
    console.log(`✅ Verified ${rows.length} updated error_logs policies\n`);

    for (const row of rows) {
      console.log(`- ${row.policyname} (${row.cmd})`);
      if (row.qual) {
        console.log(`  ${row.qual}`);
      }
    }
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
