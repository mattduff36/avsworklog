/**
 * Migration Runner: Add inspector_comments column to vehicle_inspections
 * 
 * Usage: npx tsx scripts/migrations/run-inspector-comments-migration.ts
 */

import { config } from 'dotenv';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables
config({ path: '.env.local' });

const { Client } = pg;

async function runMigration() {
  console.log('🚀 Running inspector_comments migration...\n');

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

    // Read and execute the migration SQL
    const sqlPath = join(process.cwd(), 'supabase/migrations/20260120_add_inspector_comments_to_vehicle_inspections.sql');
    const sql = readFileSync(sqlPath, 'utf-8');
    
    console.log('📝 Executing migration...');
    await client.query(sql);
    console.log('✅ Migration executed successfully\n');

    // Verify the column exists
    const verifyResult = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'vehicle_inspections' 
        AND column_name = 'inspector_comments'
    `);

    if (verifyResult.rows.length > 0) {
      console.log('✅ Verification passed: inspector_comments column exists');
      console.log(`   Type: ${verifyResult.rows[0].data_type}`);
    } else {
      console.warn('⚠️  Warning: Column not found after migration');
    }

    console.log('\n✅ Migration completed successfully!');
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
