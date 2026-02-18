/**
 * Migration Runner: Add Unique Index for Plant Inspections
 * 
 * Creates a partial unique index on (plant_id, inspection_date) to prevent
 * duplicate daily plant inspections for the same plant on the same date.
 * 
 * Run the split-weekly migration FIRST before running this.
 * 
 * Usage:
 *   npx tsx scripts/run-plant-inspection-unique-index.ts
 * 
 * Requirements:
 *   - POSTGRES_URL_NON_POOLING in .env.local
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';
import { readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const MIGRATION_FILE = 'supabase/migrations/20260218_add_plant_inspection_unique_index.sql';

async function runMigration() {
  console.log('Running Plant Inspection Unique Index Migration\n');
  
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

    // Pre-flight: check for existing duplicates that would block index creation
    const dupes = await client.query(`
      SELECT plant_id, inspection_date, COUNT(*) as cnt
      FROM vehicle_inspections
      WHERE plant_id IS NOT NULL
      GROUP BY plant_id, inspection_date
      HAVING COUNT(*) > 1
    `);

    if (dupes.rows.length > 0) {
      console.log(`WARNING: Found ${dupes.rows.length} duplicate plant+date combinations:`);
      dupes.rows.forEach(r => {
        console.log(`  plant_id=${r.plant_id}, date=${r.inspection_date}, count=${r.cnt}`);
      });
      console.log('\nResolve duplicates before applying this index.');
      process.exit(1);
    }

    console.log('No duplicates found. Creating index...');
    await client.query(migrationSQL);
    console.log('Index created successfully\n');

    // Verify
    const indexCheck = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'vehicle_inspections' 
        AND indexname = 'idx_unique_plant_inspection_date'
    `);

    if (indexCheck.rows.length > 0) {
      console.log('Verified: idx_unique_plant_inspection_date exists');
    } else {
      console.error('Index verification failed');
      process.exit(1);
    }

    console.log('\nMigration completed successfully!');

  } catch (error: any) {
    if (error.message?.includes('already exists')) {
      console.log('Index already exists. Database is up to date.');
    } else {
      console.error('Migration failed:', error.message || error);
      process.exit(1);
    }
  } finally {
    await client.end();
    console.log('\nDisconnected from database');
  }
}

runMigration().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
