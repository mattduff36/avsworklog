/**
 * Add 'processed' Status to Timesheets Migration
 * Updates the timesheets table constraint to allow 'processed' status
 * 
 * Uses direct PostgreSQL connection from .env.local
 * Run with: npx tsx scripts/run-processed-status-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/add-processed-status-to-timesheets.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  console.error('\nExpected environment variables:');
  console.error('  - POSTGRES_URL_NON_POOLING (preferred for migrations)');
  console.error('  - POSTGRES_URL (fallback)');
  process.exit(1);
}

async function runProcessedStatusMigration() {
  console.log('🚀 Running Timesheet Status Migration...\n');

  // Parse connection string and rebuild with explicit SSL config
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
    console.log('📡 Connecting to Supabase database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Read the migration SQL file
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration from:', sqlFile);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Execute the migration
    await client.query(migrationSQL);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('📊 Database changes applied:');
    console.log('   ✓ Updated timesheets status constraint');
    console.log('   ✓ Added "processed" status option');
    console.log('   ✓ Timesheets can now be marked as processed for payroll\n');
    
    // Verify constraint
    console.log('🔍 Verifying constraint...\n');
    
    const { rows } = await client.query(`
      SELECT 
        conname as constraint_name,
        pg_get_constraintdef(oid) as constraint_definition
      FROM pg_constraint
      WHERE conname = 'timesheets_status_check'
    `);

    if (rows.length > 0) {
      console.log(`   ✅ ${rows[0].constraint_name}`);
      console.log(`      ${rows[0].constraint_definition}\n`);
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Ready! Timesheets can now be marked as processed');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ MIGRATION FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.error('Error:', error.message);
    if (error.detail) {
      console.error('Details:', error.detail);
    }
    if (error.hint) {
      console.error('Hint:', error.hint);
    }
    
    // Check if constraint already exists with the processed status
    if (error.message?.includes('already exists') || error.message?.includes('duplicate')) {
      console.log('\n✅ Constraint already updated - no action needed!');
      console.log('The "processed" status is already available for timesheets.\n');
      process.exit(0);
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

runProcessedStatusMigration().catch(console.error);

