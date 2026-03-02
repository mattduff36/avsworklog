// @ts-nocheck
/**
 * Runner: Split vehicle_inspections → van_inspections + plant_inspections
 *
 * 1. Captures baseline row counts
 * 2. Executes the migration SQL
 * 3. Verifies post-migration counts
 * 4. Reports results
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString =
  process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260301_split_inspections.sql';

if (!connectionString) {
  console.error('❌ Missing POSTGRES_URL_NON_POOLING in .env.local');
  process.exit(1);
}

async function run() {
  const url = new URL(connectionString!);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected\n');

    // ── Baseline counts ──
    console.log('📊 Capturing baseline counts...');
    const { rows: baseline } = await client.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE van_id IS NOT NULL AND plant_id IS NULL AND is_hired_plant = FALSE) AS van,
        COUNT(*) FILTER (WHERE plant_id IS NOT NULL OR is_hired_plant = TRUE) AS plant
      FROM vehicle_inspections;
    `);

    const base = baseline[0];
    console.log(`  Total: ${base.total}  Van: ${base.van}  Plant: ${base.plant}\n`);

    // ── Execute migration ──
    console.log('🚀 Executing migration SQL...');
    const sql = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    await client.query(sql);
    console.log('✅ Migration SQL executed\n');

    // ── Post-migration verification ──
    console.log('🔍 Verifying post-migration state...');

    const { rows: vanRows } = await client.query('SELECT COUNT(*) AS cnt FROM van_inspections');
    const { rows: plantRows } = await client.query('SELECT COUNT(*) AS cnt FROM plant_inspections');
    const { rows: viewRows } = await client.query('SELECT COUNT(*) AS cnt FROM vehicle_inspections');

    const vanCount = Number(vanRows[0].cnt);
    const plantCount = Number(plantRows[0].cnt);
    const viewCount = Number(viewRows[0].cnt);

    console.log(`  van_inspections   : ${vanCount} (expected ${base.van})`);
    console.log(`  plant_inspections : ${plantCount} (expected ${base.plant})`);
    console.log(`  compatibility view: ${viewCount} (expected ${base.total})`);

    const expectedTotal = Number(base.total);
    if (vanCount + plantCount !== expectedTotal) {
      console.error(`\n❌ COUNT MISMATCH: ${vanCount}+${plantCount} != ${expectedTotal}`);
      process.exit(1);
    }
    if (vanCount !== Number(base.van)) {
      console.error(`\n❌ VAN COUNT MISMATCH: ${vanCount} != ${base.van}`);
      process.exit(1);
    }
    if (plantCount !== Number(base.plant)) {
      console.error(`\n❌ PLANT COUNT MISMATCH: ${plantCount} != ${base.plant}`);
      process.exit(1);
    }

    // Verify tables exist
    const { rows: tables } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('van_inspections', 'plant_inspections')
        AND table_schema = 'public';
    `);
    console.log(`\n  Tables found: ${tables.map((t) => t.table_name).join(', ')}`);

    // Verify RLS enabled
    const { rows: rls } = await client.query(`
      SELECT relname, relrowsecurity
      FROM pg_class
      WHERE relname IN ('van_inspections', 'plant_inspections');
    `);
    rls.forEach((r) =>
      console.log(`  RLS on ${r.relname}: ${r.relrowsecurity ? 'ON' : 'OFF'}`)
    );

    // Verify compatibility view
    const { rows: views } = await client.query(`
      SELECT table_name FROM information_schema.views
      WHERE table_name = 'vehicle_inspections' AND table_schema = 'public';
    `);
    console.log(`  Compatibility view: ${views.length > 0 ? 'EXISTS' : 'MISSING'}`);

    console.log('\n✅ MIGRATION COMPLETE AND VERIFIED');

  } catch (error: any) {
    console.error('❌ MIGRATION FAILED:', error.message);
    if (error.message?.includes('already exists')) {
      console.log('ℹ️  Migration may have already been applied');
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

run().catch(console.error);
