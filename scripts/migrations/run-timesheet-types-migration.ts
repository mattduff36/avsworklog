#!/usr/bin/env tsx
// @ts-nocheck
/**
 * Run Timesheet Types Migration
 * 
 * This script adds timesheet_type columns to roles and timesheets tables
 * to support multiple timesheet formats (Civils, Plant, etc.)
 * 
 * Usage:
 *   npx tsx scripts/migrations/run-timesheet-types-migration.ts
 * 
 * Requirements:
 *   - POSTGRES_URL_NON_POOLING in .env.local
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const MIGRATION_FILE = 'supabase/migrations/20251217_add_timesheet_types.sql';

async function runMigration() {
  console.log('🚀 Running Timesheet Types Migration...\n');

  // Check for connection string
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('❌ Error: POSTGRES_URL_NON_POOLING not found in .env.local');
    console.error('   Add your Supabase database connection string to continue.');
    process.exit(1);
  }

  console.log('✓ Connection string found');

  // Read migration file
  const migrationPath = path.join(process.cwd(), MIGRATION_FILE);
  if (!fs.existsSync(migrationPath)) {
    console.error(`❌ Error: Migration file not found: ${MIGRATION_FILE}`);
    process.exit(1);
  }

  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  console.log(`✓ Migration file loaded: ${MIGRATION_FILE}`);
  console.log(`  (${migrationSQL.split('\n').length} lines)\n`);

  // Parse connection string and rebuild with explicit SSL config (Supabase requires SSL)
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
    // Connect to database
    console.log('⏳ Connecting to database...');
    await client.connect();
    console.log('✓ Connected successfully\n');

    // Execute migration
    console.log('⏳ Executing migration SQL...');
    const result = await client.query(migrationSQL);
    console.log('✓ Migration executed\n');

    // Verify columns were added
    console.log('⏳ Verifying migration...');
    
    // Check roles table
    const rolesCheck = await client.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'roles' 
      AND column_name = 'timesheet_type'
    `);
    
    if (rolesCheck.rows.length > 0) {
      console.log('✓ roles.timesheet_type column exists');
      console.log(`  Type: ${rolesCheck.rows[0].data_type}`);
      console.log(`  Default: ${rolesCheck.rows[0].column_default}`);
    } else {
      console.error('⚠️  Warning: roles.timesheet_type column not found');
    }

    // Check timesheets table
    const timesheetsCheck = await client.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'timesheets' 
      AND column_name = 'timesheet_type'
    `);
    
    if (timesheetsCheck.rows.length > 0) {
      console.log('✓ timesheets.timesheet_type column exists');
      console.log(`  Type: ${timesheetsCheck.rows[0].data_type}`);
      console.log(`  Default: ${timesheetsCheck.rows[0].column_default}`);
    } else {
      console.error('⚠️  Warning: timesheets.timesheet_type column not found');
    }

    // Count records with timesheet_type
    const rolesCount = await client.query(`
      SELECT COUNT(*) as count 
      FROM roles 
      WHERE timesheet_type IS NOT NULL
    `);
    console.log(`\n✓ Roles with timesheet_type: ${rolesCount.rows[0].count}`);

    const timesheetsCount = await client.query(`
      SELECT COUNT(*) as count 
      FROM timesheets 
      WHERE timesheet_type IS NOT NULL
    `);
    console.log(`✓ Timesheets with timesheet_type: ${timesheetsCount.rows[0].count}`);

    // Success!
    console.log('\n✅ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('  1. All existing roles default to "civils" timesheet');
    console.log('  2. All existing timesheets marked as "civils"');
    console.log('  3. Ready to implement flexible timesheet system');
    console.log('  4. Can add "plant" type when needed\n');

  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('✓ Database connection closed');
  }
}

// Run the migration
runMigration().catch(console.error);
