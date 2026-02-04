/**
 * Run Plant Maintenance Unique Constraint Migration
 * 
 * This script adds proper unique constraints to the vehicle_maintenance table
 * to support upsert operations for plant assets.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

const { Client } = pg;

async function runMigration() {
  console.log('🔧 Plant Maintenance Unique Constraint Migration');
  console.log('================================================');
  console.log('');

  const postgresUrl = process.env.POSTGRES_URL_NON_POOLING;

  if (!postgresUrl) {
    throw new Error('POSTGRES_URL_NON_POOLING environment variable is required');
  }

  // Parse connection string
  const connectionConfig = parseConnectionString(postgresUrl);

  // Create client with SSL configuration
  const client = new Client({
    host: connectionConfig.host!,
    port: parseInt(connectionConfig.port || '5432'),
    database: connectionConfig.database!,
    user: connectionConfig.user!,
    password: connectionConfig.password!,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('📡 Connecting to database...');
    await client.connect();
    console.log('✅ Connected\n');

    // Read migration file
    const migrationPath = resolve(
      process.cwd(),
      'supabase/migrations/20260204_add_plant_maintenance_unique_constraint.sql'
    );
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    console.log('📝 Executing migration...');
    await client.query(migrationSQL);
    console.log('✅ Migration executed successfully\n');

    // Verify the constraints
    console.log('🔍 Verifying constraints...');
    const indexCheckQuery = `
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'vehicle_maintenance'
      AND indexname IN ('unique_plant_maintenance', 'unique_vehicle_maintenance_id')
      ORDER BY indexname;
    `;

    const result = await client.query(indexCheckQuery);

    if (result.rows.length === 2) {
      console.log('✅ Constraints verified:');
      result.rows.forEach((row: { indexname: string; indexdef: string }) => {
        console.log(`   - ${row.indexname}`);
      });
    } else {
      console.warn('⚠️  Expected 2 unique indexes, found:', result.rows.length);
      result.rows.forEach((row: { indexname: string; indexdef: string }) => {
        console.log(`   - ${row.indexname}`);
      });
    }

    console.log('');
    console.log('================================================');
    console.log('✅ Migration completed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Test workshop task creation for plant assets');
    console.log('2. Test workshop task editing for plant assets');
    console.log('3. Verify no duplicate maintenance records are created');

  } catch (error) {
    console.error('');
    console.error('❌ Migration failed:', error);
    console.error('');
    console.error('Manual fix instructions:');
    console.error('1. Open Supabase Dashboard SQL Editor');
    console.error('2. Copy contents of:');
    console.error('   supabase/migrations/20260204_add_plant_maintenance_unique_constraint.sql');
    console.error('3. Paste and execute in SQL editor');
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
