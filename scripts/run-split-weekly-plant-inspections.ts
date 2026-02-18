/**
 * Migration Runner: Split Weekly Plant Inspections into Daily
 * 
 * Splits existing weekly plant inspections (where inspection_date != inspection_end_date)
 * into individual daily inspections. Preserves the original inspection ID for Sunday (day 7).
 * Moves items, hours, photos, and updates actions for all other days.
 * 
 * Usage:
 *   npx tsx scripts/run-split-weekly-plant-inspections.ts
 * 
 * Requirements:
 *   - POSTGRES_URL_NON_POOLING in .env.local
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260218_split_weekly_plant_inspections.sql';

async function runMigration() {
  console.log('Running Split Weekly Plant Inspections Migration\n');
  
  const connectionString = process.env.POSTGRES_URL_NON_POOLING;
  if (!connectionString) {
    console.error('Error: POSTGRES_URL_NON_POOLING not found in .env.local');
    process.exit(1);
  }

  let migrationSQL: string;
  try {
    migrationSQL = readFileSync(resolve(process.cwd(), MIGRATION_FILE), 'utf-8');
    console.log(`Loaded migration from: ${MIGRATION_FILE}\n`);
  } catch (error) {
    console.error(`Error reading migration file: ${error}`);
    process.exit(1);
  }

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
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected\n');

    // Pre-flight: count weekly plant inspections
    const preCount = await client.query(`
      SELECT COUNT(*) as cnt
      FROM vehicle_inspections
      WHERE plant_id IS NOT NULL
        AND inspection_end_date IS NOT NULL
        AND inspection_end_date::date != inspection_date::date
    `);
    console.log(`Found ${preCount.rows[0].cnt} weekly plant inspections to split\n`);

    if (parseInt(preCount.rows[0].cnt) === 0) {
      console.log('No weekly plant inspections to migrate. Database is already up to date.');
      return;
    }

    console.log('Executing migration SQL...');
    await client.query(migrationSQL);
    console.log('Migration executed successfully\n');

    // Post-flight verification
    const postCount = await client.query(`
      SELECT COUNT(*) as cnt
      FROM vehicle_inspections
      WHERE plant_id IS NOT NULL
        AND inspection_end_date IS NOT NULL
        AND inspection_end_date::date != inspection_date::date
    `);
    console.log(`Remaining weekly plant inspections: ${postCount.rows[0].cnt}`);

    const dailyCount = await client.query(`
      SELECT COUNT(*) as cnt
      FROM vehicle_inspections
      WHERE plant_id IS NOT NULL
        AND inspection_date::date = inspection_end_date::date
    `);
    console.log(`Total daily plant inspections: ${dailyCount.rows[0].cnt}\n`);

    console.log('Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Verify migrated inspections in the UI');
    console.log('2. Check that PDFs generate correctly for migrated inspections');
    console.log('3. Verify locked defects still work for migrated actions');

  } catch (error: any) {
    console.error('Migration failed:', error.message || error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\nDisconnected from database');
  }
}

runMigration().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
