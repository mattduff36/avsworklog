/**
 * Quick Database Schema Check: Verify maintenance_history Structure
 * 
 * This script checks if the maintenance_history table has been properly
 * updated to support plant records.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

async function checkSchema() {
  console.log('🔍 Checking maintenance_history table schema...\n');
  
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('❌ Error: POSTGRES_URL_NON_POOLING not found');
    process.exit(1);
  }

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
    await client.connect();
    console.log('✅ Connected to database\n');

    // Check columns and their nullable status
    const columnsResult = await client.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'maintenance_history'
      AND column_name IN ('vehicle_id', 'plant_id')
      ORDER BY column_name;
    `);

    console.log('📋 Current Schema:');
    console.log('─────────────────────────────────────────────────');
    columnsResult.rows.forEach(row => {
      const nullable = row.is_nullable === 'YES' ? '✅ nullable' : '❌ NOT NULL';
      console.log(`  ${row.column_name.padEnd(15)} ${row.data_type.padEnd(10)} ${nullable}`);
    });
    console.log('─────────────────────────────────────────────────\n');

    // Check if plant_id column exists
    const hasPlantId = columnsResult.rows.some(r => r.column_name === 'plant_id');
    const vehicleIdRow = columnsResult.rows.find(r => r.column_name === 'vehicle_id');
    
    if (!hasPlantId) {
      console.error('❌ PROBLEM: plant_id column does NOT exist!');
      console.log('\n💡 Solution: Run the migration:');
      console.log('   npx tsx scripts/run-maintenance-history-plant-migration.ts\n');
    } else if (vehicleIdRow && vehicleIdRow.is_nullable === 'NO') {
      console.error('❌ PROBLEM: vehicle_id is still NOT NULL!');
      console.log('\n💡 Solution: The migration needs to be applied.');
      console.log('   The plant_id column exists but vehicle_id is still NOT NULL.');
      console.log('   This means the migration was partially applied.\n');
    } else {
      console.log('✅ Schema looks correct!');
      console.log('   - vehicle_id is nullable');
      console.log('   - plant_id column exists\n');
    }

    // Check constraints
    const constraintsResult = await client.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
      AND table_name = 'maintenance_history'
      AND constraint_name = 'check_maintenance_history_asset';
    `);

    if (constraintsResult.rows.length > 0) {
      console.log('✅ Check constraint exists: check_maintenance_history_asset\n');
    } else {
      console.log('⚠️  Check constraint missing: check_maintenance_history_asset\n');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.end();
  }
}

checkSchema();
