// @ts-nocheck
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

const MIGRATIONS = [
  {
    name: 'HGV Inspections Daily Parity',
    file: 'supabase/migrations/20260301_hgv_inspections_daily_parity.sql',
  },
  {
    name: 'HGV Inspections Permission Rows',
    file: 'supabase/migrations/20260301_permissions_add_hgv_inspections_module.sql',
  },
];

async function runMigration() {
  console.log('Running HGV inspections daily parity migrations...\n');

  const url = new URL(connectionString!);

  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected!\n');

    // Preflight: verify hgv_inspections table exists
    const { rows: tableCheck } = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'hgv_inspections' AND table_schema = 'public'
      ) AS exists
    `);

    if (!tableCheck[0].exists) {
      console.error(
        'hgv_inspections table does not exist. Run the vehicles-to-vans-hgvs migration first.'
      );
      process.exit(1);
    }
    console.log('Preflight: hgv_inspections table exists\n');

    for (const migration of MIGRATIONS) {
      console.log(`--- ${migration.name} ---`);
      const sql = readFileSync(resolve(process.cwd(), migration.file), 'utf-8');
      await client.query(sql);
      console.log(`  Applied successfully\n`);
    }

    // Verify
    console.log('--- VERIFICATION ---');

    const { rows: constraints } = await client.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'hgv_inspections'
        AND constraint_type = 'CHECK'
      ORDER BY constraint_name
    `);
    console.log(`  hgv_inspections CHECK constraints: ${constraints.map(r => r.constraint_name).join(', ') || '(none)'}`);

    const { rows: uniqueIdx } = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'hgv_inspections'
        AND indexname = 'idx_unique_hgv_inspection_date'
    `);
    console.log(`  idx_unique_hgv_inspection_date: ${uniqueIdx.length > 0 ? 'EXISTS' : 'MISSING'}`);

    const { rows: perms } = await client.query(`
      SELECT COUNT(*) AS cnt
      FROM role_permissions
      WHERE module_name = 'hgv-inspections'
    `);
    console.log(`  role_permissions with hgv-inspections: ${perms[0].cnt}`);

    const { rows: policies } = await client.query(`
      SELECT policyname, tablename
      FROM pg_policies
      WHERE policyname ILIKE '%inspection%'
        AND (tablename = 'inspection_items' OR tablename = 'inspection_photos' OR tablename = 'inspection_daily_hours')
      ORDER BY tablename, policyname
    `);
    console.log(`  Child-table RLS policies: ${policies.length}`);
    for (const p of policies) {
      console.log(`    ${p.tablename}: ${p.policyname}`);
    }

    console.log('\nAll migrations completed successfully!');
  } catch (error: any) {
    console.error('MIGRATION FAILED:', error.message);
    if (error.detail) console.error('  Detail:', error.detail);
    if (error.hint) console.error('  Hint:', error.hint);

    if (error.message?.includes('already exists')) {
      console.log('Already applied - no action needed!');
      process.exit(0);
    }

    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
