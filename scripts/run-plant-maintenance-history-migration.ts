import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/20260203_add_plant_id_to_maintenance_history.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Plant Maintenance History Migration...\n');

  // Parse connection string with SSL config
  const url = new URL(connectionString!);
  
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

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...');
    await client.query(migrationSQL);

    console.log('✅ MIGRATION COMPLETED!\n');
    
    // Verify changes
    const { rows } = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'maintenance_history' AND column_name = 'plant_id'
    `);

    if (rows.length > 0) {
      console.log('✅ Column "plant_id" added successfully to maintenance_history table');
      console.log(`   Type: ${rows[0].data_type}`);
    } else {
      console.log('⚠️  Column not found - may have been already added');
    }

    // Verify index
    const { rows: indexRows } = await client.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'maintenance_history' AND indexname = 'idx_maintenance_history_plant_id'
    `);

    if (indexRows.length > 0) {
      console.log('✅ Index "idx_maintenance_history_plant_id" created successfully');
    }

  } catch (err: unknown) {
    console.error('❌ MIGRATION FAILED:', (err instanceof Error ? err.message : String(err)));
    
    if ((err instanceof Error ? err.message : String(err))?.includes('already exists')) {
      console.log('✅ Already applied - no action needed!');
      process.exit(0);
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
