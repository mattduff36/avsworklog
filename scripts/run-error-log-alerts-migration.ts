import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString: string | undefined =
  process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260126_error_log_alerts.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration(conn: string) {
  console.log('🔔 Running Error Log Alerts Migration...\n');

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

    console.log('📄 Executing error log alerts migration...');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');
    console.log('🔔 Error Log Alerts Table Created:');
    
    console.log('\n1️⃣  Table: error_log_alerts');
    console.log('   ✓ error_log_id (PK, FK to error_logs)');
    console.log('   ✓ notified_at (timestamp)');
    console.log('   ✓ message_id (FK to messages)');
    console.log('   ✓ admin_count (number of admins notified)');
    
    console.log('\n2️⃣  Purpose:');
    console.log('   ✓ Prevent duplicate notifications for same error');
    console.log('   ✓ Track which errors have been sent to admins');
    console.log('   ✓ Link to notification message for reference');

    // Verify table exists
    const tableCheck = await client.query<{ tablename: string }>(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = 'error_log_alerts';
    `);

    if (tableCheck.rows.length > 0) {
      console.log('\n✅ VERIFICATION: Table created successfully');
    }

    // Count policies
    const policyCount = await client.query<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'error_log_alerts';
    `);

    console.log(`✅ VERIFICATION: ${policyCount.rows[0]?.count} RLS policies created\n`);

  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('\n❌ Migration failed:');
    console.error(error.message);

    if (error.message.includes('already exists')) {
      console.log('\n💡 TIP: Table may already exist. Check if migration was previously run.');
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
