/**
 * Migration Runner: Fix HGV inspection mileage sync trigger
 *
 * Ensures update_vehicle_maintenance_mileage() handles hgv_inspections and
 * that trigger_update_maintenance_mileage_hgv exists on hgv_inspections.
 *
 * Usage:
 *   npx tsx scripts/run-fix-hgv-inspection-mileage-sync-trigger-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260311_fix_hgv_inspection_mileage_sync_trigger.sql';

async function runMigration() {
  console.log('Running Fix HGV Inspection Mileage Sync Trigger Migration');

  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('Error: POSTGRES_URL_NON_POOLING not found in .env.local');
    process.exit(1);
  }

  let migrationSQL: string;
  try {
    migrationSQL = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf-8');
    console.log(`Loaded migration from: ${MIGRATION_FILE}`);
  } catch (error: unknown) {
    console.error(`Error reading migration file: ${error}`);
    process.exit(1);
  }

  const url = new URL(connectionString);
  const client = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected');

    console.log('Executing migration SQL...');
    await client.query(migrationSQL);
    console.log('Migration executed successfully');

    console.log('Verifying trigger function and trigger...');
    const functionResult = await client.query(`
      SELECT prosrc
      FROM pg_proc
      WHERE proname = 'update_vehicle_maintenance_mileage'
    `);

    const triggerResult = await client.query(`
      SELECT tgname
      FROM pg_trigger
      WHERE tgname = 'trigger_update_maintenance_mileage_hgv'
        AND tgrelid = 'hgv_inspections'::regclass
        AND NOT tgisinternal
    `);

    const functionSource = functionResult.rows[0]?.prosrc ?? '';
    const hasHgvLogic = functionSource.includes("TG_TABLE_NAME = 'hgv_inspections'");
    const hasHgvTrigger = triggerResult.rows.length > 0;

    if (hasHgvLogic && hasHgvTrigger) {
      console.log('Verified: HGV mileage sync logic and trigger are present');
      console.log('Migration completed successfully');
      return;
    }

    console.error('Verification failed: missing HGV logic or trigger');
    process.exit(1);
  } catch (error: unknown) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Disconnected from database');
  }
}

runMigration().catch((error: unknown) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
