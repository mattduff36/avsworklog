/**
 * Migration Runner: Fix stale vehicle_categories / vehicle_id references
 *
 * Fixes three DB objects left broken by the big-bang rename migration:
 *   1. sync_vehicle_type_from_category() — was querying FROM vehicle_categories
 *   2. van_archive.vehicle_id — renamed to van_id to match app code
 *   3. get_latest_mot_test() / get_latest_passed_mot() — used old vehicle_id column
 *
 * Usage:
 *   npx tsx scripts/run-fix-stale-rename-references-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260301_fix_stale_rename_references.sql';

async function runMigration() {
  console.log('🚀 Running Fix Stale Rename References Migration\n');

  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('❌ POSTGRES_URL_NON_POOLING not found in .env.local');
    process.exit(1);
  }

  const migrationSQL = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf-8');
  console.log(`✅ Loaded: ${MIGRATION_FILE}\n`);

  const url = new URL(connectionString);
  const client = new pg.Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('🔌 Connecting...');
    await client.connect();
    console.log('✅ Connected\n');

    console.log('📝 Executing migration...');
    await client.query(migrationSQL);
    console.log('✅ Migration executed\n');

    // Verify 1: sync_vehicle_type_from_category no longer references vehicle_categories
    const r1 = await client.query(`SELECT prosrc FROM pg_proc WHERE proname = 'sync_vehicle_type_from_category'`);
    const body1 = r1.rows[0]?.prosrc ?? '';
    if (body1.includes('van_categories') && !body1.includes('vehicle_categories')) {
      console.log('✅ sync_vehicle_type_from_category — now uses van_categories');
    } else {
      console.error('❌ sync_vehicle_type_from_category still has stale reference');
      process.exit(1);
    }

    // Verify 2: van_archive has van_id column
    const r2 = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'van_archive'
        AND column_name IN ('van_id', 'vehicle_id')
    `);
    const archiveCols = r2.rows.map((r: any) => r.column_name);
    if (archiveCols.includes('van_id') && !archiveCols.includes('vehicle_id')) {
      console.log('✅ van_archive.vehicle_id — renamed to van_id');
    } else {
      console.error(`❌ van_archive columns unexpected: ${archiveCols.join(', ')}`);
      process.exit(1);
    }

    // Verify 3: get_latest_mot_test no longer references vehicle_id
    const r3 = await client.query(`SELECT prosrc FROM pg_proc WHERE proname = 'get_latest_mot_test'`);
    const body3 = r3.rows[0]?.prosrc ?? '';
    if (body3.includes('van_id') && !body3.includes('vehicle_id')) {
      console.log('✅ get_latest_mot_test — now uses van_id');
    } else {
      console.error('❌ get_latest_mot_test still has stale reference');
      process.exit(1);
    }

    // Verify 4: get_latest_passed_mot no longer references vehicle_id
    const r4 = await client.query(`SELECT prosrc FROM pg_proc WHERE proname = 'get_latest_passed_mot'`);
    const body4 = r4.rows[0]?.prosrc ?? '';
    if (body4.includes('van_id') && !body4.includes('vehicle_id')) {
      console.log('✅ get_latest_passed_mot — now uses van_id');
    } else {
      console.error('❌ get_latest_passed_mot still has stale reference');
      process.exit(1);
    }

    console.log('\n🎉 All fixes verified successfully!');
  } catch (error: unknown) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Disconnected');
  }
}

runMigration().catch((e) => { console.error('💥', e); process.exit(1); });
