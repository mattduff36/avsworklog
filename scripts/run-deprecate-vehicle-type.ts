import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function runMigration() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;

  if (!connectionString) {
    console.error('❌ Error: POSTGRES_URL_NON_POOLING not found in environment');
    process.exit(1);
  }

  // Parse connection string and rebuild with explicit SSL config
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
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected successfully\n');

    // Read migration file
    const migrationPath = path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20251217_deprecate_vehicle_type_column.sql'
    );

    console.log('📖 Reading migration file...');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Check current state before migration
    console.log('📊 Checking current state...\n');
    
    const beforeStats = await client.query(`
      SELECT 
        COUNT(*) as total_vehicles,
        COUNT(category_id) as vehicles_with_category,
        COUNT(vehicle_type) as vehicles_with_type
      FROM vehicles;
    `);
    
    console.log('BEFORE Migration:');
    console.log(`  Total Vehicles: ${beforeStats.rows[0].total_vehicles}`);
    console.log(`  With category_id: ${beforeStats.rows[0].vehicles_with_category}`);
    console.log(`  With vehicle_type: ${beforeStats.rows[0].vehicles_with_type}\n`);

    // Show vehicles without categories
    const nullCategories = await client.query(`
      SELECT id, reg_number, vehicle_type 
      FROM vehicles 
      WHERE category_id IS NULL
      LIMIT 10;
    `);
    
    if (nullCategories.rows.length > 0) {
      console.log('⚠️  Vehicles without category_id (will be set to Van):');
      nullCategories.rows.forEach(v => {
        console.log(`  - ${v.reg_number} (current type: ${v.vehicle_type || 'NULL'})`);
      });
      console.log();
    }

    // Execute migration
    console.log('🚀 Running migration...');
    await client.query(sql);
    console.log('✅ Migration executed successfully\n');

    // Check state after migration
    const afterStats = await client.query(`
      SELECT 
        COUNT(*) as total_vehicles,
        COUNT(category_id) as vehicles_with_category,
        COUNT(vehicle_type) as vehicles_with_type
      FROM vehicles;
    `);

    console.log('AFTER Migration:');
    console.log(`  Total Vehicles: ${afterStats.rows[0].total_vehicles}`);
    console.log(`  With category_id: ${afterStats.rows[0].vehicles_with_category}`);
    console.log(`  With vehicle_type: ${afterStats.rows[0].vehicles_with_type}\n`);

    // Verify trigger exists
    const triggerCheck = await client.query(`
      SELECT trigger_name 
      FROM information_schema.triggers 
      WHERE trigger_name = 'trigger_sync_vehicle_type'
      AND event_object_table = 'vehicles';
    `);

    if (triggerCheck.rows.length > 0) {
      console.log('✅ Trigger "trigger_sync_vehicle_type" created successfully');
    } else {
      console.log('⚠️  Warning: Trigger not found');
    }

    // Show sample of synced data
    console.log('\n📋 Sample of synced vehicles:');
    const sample = await client.query(`
      SELECT v.reg_number, v.vehicle_type, vc.name as category_name
      FROM vehicles v
      JOIN vehicle_categories vc ON v.category_id = vc.id
      LIMIT 5;
    `);
    
    sample.rows.forEach(v => {
      const match = v.vehicle_type === v.category_name ? '✅' : '❌';
      console.log(`  ${match} ${v.reg_number}: type="${v.vehicle_type}" category="${v.category_name}"`);
    });

    console.log('\n✅ Migration completed successfully!');
    console.log('\n📝 Summary:');
    console.log('  - All vehicles now have category_id (required)');
    console.log('  - vehicle_type auto-syncs from category name');
    console.log('  - Trigger ensures sync on INSERT/UPDATE');
    console.log('  - Legacy code can still read vehicle_type');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

runMigration();
