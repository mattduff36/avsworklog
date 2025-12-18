import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/fix-profile-trigger-no-role.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Profile Trigger Fix Migration...\n');

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

    // Read and execute migration
    const migrationSQL = readFileSync(
      resolve(process.cwd(), sqlFile),
      'utf-8'
    );

    console.log('📄 Executing migration...');
    await client.query(migrationSQL);

    console.log('✅ MIGRATION COMPLETED!\n');
    
    // Verify trigger function exists
    const { rows } = await client.query(`
      SELECT routine_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
      AND routine_name = 'handle_new_user'
    `);

    if (rows.length > 0) {
      console.log('✅ Trigger function updated successfully');
    } else {
      console.log('⚠️  Warning: Trigger function not found');
    }

    // Verify trigger exists
    const { rows: triggerRows } = await client.query(`
      SELECT tgname 
      FROM pg_trigger 
      WHERE tgname = 'on_auth_user_created'
    `);

    if (triggerRows.length > 0) {
      console.log('✅ Trigger exists and is active');
    } else {
      console.log('⚠️  Warning: Trigger not found');
    }

  } catch (error: any) {
    console.error('❌ MIGRATION FAILED:', error.message);
    
    if (error.message?.includes('already exists')) {
      console.log('✅ Already applied - no action needed!');
      process.exit(0);
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);

