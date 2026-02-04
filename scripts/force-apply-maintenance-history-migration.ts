/**
 * Force Apply: Maintenance History Plant Support Migration
 * 
 * This script forces the application of the maintenance_history migration
 * even if some parts were previously applied.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

async function forceApplyMigration() {
  console.log('🚀 Force-applying maintenance_history migration...\n');
  
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

    // Step 1: Make vehicle_id nullable
    console.log('📝 Step 1: Making vehicle_id nullable...');
    try {
      await client.query(`
        ALTER TABLE maintenance_history
        ALTER COLUMN vehicle_id DROP NOT NULL;
      `);
      console.log('✅ vehicle_id is now nullable\n');
    } catch (error: any) {
      if (error.message.includes('does not exist')) {
        console.log('✅ vehicle_id was already nullable\n');
      } else {
        throw error;
      }
    }

    // Step 2: Ensure plant_id column exists
    console.log('📝 Step 2: Ensuring plant_id column exists...');
    try {
      await client.query(`
        ALTER TABLE maintenance_history
        ADD COLUMN plant_id UUID REFERENCES plant(id) ON DELETE CASCADE;
      `);
      console.log('✅ plant_id column added\n');
    } catch (error: any) {
      if (error.message.includes('already exists')) {
        console.log('✅ plant_id column already exists\n');
      } else {
        throw error;
      }
    }

    // Step 3: Add check constraint (drop first if exists)
    console.log('📝 Step 3: Adding check constraint...');
    try {
      await client.query(`
        ALTER TABLE maintenance_history
        DROP CONSTRAINT IF EXISTS check_maintenance_history_asset;
      `);
      
      await client.query(`
        ALTER TABLE maintenance_history
        ADD CONSTRAINT check_maintenance_history_asset CHECK (
          (vehicle_id IS NOT NULL AND plant_id IS NULL) OR
          (vehicle_id IS NULL AND plant_id IS NOT NULL)
        );
      `);
      console.log('✅ Check constraint added\n');
    } catch (error: any) {
      console.error('❌ Error adding constraint:', error.message);
      throw error;
    }

    // Step 4: Add index
    console.log('📝 Step 4: Adding plant_id index...');
    try {
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_maintenance_history_plant_id 
          ON maintenance_history(plant_id) 
          WHERE plant_id IS NOT NULL;
      `);
      console.log('✅ Index created\n');
    } catch (error: any) {
      console.error('⚠️  Warning: Could not create index:', error.message);
    }

    // Verify final state
    console.log('🔍 Verifying final state...\n');
    
    const columnsResult = await client.query(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'maintenance_history'
      AND column_name IN ('vehicle_id', 'plant_id')
      ORDER BY column_name;
    `);

    console.log('📋 Final Schema:');
    console.log('─────────────────────────────────────────────────');
    columnsResult.rows.forEach(row => {
      const nullable = row.is_nullable === 'YES' ? '✅ nullable' : '❌ NOT NULL';
      console.log(`  ${row.column_name.padEnd(15)} ${nullable}`);
    });
    console.log('─────────────────────────────────────────────────\n');

    const constraintCheck = await client.query(`
      SELECT COUNT(*) as count
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
      AND table_name = 'maintenance_history'
      AND constraint_name = 'check_maintenance_history_asset';
    `);

    if (constraintCheck.rows[0].count > 0) {
      console.log('✅ Check constraint verified\n');
    }

    console.log('🎉 Migration completed successfully!');
    console.log('\n✨ Plant maintenance updates should now work correctly.\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

forceApplyMigration();
