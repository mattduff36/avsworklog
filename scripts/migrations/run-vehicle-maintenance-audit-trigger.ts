/**
 * Add Vehicle Maintenance Audit Trigger Migration
 * Adds audit logging trigger for vehicle_maintenance table
 * 
 * Uses direct PostgreSQL connection from .env.local
 * Run with: npx tsx scripts/migrations/run-vehicle-maintenance-audit-trigger.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20251218_add_vehicle_maintenance_audit_trigger.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  console.error('\nExpected environment variables:');
  console.error('  - POSTGRES_URL_NON_POOLING (preferred for migrations)');
  console.error('  - POSTGRES_URL (fallback)');
  process.exit(1);
}

async function runMigration() {
  console.log('🔍 Running Vehicle Maintenance Audit Trigger Migration...\n');

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
    console.log('   ✓ Created audit trigger for vehicle_maintenance table\n');
    
    // Verify trigger
    console.log('🔍 Verifying trigger...\n');
    
    const { rows } = await client.query(`
      SELECT 
        trigger_name, 
        event_manipulation, 
        event_object_table
      FROM information_schema.triggers 
      WHERE event_object_table = 'vehicle_maintenance'
      AND trigger_name = 'audit_vehicle_maintenance'
    `);

    if (rows.length > 0) {
      console.log('   ✅ Trigger verified:');
      rows.forEach(row => {
        console.log(`      Trigger: ${row.trigger_name}`);
        console.log(`      Table: ${row.event_object_table}`);
        console.log(`      Events: ${row.event_manipulation}`);
      });
      console.log('');
    } else {
      console.warn('⚠️  Warning: Trigger not found. Migration may have failed.');
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Migration complete! Vehicle maintenance changes will');
    console.log('   now be logged to audit_log table automatically.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    
    // Check for common errors
    if (error.message.includes('already exists')) {
      console.log('\n✅ Trigger already exists - migration was previously run successfully.');
      console.log('   No action needed.\n');
      process.exit(0);
    } else if (error.message.includes('permission denied')) {
      console.error('\n🔒 Permission error - ensure you are using a connection string');
      console.error('   with sufficient privileges (service role key).\n');
      process.exit(1);
    } else {
      console.error('\n💡 Troubleshooting:');
      console.error('   1. Check your .env.local file has POSTGRES_URL_NON_POOLING');
      console.error('   2. Verify the database user has CREATE TRIGGER permissions');
      console.error('   3. Check the SQL file exists at:', sqlFile);
      console.error('\nFull error:', error);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

// Run the migration
runMigration().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
