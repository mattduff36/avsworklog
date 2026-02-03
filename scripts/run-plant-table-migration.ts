import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260202_create_plant_table.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Plant Table Split Migration...\n');

  // Parse connection string with SSL config
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

    // Check how many plant rows exist before migration
    const plantCount = await client.query(`
      SELECT COUNT(*) FROM vehicles WHERE asset_type = 'plant'
    `);
    const numPlantRows = parseInt(plantCount.rows[0].count);
    
    console.log(`📊 Found ${numPlantRows} plant rows in vehicles table to migrate\n`);

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...');
    await client.query(migrationSQL);

    console.log('\n✅ Migration completed successfully!\n');
    console.log('📋 Summary:');
    console.log('   - Created plant table with LOLER fields');
    console.log('   - Added plant_id columns to actions, vehicle_inspections, vehicle_maintenance');
    console.log(`   - Migrated ${numPlantRows} plant rows from vehicles to plant table`);
    console.log('   - Updated related tables to reference plant_id');
    console.log('   - Removed plant rows from vehicles table');
    console.log('   - Added RLS policies for plant table');
    console.log('   - Created indexes for performance\n');

    // Verify migration
    const verifyPlant = await client.query(`
      SELECT COUNT(*) FROM plant
    `);
    const plantTableCount = parseInt(verifyPlant.rows[0].count);
    
    const verifyVehicles = await client.query(`
      SELECT COUNT(*) FROM vehicles WHERE asset_type = 'plant'
    `);
    const remainingPlantInVehicles = parseInt(verifyVehicles.rows[0].count);

    console.log('🔍 Verification:');
    console.log(`   - Plant table now has: ${plantTableCount} rows`);
    console.log(`   - Plant rows remaining in vehicles: ${remainingPlantInVehicles}`);
    
    if (plantTableCount === numPlantRows && remainingPlantInVehicles === 0) {
      console.log('\n✅ Migration verified successfully!\n');
    } else {
      console.warn('\n⚠️  Verification mismatch - please check data integrity\n');
    }

    console.log('🎉 Plant table split is complete!\n');

  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigration();
