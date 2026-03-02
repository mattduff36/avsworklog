import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260126_notification_preferences.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('⚙️  Running Notification Preferences Migration...\n');

  // Parse connection string with SSL config
  const url = new URL(connectionString!);
  
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

    console.log('📄 Executing notification preferences migration...');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');
    console.log('⚙️  Notification Preferences Created:');
    
    console.log('\n1️⃣  Table: notification_preferences');
    console.log('   ✓ user_id, module_key (unique together)');
    console.log('   ✓ enabled, notify_in_app, notify_email (all default true)');
    console.log('   ✓ Supported modules: errors, maintenance, rams, approvals, inspections');
    
    console.log('\n2️⃣  RLS Policies:');
    console.log('   ✓ Users can view/insert/update their own preferences');
    console.log('   ✓ Super admins can view/update all preferences (override)');
    
    console.log('\n3️⃣  Data Migration:');
    console.log('   ✓ Existing admin_error_notification_prefs migrated to errors module');
    
    console.log('\n4️⃣  Expected Behavior:');
    console.log('   ✓ All users can configure notifications per module');
    console.log('   ✓ Super admins can override any user\'s settings');
    console.log('   ✓ Defaults: all enabled, in-app + email both on');

    // Verify table and data
    const tableCheck = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = 'notification_preferences';
    `);

    if (tableCheck.rows.length > 0) {
      console.log('\n✅ VERIFICATION: Table created successfully');
    }

    // Count migrated rows
    const migratedCount = await client.query(`
      SELECT COUNT(*) as count
      FROM notification_preferences
      WHERE module_key = 'errors';
    `);

    console.log(`✅ VERIFICATION: ${migratedCount.rows[0].count} error preferences migrated\n`);

  } catch (err: unknown) {
    console.error('\n❌ Migration failed:');
    console.error((err instanceof Error ? err.message : String(err)));
    
    if ((err instanceof Error ? err.message : String(err)).includes('already exists')) {
      console.log('\n💡 TIP: Table may already exist. Check if migration was previously run.');
    }
    
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
