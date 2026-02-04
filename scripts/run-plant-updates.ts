import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const migrations = [
  'supabase/migrations/20260202_add_reg_number_to_plant.sql',
  'supabase/migrations/20260202_simplify_plant_categories.sql'
];

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigrations() {
  console.log('🚀 Running Plant Table Updates...\n');

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

    // Check current state before migration
    const plantCount = await client.query(`SELECT COUNT(*) FROM plant`);
    const categoryCount = await client.query(`
      SELECT COUNT(*) FROM vehicle_categories
    `);
    
    console.log(`📊 Current state:`);
    console.log(`   - Plant records: ${plantCount.rows[0].count}`);
    console.log(`   - Total categories: ${categoryCount.rows[0].count}\n`);

    // Run each migration
    for (const migrationFile of migrations) {
      console.log(`📄 Executing ${migrationFile.split('/').pop()}...`);
      
      const migrationSQL = readFileSync(
        resolve(process.cwd(), migrationFile),
        'utf-8'
      );

      await client.query(migrationSQL);
      console.log(`✅ Migration completed\n`);
    }

    // Verify migration results
    const hasRegNumber = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'plant' AND column_name = 'reg_number'
    `);
    
    const allPlantCategory = await client.query(`
      SELECT id, name 
      FROM vehicle_categories 
      WHERE name = 'All plant'
    `);
    
    const remainingOldCategories = await client.query(`
      SELECT name 
      FROM vehicle_categories 
      WHERE name IN ('Excavator', 'Telehandler', 'Dumper', 'Access & Site Support', 'Unclassified')
    `);
    
    const plantWithNewCategory = await client.query(`
      SELECT COUNT(*) 
      FROM plant p
      JOIN vehicle_categories vc ON p.category_id = vc.id
      WHERE vc.name = 'All plant'
    `);

    console.log('🔍 Verification:');
    console.log(`   - reg_number column added: ${hasRegNumber.rows.length > 0 ? '✅' : '❌'}`);
    console.log(`   - "All plant" category exists: ${allPlantCategory.rows.length > 0 ? '✅' : '❌'}`);
    console.log(`   - Old plant categories removed: ${remainingOldCategories.rows.length === 0 ? '✅' : '❌'}`);
    console.log(`   - Plant records using "All plant": ${plantWithNewCategory.rows[0].count}/${plantCount.rows[0].count}`);
    
    if (hasRegNumber.rows.length > 0 && 
        allPlantCategory.rows.length > 0 && 
        remainingOldCategories.rows.length === 0 &&
        parseInt(plantWithNewCategory.rows[0].count) === parseInt(plantCount.rows[0].count)) {
      console.log('\n✅ All migrations verified successfully!\n');
    } else {
      console.warn('\n⚠️  Verification issues detected - please check data integrity\n');
    }

    console.log('🎉 Plant table updates complete!\n');
    console.log('📋 Summary:');
    console.log('   - Added reg_number column for road-legal plant');
    console.log('   - Simplified to single "All plant" category');
    console.log(`   - Updated ${plantCount.rows[0].count} plant records\n`);

  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

runMigrations();
