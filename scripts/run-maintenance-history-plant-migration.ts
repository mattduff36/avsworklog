/**
 * Migration Runner: Add Plant Support to Maintenance History
 * 
 * This script runs the maintenance_history table migration to support plant records.
 * It makes vehicle_id nullable and adds plant_id column with appropriate constraints.
 * 
 * Usage:
 *   npx tsx scripts/run-maintenance-history-plant-migration.ts
 * 
 * Requirements:
 *   - POSTGRES_URL_NON_POOLING in .env.local
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { readFileSync } from 'fs';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260204_add_plant_to_maintenance_history.sql';

async function runMigration() {
  console.log('🚀 Running Maintenance History Plant Support Migration\n');
  
  // Check for database connection string
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('❌ Error: POSTGRES_URL_NON_POOLING not found in .env.local');
    console.error('Please add your database connection string to .env.local');
    process.exit(1);
  }

  // Read migration SQL
  let migrationSQL: string;
  try {
    migrationSQL = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf-8');
    console.log(`✅ Loaded migration from: ${MIGRATION_FILE}\n`);
  } catch (error) {
    console.error(`❌ Error reading migration file: ${error}`);
    process.exit(1);
  }

  // Parse connection string with SSL config
  const url = new URL(connectionString);
  
  const client = new pg.Client({
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
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected\n');

    console.log('📝 Executing migration SQL...');
    await client.query(migrationSQL);
    console.log('✅ Migration executed successfully\n');

    // Verify changes
    console.log('🔍 Verifying changes...');
    
    // Check if plant_id column exists
    const columnCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'maintenance_history'
        AND column_name = 'plant_id'
      ) as column_exists;
    `);

    if (columnCheck.rows[0].column_exists) {
      console.log('✅ plant_id column added to maintenance_history\n');
    } else {
      console.error('❌ plant_id column not found');
      process.exit(1);
    }

    // Check if vehicle_id is nullable
    const nullableCheck = await client.query(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'maintenance_history'
      AND column_name = 'vehicle_id';
    `);

    if (nullableCheck.rows[0].is_nullable === 'YES') {
      console.log('✅ vehicle_id is now nullable\n');
    } else {
      console.error('❌ vehicle_id is still NOT NULL');
      process.exit(1);
    }

    // Check constraint
    const constraintCheck = await client.query(`
      SELECT COUNT(*) as constraint_count
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
      AND table_name = 'maintenance_history'
      AND constraint_name = 'check_maintenance_history_asset';
    `);

    if (constraintCheck.rows[0].constraint_count > 0) {
      console.log('✅ Check constraint added\n');
    } else {
      console.error('❌ Check constraint not found');
      process.exit(1);
    }

    // Check index
    const indexCheck = await client.query(`
      SELECT COUNT(*) as index_count
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND tablename = 'maintenance_history'
      AND indexname = 'idx_maintenance_history_plant_id';
    `);

    if (indexCheck.rows[0].index_count > 0) {
      console.log('✅ Plant index created\n');
    } else {
      console.error('⚠️  Warning: Plant index not found');
    }

    console.log('🎉 Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Test plant maintenance record updates');
    console.log('2. Verify maintenance history is created for plant updates');
    console.log('3. Run full test build');

  } catch (error: any) {
    if (error.message && error.message.includes('already exists')) {
      console.log('✅ Migration already applied\n');
      console.log('🎉 Database is up to date!');
    } else {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    }
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

// Run migration
runMigration().catch(error => {
  console.error('💥 Unexpected error:', error);
  process.exit(1);
});
