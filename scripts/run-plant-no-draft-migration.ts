// @ts-nocheck
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260224_plant_inspections_no_draft.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Plant Inspections No-Draft Migration...\n');

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
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Pre-migration: count draft plant inspections
    const { rows: preCounts } = await client.query(`
      SELECT COUNT(*) AS draft_count
      FROM vehicle_inspections
      WHERE status = 'draft'
        AND (plant_id IS NOT NULL OR is_hired_plant = TRUE)
    `);
    console.log(`📊 Draft plant inspections to migrate: ${preCounts[0].draft_count}\n`);

    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...');
    console.log('   - Backfilling missing checklist items as N/A');
    console.log('   - Converting draft plant inspections to submitted');
    console.log('   - Adding CHECK constraint (plant inspections cannot be draft)');
    console.log('   - Tightening RLS update policies to vehicle-only drafts\n');

    await client.query(migrationSQL);

    console.log('✅ MIGRATION COMPLETED!\n');

    // Post-migration verification
    console.log('🔍 Verifying changes...');

    const { rows: remaining } = await client.query(`
      SELECT COUNT(*) AS remaining_drafts
      FROM vehicle_inspections
      WHERE status = 'draft'
        AND (plant_id IS NOT NULL OR is_hired_plant = TRUE)
    `);
    console.log(`   Draft plant inspections remaining: ${remaining[0].remaining_drafts} (should be 0)`);

    const { rows: constraints } = await client.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'vehicle_inspections'::regclass
        AND conname = 'check_plant_inspections_not_draft'
    `);

    if (constraints.length > 0) {
      console.log('   ✅ Constraint check_plant_inspections_not_draft exists');
    } else {
      console.log('   ⚠️ Constraint check_plant_inspections_not_draft NOT found');
    }

    const { rows: policies } = await client.query(`
      SELECT polname
      FROM pg_policy
      WHERE polrelid = 'vehicle_inspections'::regclass
        AND polname IN ('Employees can update own inspections', 'Managers can update inspections')
    `);

    console.log(`   ✅ RLS update policies found: ${policies.map(p => p.polname).join(', ')}`);
    console.log('\n✅ All done!');

  } catch (error: any) {
    console.error('❌ MIGRATION FAILED:', error.message);

    if (error.message?.includes('already exists')) {
      console.log('✅ Already applied - no action needed!');
      process.exit(0);
    }

    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
