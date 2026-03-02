// @ts-nocheck
/**
 * Migration Runner: Fix notification_preferences admin insert RLS (v3 - final)
 * 
 * Run with: npx tsx scripts/run-fix-notification-prefs-admin-insert-v3.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { readFileSync } from 'fs';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

async function runMigration() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING not found in environment variables');
  }

  console.log('🔄 Connecting to database...');
  
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
    await client.connect();
    console.log('✅ Connected to database\n');

    // Read migration file
    const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260126_fix_notification_preferences_admin_insert_v3.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    console.log('📝 Running migration: 20260126_fix_notification_preferences_admin_insert_v3.sql');
    console.log('─'.repeat(80));

    // Execute migration
    await client.query(migrationSQL);
    
    console.log('✅ Migration executed successfully\n');

    // Verify policies
    console.log('🔍 Verifying notification_preferences policies...');
    const policies = await client.query(`
      SELECT 
        polname as policy_name,
        polcmd as command,
        CASE 
          WHEN polcmd = 'r' THEN 'SELECT'
          WHEN polcmd = 'a' THEN 'INSERT'
          WHEN polcmd = 'w' THEN 'UPDATE'
          WHEN polcmd = 'd' THEN 'DELETE'
          ELSE polcmd::text
        END as operation
      FROM pg_policy
      WHERE polrelid = 'notification_preferences'::regclass
      ORDER BY polname;
    `);

    console.log('\n📋 Current policies:');
    console.table(policies.rows);

    console.log('\n✅ Migration completed successfully!');
    console.log('   Unified INSERT policy now handles both user and admin inserts.');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

// Run migration
runMigration()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  });
