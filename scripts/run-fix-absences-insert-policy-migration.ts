import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260310_fix_absences_insert_policy.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}
const dbUrl = connectionString;

async function runMigration() {
  console.log('Running absences INSERT policy fix migration...\n');

  const url = new URL(dbUrl);

  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
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
      SELECT policyname, cmd
      FROM pg_policies
      WHERE tablename = 'absences'
      ORDER BY policyname;
    `);

    console.log('Current absences policies:');
    verifyResult.rows.forEach((row) => {
      console.log(`  [${row.cmd}] ${row.policyname}`);
    });

    const hasManagerInsertPolicy = verifyResult.rows.some(
      (row) => row.policyname === 'Managers can create absences' && row.cmd === 'INSERT'
    );

    console.log('');
    if (!hasManagerInsertPolicy) {
      throw new Error('Manager INSERT policy was not found after migration');
    }

    console.log('Success: manager/admin INSERT policy exists on absences.\n');
  } catch (err) {
    console.error('Migration failed:');
    console.error(err);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

runMigration();
