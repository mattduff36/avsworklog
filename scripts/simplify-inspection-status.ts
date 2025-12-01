/**
 * Simplify vehicle_inspections status workflow to 'draft' and 'submitted'
 * - Migrates legacy statuses to 'submitted'
 * - Tightens RLS so only draft inspections are updatable
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20251201_simplify_inspection_status.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string (POSTGRES_URL_NON_POOLING or POSTGRES_URL)');
  process.exit(1);
}

async function runMigration() {
  console.log('🚗 Simplifying vehicle_inspections status workflow...\n');

  const url = new URL(connectionString);

  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected!\n');

    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing inspection status simplification migration...');
    await client.query(migrationSQL);

    console.log('✅ Migration applied successfully!\n');

    // Quick verification of distinct statuses after migration
    const { rows } = await client.query(`
      SELECT status, COUNT(*) AS count
      FROM vehicle_inspections
      GROUP BY status
      ORDER BY status;
    `);

    console.log('📊 Current vehicle_inspections statuses:');
    for (const row of rows) {
      console.log(`   • ${row.status}: ${row.count}`);
    }

    console.log('\n🎉 Done! Inspections now use only draft/submitted and submitted records are locked.');
  } catch (error: any) {
    console.error('❌ FAILED:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);


