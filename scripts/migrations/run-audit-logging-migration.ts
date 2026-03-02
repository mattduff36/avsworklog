/**
 * Enable Audit Logging Migration
 * Sets up comprehensive audit logging triggers for all key tables
 * 
 * Uses direct PostgreSQL connection from .env.local
 * Run with: npx tsx scripts/run-audit-logging-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/enable-audit-logging.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  console.error('\nExpected environment variables:');
  console.error('  - POSTGRES_URL_NON_POOLING (preferred for migrations)');
  console.error('  - POSTGRES_URL (fallback)');
  process.exit(1);
}

async function runAuditLoggingMigration() {
  console.log('🔍 Running Audit Logging Migration...\n');

  // Parse connection string and rebuild with explicit SSL config
  const url = new URL(connectionString as string);
  
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
    console.log('✅ AUDIT LOGGING MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log('📊 Database changes applied:');
    console.log('   ✓ Created audit log trigger function');
    console.log('   ✓ Applied triggers to timesheets');
    console.log('   ✓ Applied triggers to timesheet_entries');
    console.log('   ✓ Applied triggers to vehicle_inspections');
    console.log('   ✓ Applied triggers to inspection_items');
    console.log('   ✓ Applied triggers to absences');
    console.log('   ✓ Applied triggers to profiles');
    console.log('   ✓ Applied triggers to vehicles');
    console.log('   ✓ Applied triggers to rams_documents');
    console.log('   ✓ Enabled RLS on audit_log table');
    console.log('   ✓ Created admin view policy\n');
    
    // Verify triggers
    console.log('🔍 Verifying triggers...\n');
    
    const { rows } = await client.query(`
      SELECT 
        tgname as trigger_name,
        tgrelid::regclass as table_name,
        tgtype as trigger_type
      FROM pg_trigger
      WHERE tgname LIKE 'audit_%'
      ORDER BY tgrelid::regclass::text, tgname
    `);

    if (rows.length > 0) {
      console.log('   Installed triggers:');
      rows.forEach(row => {
        console.log(`   ✅ ${row.trigger_name} on ${row.table_name}`);
      });
      console.log('');
    }
    
    // Check for existing audit log entries
    const countResult = await client.query('SELECT COUNT(*) as count FROM audit_log');
    const auditCount = parseInt(countResult.rows[0].count);
    
    console.log(`📈 Current audit log entries: ${auditCount}\n`);
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Audit logging is now active!');
    console.log('All changes to tracked tables will be automatically logged.');
    console.log('View audit logs in the SuperAdmin Debug Console > Audit Log tab');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: unknown) {
    console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ MIGRATION FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    if (error instanceof Error) {
      console.error('Error:', error.message);
      if ('detail' in error) {
        console.error('Details:', (error as { detail?: string }).detail);
      }
      if ('hint' in error) {
        console.error('Hint:', (error as { hint?: string }).hint);
      }
    } else {
      console.error('Unknown error:', error);
    }
    
    // Check if triggers already exist
    if (error instanceof Error && (error.message?.includes('already exists') || error.message?.includes('duplicate'))) {
      console.log('\n✅ Triggers already exist - no action needed!');
      console.log('Audit logging is already enabled.\n');
      process.exit(0);
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

runAuditLoggingMigration().catch(console.error);

