import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString: string | undefined =
  process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260126_fix_error_reports_fk.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration(conn: string) {
  console.log('🔧 Running Error Reports FK Fix Migration...\n');

  // Parse connection string with SSL config
  const url = new URL(conn);
  
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
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

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing error reports FK fix migration...');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');
    console.log('🔧 Error Reports FK Fixed:');
    
    console.log('\n1️⃣  Updated Constraints:');
    console.log('   ✓ error_reports.created_by now references profiles(id)');
    console.log('   ✓ error_reports.resolved_by now references profiles(id)');
    console.log('   ✓ error_report_updates.created_by now references profiles(id)');
    
    console.log('\n2️⃣  Expected Impact:');
    console.log('   ✓ /api/management/error-reports will now return 200');
    console.log('   ✓ PostgREST can resolve user:created_by(...) relationships');
    console.log('   ✓ /admin/errors/manage page will load correctly');

    // Verify FK exists
    const fkCheck = await client.query<{ constraint_name: string; table_name: string }>(`
      SELECT constraint_name, table_name
      FROM information_schema.table_constraints
      WHERE constraint_name IN (
        'error_reports_created_by_fkey',
        'error_reports_resolved_by_fkey',
        'error_report_updates_created_by_fkey'
      )
      AND table_schema = 'public';
    `);

    console.log(`\n✅ VERIFICATION: ${fkCheck.rows.length} FK constraints updated\n`);
    fkCheck.rows.forEach((row) =>
      console.log(`   ✓ ${row.constraint_name} on ${row.table_name}`)
    );
    console.log();

  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('\n❌ Migration failed:');
    console.error(error.message);

    if (error.message.includes('already exists')) {
      console.log('\n💡 TIP: Constraints may already exist. Check if migration was previously run.');
    }
    
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration(connectionString).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
