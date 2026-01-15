/**
 * Migration Runner: Add 'on_hold' status to actions table
 * 
 * Usage: npx tsx scripts/run-on-hold-status-migration.ts
 */

import { config } from 'dotenv';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables
config({ path: '.env.local' });

const { Client } = pg;

async function runMigration() {
  console.log('🚀 Starting On Hold Status Migration\n');

  // Parse connection string
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL_NON_POOLING or POSTGRES_URL not found in environment');
  }

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
    await client.connect();
    console.log('✅ Connected to database\n');

    console.log('📝 Running SQL migration...');
    const sqlPath = join(process.cwd(), 'supabase/migrations/20260115_add_on_hold_status.sql');
    const sql = readFileSync(sqlPath, 'utf-8');
    await client.query(sql);
    console.log('   ✅ SQL migration complete\n');

    console.log('\n✅ Migration completed successfully!\n');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run migration
runMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
