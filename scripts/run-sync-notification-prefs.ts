#!/usr/bin/env tsx
/**
 * Sync Notification Preferences Migration Runner
 * 
 * This script runs the notification preferences sync migration to ensure
 * all existing records have both notify_in_app and notify_email explicitly set.
 * 
 * Usage:
 *   npx tsx scripts/run-sync-notification-prefs.ts
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const POSTGRES_URL = process.env.POSTGRES_URL_NON_POOLING;

if (!POSTGRES_URL) {
  console.error('❌ Error: POSTGRES_URL_NON_POOLING not found in .env.local');
  process.exit(1);
}

async function runMigration() {
  // Parse the connection string
  const url = new URL(POSTGRES_URL);
  
  const client = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port),
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected to database');

    // Read the migration file
    const migrationPath = join(process.cwd(), 'supabase', 'migrations', '20260126_sync_notification_preferences.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    console.log('📋 Running notification preferences sync migration...');
    
    // Run the migration
    await client.query(migrationSQL);
    
    console.log('✅ Migration completed successfully');

    // Verify the results
    console.log('\n📊 Verification Results:');
    const verifyQuery = `
      SELECT 
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE notify_in_app IS NULL) as null_in_app,
        COUNT(*) FILTER (WHERE notify_email IS NULL) as null_email,
        COUNT(*) FILTER (WHERE notify_in_app = true AND notify_email = true) as both_enabled,
        COUNT(*) FILTER (WHERE notify_in_app = false OR notify_email = false) as some_disabled
      FROM notification_preferences;
    `;
    
    const result = await client.query(verifyQuery);
    const stats = result.rows[0];
    
    console.log(`   Total records: ${stats.total_records}`);
    console.log(`   Records with null in_app: ${stats.null_in_app}`);
    console.log(`   Records with null email: ${stats.null_email}`);
    console.log(`   Records with both enabled: ${stats.both_enabled}`);
    console.log(`   Records with some disabled: ${stats.some_disabled}`);

    if (stats.null_in_app === '0' && stats.null_email === '0') {
      console.log('\n✅ All notification preferences are properly synced!');
    } else {
      console.log('\n⚠️  Warning: Some records still have null values');
    }

  } catch (error) {
    console.error('❌ Error running migration:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

// Run the migration
runMigration().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});
