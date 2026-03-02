// @ts-nocheck
/**
 * Migration Runner: DVLA sync contract convergence
 *
 * Usage:
 *   npx tsx scripts/run-dvla-sync-contract-convergence-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260303_dvla_sync_contract_convergence.sql';

async function runMigration() {
  console.log('Running DVLA sync contract convergence migration\n');

  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('POSTGRES_URL_NON_POOLING not found in .env.local');
    process.exit(1);
  }

  const migrationSQL = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf-8');
  console.log(`Loaded: ${MIGRATION_FILE}\n`);

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
    await client.connect();
    await client.query(migrationSQL);
    console.log('Migration executed\n');

    const triggerTypeCheck = await client.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'dvla_sync_log'
        AND c.conname = 'check_dvla_sync_log_trigger_type'
    `);
    if (!triggerTypeCheck.rows[0]?.def?.includes('auto_on_create')) {
      throw new Error('check_dvla_sync_log_trigger_type missing auto_on_create');
    }

    const uniqueIndexes = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'vehicle_maintenance'
        AND indexname IN ('unique_van_maintenance', 'unique_hgv_maintenance', 'unique_plant_maintenance')
    `);
    if (uniqueIndexes.rowCount < 3) {
      throw new Error('Missing one or more unique maintenance indexes');
    }

    console.log('Verification passed');
  } catch (error: unknown) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
