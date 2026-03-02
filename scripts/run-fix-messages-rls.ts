import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString: string | undefined =
  process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260126_fix_messages_table_rls.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration(conn: string) {
  console.log('📧 Running Messages Table RLS Fixes Migration...\n');

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

    console.log('📄 Executing messages RLS migration...');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');
    console.log('📧 Messages Table RLS Fixed:');
    
    console.log('\n1️⃣  Updated Policies:');
    console.log('   ✓ Managers can view all messages (using roles table)');
    console.log('   ✓ Managers can create messages (using roles table)');
    console.log('   ✓ Managers can update messages (using roles table)');
    console.log('   ✓ Users can view assigned messages (unchanged, already correct)');
    
    console.log('\n2️⃣  Expected Impact:');
    console.log('   ✓ Notification system should now work correctly');
    console.log('   ✓ Users will see in-app notifications');
    console.log('   ✓ Join queries from message_recipients to messages will succeed');

    // Verify policies exist
    const policyCount = await client.query<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'messages';
    `);

    console.log(`\n✅ VERIFICATION: ${policyCount.rows[0]?.count} RLS policies on messages table\n`);

    // List all policies for verification
    const policies = await client.query<{ policyname: string }>(`
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'messages'
      ORDER BY policyname;
    `);

    console.log('📋 Current policies on messages table:');
    policies.rows.forEach((row) => console.log(`   ✓ ${row.policyname}`));
    console.log();

  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('\n❌ Migration failed:');
    console.error(error.message);

    if (error.message.includes('already exists')) {
      console.log('\n💡 TIP: Policies may already exist. Check if migration was previously run.');
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
