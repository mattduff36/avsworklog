/**
 * Update Vehicle Types Migration
 * Sets all NULL or empty vehicle_type values to 'Van' (except TE57 HGV)
 * 
 * Run with: npx tsx scripts/run-vehicle-types-update.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20251217_update_vehicle_types.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runVehicleTypesUpdate() {
  console.log('🚗 Updating Vehicle Types...\n');

  // Parse connection string and rebuild with explicit SSL config
  const url = new URL(connectionString as string);
  
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
    console.log('📡 Connecting to Supabase database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // First, check current state
    console.log('🔍 Checking current vehicle types...\n');
    const checkQuery = await client.query(`
      SELECT 
        reg_number, 
        vehicle_type,
        CASE 
          WHEN vehicle_type IS NULL THEN 'NULL'
          WHEN vehicle_type = '' THEN 'EMPTY'
          ELSE vehicle_type
        END as display_type
      FROM vehicles
      ORDER BY reg_number
    `);

    console.log('Current vehicles:');
    console.log('═'.repeat(60));
    checkQuery.rows.forEach((row: { reg_number: string; display_type: string }) => {
      const typeDisplay = row.display_type === 'NULL' ? '❌ NULL' : 
                         row.display_type === 'EMPTY' ? '❌ EMPTY' : 
                         `✅ ${row.display_type}`;
      console.log(`  ${row.reg_number.padEnd(20)} → ${typeDisplay}`);
    });
    console.log('═'.repeat(60));
    console.log();

    // Count vehicles that will be updated
    const countQuery = await client.query(`
      SELECT COUNT(*) as count
      FROM vehicles
      WHERE (vehicle_type IS NULL OR vehicle_type = '')
        AND reg_number != 'TE57 HGV'
    `);
    
    const vehiclesToUpdate = parseInt(countQuery.rows[0].count);
    console.log(`📊 Found ${vehiclesToUpdate} vehicle(s) to update to 'Van'\n`);

    if (vehiclesToUpdate === 0) {
      console.log('✨ All vehicles already have types assigned. No updates needed.\n');
      return;
    }

    // Read and execute the migration SQL
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration from:', sqlFile);
    console.log('━'.repeat(60));

    await client.query(migrationSQL);

    console.log('━'.repeat(60));
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('━'.repeat(60));
    console.log();

    // Verify the update
    console.log('🔍 Verifying updates...\n');
    
    const verifyQuery = await client.query(`
      SELECT 
        reg_number, 
        vehicle_type,
        CASE 
          WHEN vehicle_type IS NULL THEN 'NULL'
          WHEN vehicle_type = '' THEN 'EMPTY'
          ELSE vehicle_type
        END as display_type
      FROM vehicles
      ORDER BY reg_number
    `);

    console.log('Updated vehicles:');
    console.log('═'.repeat(60));
    verifyQuery.rows.forEach((row: { reg_number: string; display_type: string }) => {
      const typeDisplay = row.display_type === 'NULL' ? '❌ NULL' : 
                         row.display_type === 'EMPTY' ? '❌ EMPTY' : 
                         `✅ ${row.display_type}`;
      console.log(`  ${row.reg_number.padEnd(20)} → ${typeDisplay}`);
    });
    console.log('═'.repeat(60));
    console.log();

    // Count remaining NULL/empty
    const remainingQuery = await client.query(`
      SELECT COUNT(*) as count
      FROM vehicles
      WHERE vehicle_type IS NULL OR vehicle_type = ''
    `);
    
    const remaining = parseInt(remainingQuery.rows[0].count);
    
    if (remaining === 0) {
      console.log('✅ All vehicles now have types assigned!\n');
    } else {
      console.log(`⚠️  ${remaining} vehicle(s) still have NULL/empty types (expected: TE57 HGV if not set)\n`);
    }

    console.log('━'.repeat(60));
    console.log('🎉 Done! Vehicle types updated successfully');
    console.log('━'.repeat(60));
    console.log();

  } catch (error: unknown) {
    console.error('\n━'.repeat(60));
    console.error('❌ MIGRATION FAILED');
    console.error('━'.repeat(60));
    console.error();
    
    if (error instanceof Error) {
      console.error('Error:', error.message);
      const pgError = error as Error & { detail?: string; hint?: string };
      if (pgError.detail) {
        console.error('Details:', pgError.detail);
      }
      if (pgError.hint) {
        console.error('Hint:', pgError.hint);
      }
    } else {
      console.error('Unknown error:', error);
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

runVehicleTypesUpdate().catch(console.error);
