/**
 * Migration Runner: Create inspection_daily_hours Table
 * 
 * This script runs the inspection_daily_hours table migration for the Plant Inspections module.
 * It creates a new table to store daily hours (Mon-Sun) for plant inspections.
 * 
 * Usage:
 *   npx tsx scripts/run-plant-inspections-daily-hours-migration.ts
 * 
 * Requirements:
 *   - POSTGRES_URL_NON_POOLING in .env.local
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { readFileSync } from 'fs';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260204_create_inspection_daily_hours.sql';

async function runMigration() {
  console.log('🚀 Running Plant Inspections Daily Hours Migration\n');
  
  // Check for database connection string
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('❌ Error: POSTGRES_URL_NON_POOLING not found in .env.local');
    console.error('Please add your database connection string to .env.local');
    process.exit(1);
  }

  // Read migration SQL
  let migrationSQL: string;
  try {
    migrationSQL = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf-8');
    console.log(`✅ Loaded migration from: ${MIGRATION_FILE}\n`);
  } catch (error) {
    console.error(`❌ Error reading migration file: ${error}`);
    process.exit(1);
  }

  // Parse connection string with SSL config
  const url = new URL(connectionString);
  
  const client = new pg.Client({
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
    console.log('✅ Connected\n');

    console.log('📝 Executing migration SQL...');
    await client.query(migrationSQL);
    console.log('✅ Migration executed successfully\n');

    // Verify table was created
    console.log('🔍 Verifying table creation...');
    const result = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'inspection_daily_hours'
      ) as table_exists;
    `);

    if (result.rows[0].table_exists) {
      console.log('✅ inspection_daily_hours table exists\n');

      // Check column count
      const columnsResult = await client.query(`
        SELECT COUNT(*) as column_count
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'inspection_daily_hours';
      `);
      console.log(`✅ Table has ${columnsResult.rows[0].column_count} columns\n`);

      // Check RLS policies
      const rlsResult = await client.query(`
        SELECT COUNT(*) as policy_count
        FROM pg_policies
        WHERE tablename = 'inspection_daily_hours';
      `);
      console.log(`✅ Table has ${rlsResult.rows[0].policy_count} RLS policies\n`);

      console.log('🎉 Migration completed successfully!');
      console.log('\nNext steps:');
      console.log('1. Test plant inspection creation with daily hours');
      console.log('2. Verify RLS policies work for employees and managers');
      console.log('3. Test offline sync with daily hours');
    } else {
      console.error('❌ Table was not created');
      process.exit(1);
    }

  } catch (error: any) {
    if (error.message && error.message.includes('already exists')) {
      console.log('✅ Migration already applied (table exists)\n');
      console.log('🎉 Database is up to date!');
    } else {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    }
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

// Run migration
runMigration().catch(error => {
  console.error('💥 Unexpected error:', error);
  process.exit(1);
});
