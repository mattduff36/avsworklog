import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260325_absence_allowance_carryovers.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running absence allowance carryover migration...\n');

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
    password: url.password,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected.\n');

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');

    console.log('Executing migration...');
    await client.query(migrationSQL);
    console.log('Migration executed.\n');

    const verifyResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'absence_allowance_carryovers'
      ORDER BY ordinal_position;
    `);

    if (verifyResult.rows.length === 0) {
      throw new Error('absence_allowance_carryovers table was not found after migration');
    }

    console.log('Carryover columns:');
    verifyResult.rows.forEach((row) => {
      console.log(`  - ${row.column_name}`);
    });

    console.log('\nSuccess: absence allowance carryovers table is ready.\n');
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
