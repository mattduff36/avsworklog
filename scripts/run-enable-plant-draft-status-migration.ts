import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260325_enable_plant_draft_status.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running plant draft status migration...\n');

  const url = new URL(connectionString);
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port, 10) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
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

    const { rows: constraintRows } = await client.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public.plant_inspections'::regclass
        AND conname IN ('plant_inspections_status_check', 'plant_inspections_not_draft')
      ORDER BY conname;
    `);

    const { rows: policyRows } = await client.query(`
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'plant_inspections'
        AND policyname IN (
          'Users can update own plant inspections',
          'Users can delete own draft plant inspections',
          'Managers can delete draft plant inspections'
        )
      ORDER BY policyname;
    `);

    console.log('Constraint check:');
    constraintRows.forEach((row) => {
      console.log(`  - ${row.conname}`);
    });

    console.log('\nPolicy check:');
    policyRows.forEach((row) => {
      console.log(`  - ${row.policyname}`);
    });

    console.log('\nSuccess: plant draft status migration complete.');
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
