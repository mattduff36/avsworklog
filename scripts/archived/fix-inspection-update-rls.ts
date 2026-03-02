// @ts-nocheck
/**
 * Fix vehicle_inspections UPDATE RLS policy to allow draft updates
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20241201_fix_inspection_update_rls.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Fixing vehicle_inspections UPDATE policy...\n');

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

    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing RLS policy fix...');
    await client.query(migrationSQL);

    console.log('✅ RLS POLICY FIXED!\n');
    
    // Verify the new policy
    const { rows } = await client.query(`
      SELECT policyname, cmd, qual
      FROM pg_policies
      WHERE tablename = 'vehicle_inspections'
      AND cmd = 'UPDATE'
      AND policyname = 'Employees can update own inspections';
    `);

    if (rows.length > 0) {
      console.log('📜 New UPDATE policy:');
      console.log(`   ✓ ${rows[0].policyname}`);
      console.log(`   ✓ USING: ${rows[0].qual}`);
    }

    console.log('\n🎉 Done! Employees can now update draft inspections.');

  } catch (error: any) {
    console.error('❌ FAILED:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);

