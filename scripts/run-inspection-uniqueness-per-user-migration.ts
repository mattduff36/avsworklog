import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260409_inspection_uniqueness_per_user.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running inspection uniqueness migration...\n');

  const resolvedConnectionString = connectionString;
  if (!resolvedConnectionString) {
    throw new Error('Missing database connection string');
  }

  const url = new URL(resolvedConnectionString);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected.\n');

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');
    console.log(`Executing ${sqlFile}...`);
    await client.query(migrationSQL);
    console.log('Migration executed.\n');

    const { rows: plantIndexes } = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'plant_inspections'
        AND indexname IN (
          'idx_unique_plant_inspection_user_date',
          'idx_unique_hired_plant_inspection_user_date'
        )
      ORDER BY indexname;
    `);

    const { rows: hgvIndexes } = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'hgv_inspections'
        AND indexname = 'idx_unique_hgv_inspection_user_date';
    `);

    const { rows: vanIndexes } = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'van_inspections'
        AND indexname IN ('van_inspections_vehicle_week_key', 'vehicle_inspections_vehicle_week_key');
    `);

    console.log('Verification:');
    console.log(`  Plant owned index: ${plantIndexes.some((row) => row.indexname === 'idx_unique_plant_inspection_user_date') ? 'OK' : 'MISSING'}`);
    console.log(`  Plant hired index: ${plantIndexes.some((row) => row.indexname === 'idx_unique_hired_plant_inspection_user_date') ? 'OK' : 'MISSING'}`);
    console.log(`  HGV index: ${hgvIndexes.length > 0 ? 'OK' : 'MISSING'}`);
    console.log(`  Van week-level unique indexes removed: ${vanIndexes.length === 0 ? 'OK' : 'STILL PRESENT'}`);

    console.log('\nSuccess: plant/hgv uniqueness now scopes to user + asset + day, and van week-level uniqueness has been removed.');
  } catch (error) {
    console.error('Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

runMigration();
