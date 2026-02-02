import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

const migrations = [
  'supabase/migrations/20260128_add_plant_machinery_support.sql',
  'supabase/migrations/20260128_add_hours_tracking.sql',
  'supabase/migrations/20260128_add_hours_category_type.sql',
  'supabase/migrations/20260128_add_plant_categories.sql',
  'supabase/migrations/20260128_update_vehicle_archive.sql',
];

async function runMigrations() {
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

    for (const migrationPath of migrations) {
      console.log(`\n🔄 Running migration: ${migrationPath}`);
      
      const sqlPath = resolve(process.cwd(), migrationPath);
      const sql = readFileSync(sqlPath, 'utf-8');
      
      try {
        await client.query(sql);
        console.log(`✅ Migration successful: ${migrationPath}`);
      } catch (error: any) {
        // Check if error is due to already existing objects (idempotent migrations)
        if (error.message.includes('already exists') || error.message.includes('duplicate key')) {
          console.log(`⚠️  Migration already applied or objects exist: ${migrationPath}`);
        } else {
          throw error;
        }
      }
    }

    console.log('\n✅ All migrations completed successfully!');
    
    // Verify key changes
    console.log('\n📊 Verifying schema changes...');
    
    const vehiclesCheck = await client.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'vehicles' 
      AND column_name IN ('asset_type', 'plant_id', 'serial_number', 'year', 'weight_class')
      ORDER BY column_name
    `);
    
    console.log('\n✅ Vehicles table new columns:');
    vehiclesCheck.rows.forEach(row => {
      console.log(`   - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
    const maintenanceCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'vehicle_maintenance' 
      AND column_name LIKE '%hours%'
      ORDER BY column_name
    `);
    
    console.log('\n✅ Vehicle_maintenance table hours columns:');
    maintenanceCheck.rows.forEach(row => {
      console.log(`   - ${row.column_name}: ${row.data_type}`);
    });
    
    const categoryCheck = await client.query(`
      SELECT name, type FROM maintenance_categories WHERE type = 'hours'
    `);
    
    console.log('\n✅ Hours-based maintenance categories:');
    if (categoryCheck.rows.length > 0) {
      categoryCheck.rows.forEach(row => {
        console.log(`   - ${row.name} (type: ${row.type})`);
      });
    } else {
      console.log('   - None found (will be created on first use)');
    }
    
    const plantCategoriesCheck = await client.query(`
      SELECT name FROM vehicle_categories 
      WHERE name IN ('Excavation & Earthmoving', 'Loading & Material Handling', 'Compaction, Crushing & Processing', 'Transport & Utility Vehicles', 'Access & Site Support', 'Unclassified')
    `);
    
    console.log('\n✅ Plant machinery categories:');
    plantCategoriesCheck.rows.forEach(row => {
      console.log(`   - ${row.name}`);
    });

  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n👋 Database connection closed');
  }
}

runMigrations();
