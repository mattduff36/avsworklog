/**
 * Script to create error_logs table in the database
 * Run this from the project root: npx tsx scripts/run-error-logs-migration.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20241201_error_logs_table.sql';

if (!connectionString) {
  console.error('❌ Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('🚀 Running Error Logs Migration...\n');

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
    
    // Verify changes
    const { rows } = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_name = 'error_logs'
    `);

    if (rows.length > 0) {
      console.log('✅ Table "error_logs" created successfully');
      
      // Check current count
      const countResult = await client.query('SELECT COUNT(*) FROM error_logs');
      console.log(`📊 Current error logs: ${countResult.rows[0].count}`);
    } else {
      console.log('⚠️  Table not found in verification');
    }

    console.log('\n🎉 Done!');

  } catch (error: any) {
    console.error('❌ MIGRATION FAILED:', error.message);
    
    if (error.message?.includes('already exists')) {
      console.log('✅ Already applied - no action needed!');
      process.exit(0);
    }
    
    console.error('\nIf this persists, run the SQL manually in Supabase Dashboard.');
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);

