/**
 * Migration Runner: Fix maintenance trigger for plant inspections
 * 
 * The update_vehicle_maintenance_mileage() trigger only handled van_id.
 * Plant inspections (van_id = NULL, plant_id set) caused a constraint
 * violation on check_maintenance_asset. This migration updates the trigger
 * to handle both vehicle and plant inspections.
 * 
 * Usage:
 *   npx tsx scripts/run-fix-maintenance-trigger-migration.ts
 * 
 * Requirements:
 *   - POSTGRES_URL_NON_POOLING in .env.local
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260218_fix_maintenance_trigger_for_plant.sql';

async function runMigration() {
  console.log('🚀 Running Fix Maintenance Trigger Migration\n');

  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('❌ Error: POSTGRES_URL_NON_POOLING not found in .env.local');
    process.exit(1);
  }

  let migrationSQL: string;
  try {
    migrationSQL = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf-8');
    console.log(`✅ Loaded migration from: ${MIGRATION_FILE}\n`);
  } catch (error) {
    console.error(`❌ Error reading migration file: ${error}`);
    process.exit(1);
  }

  const url = new URL(connectionString);

  const client = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected\n');

    console.log('📝 Executing migration SQL...');
    await client.query(migrationSQL);
    console.log('✅ Migration executed successfully\n');

    console.log('🔍 Verifying trigger function...');
    const result = await client.query(`
      SELECT prosrc 
      FROM pg_proc 
      WHERE proname = 'update_vehicle_maintenance_mileage';
    `);

    if (result.rows.length > 0 && result.rows[0].prosrc.includes('plant_id')) {
      console.log('✅ Trigger function updated — now handles plant_id\n');
      console.log('🎉 Migration completed successfully!');
    } else {
      console.error('❌ Trigger function does not contain plant_id logic');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

runMigration().catch(error => {
  console.error('💥 Unexpected error:', error);
  process.exit(1);
});
