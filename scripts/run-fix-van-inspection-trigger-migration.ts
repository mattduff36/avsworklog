/**
 * Migration Runner: Fix update_vehicle_maintenance_mileage() for van_id rename
 *
 * After the big-bang vehicle_id → van_id rename, the trigger function
 * still referenced NEW.vehicle_id (now van_id) and vehicle_maintenance.vehicle_id
 * (now van_id), causing "record new has no field vehicle_id" on every inspection save.
 *
 * Usage:
 *   npx tsx scripts/run-fix-van-inspection-trigger-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260301_fix_van_inspection_trigger.sql';

async function runMigration() {
  console.log('🚀 Running Fix Van Inspection Trigger Migration\n');

  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('❌ Error: POSTGRES_URL_NON_POOLING not found in .env.local');
    process.exit(1);
  }

  const migrationSQL = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf-8');
  console.log(`✅ Loaded migration from: ${MIGRATION_FILE}\n`);

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
      SELECT prosrc FROM pg_proc WHERE proname = 'update_vehicle_maintenance_mileage'
    `);

    const src = result.rows[0]?.prosrc ?? '';
    if (src.includes('NEW.van_id') && !src.includes('NEW.vehicle_id')) {
      console.log('✅ Trigger function updated — now uses van_id\n');
      console.log('🎉 Migration completed successfully!');
    } else {
      console.error('❌ Trigger function still references vehicle_id or does not reference van_id');
      process.exit(1);
    }
  } catch (error: unknown) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

runMigration().catch((error) => {
  console.error('💥 Unexpected error:', error);
  process.exit(1);
});
