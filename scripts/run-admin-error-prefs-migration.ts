import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260126_admin_error_notification_prefs.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('⚙️  Running Admin Error Notification Preferences Migration...\n');

  // Parse connection string with SSL config
  const url = new URL(connectionString);
  
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false
    }
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

    console.log('📄 Executing admin error notification preferences migration...');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');
    console.log('⚙️  Admin Error Notification Preferences Created:');
    
    console.log('\n1️⃣  Table: admin_error_notification_prefs');
    console.log('   ✓ user_id (PK)');
    console.log('   ✓ notify_in_app (default: true)');
    console.log('   ✓ notify_email (default: true)');
    console.log('   ✓ timestamps (created_at, updated_at)');
    
    console.log('\n2️⃣  RLS Policies:');
    console.log('   ✓ Admins can view their own preferences');
    console.log('   ✓ Admins can insert their own preferences');
    console.log('   ✓ Admins can update their own preferences');
    console.log('   ✓ Super admins can view all preferences');
    
    console.log('\n3️⃣  Expected Behavior:');
    console.log('   ✓ All admins default to receiving both in-app and email notifications');
    console.log('   ✓ Admins can opt out of either channel via API');
    console.log('   ✓ Error notification flow will respect these preferences');

    // Verify table exists
    const tableCheck = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = 'admin_error_notification_prefs';
    `);

    if (tableCheck.rows.length > 0) {
      console.log('\n✅ VERIFICATION: Table created successfully');
    }

    // Count policies
    const policyCount = await client.query(`
      SELECT COUNT(*) as count
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'admin_error_notification_prefs';
    `);

    console.log(`✅ VERIFICATION: ${policyCount.rows[0].count} RLS policies created\n`);

  } catch (error: any) {
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

runMigration();
