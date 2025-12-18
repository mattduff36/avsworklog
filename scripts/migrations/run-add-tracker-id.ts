import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20251218_add_tracker_id_remove_cambelt_done.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Tracker ID Migration...\n');
  console.log('📋 This migration:');
  console.log('   • Adds tracker_id column to vehicle_maintenance');
  console.log('   • Removes cambelt_done boolean field');
  console.log('   • Creates index for tracker_id lookups\n');

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
    console.log('📡 Connecting to Supabase database...');
    await client.connect();
    console.log('✅ Connected!\n');

    // Read the migration SQL file
    console.log('📖 Reading migration file...');
    const sql = readFileSync(sqlFile, 'utf-8');
    console.log('✅ Migration file loaded\n');

    // Execute migration
    console.log('🔄 Executing migration...');
    await client.query(sql);
    console.log('✅ Migration executed successfully!\n');

    console.log('🎉 Tracker ID migration complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Run: npm run import-maintenance (to re-import with tracker IDs)');
    console.log('   2. Test the updated maintenance form\n');

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Details:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
