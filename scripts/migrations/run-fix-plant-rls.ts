import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const sqlFile = 'supabase/migrations/20260206_fix_plant_rls_policies.sql';

if (!connectionString) {
  console.error('Missing database connection string');
  console.error('Please ensure POSTGRES_URL_NON_POOLING or POSTGRES_URL is set in .env.local');
  process.exit(1);
}

async function runMigration() {
  console.log('Running plant RLS fix migration...\n');

  const url = new URL(connectionString);

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
    console.log('Connected!\n');

    const migrationSQL = readFileSync(resolve(process.cwd(), sqlFile), 'utf-8');

    console.log('Executing migration...');
    await client.query(migrationSQL);

    console.log('\nMIGRATION COMPLETED SUCCESSFULLY!');
    console.log('  - Dropped old plant RLS policies (broken profiles.role pattern)');
    console.log('  - Created new policies using roles table join');
    console.log('  - SELECT: all users see active/maintenance, admins/managers see all');
    console.log('  - INSERT/UPDATE: admins and managers');
    console.log('  - DELETE: super admins only\n');

    // Verify policies exist
    const { rows } = await client.query(`
      SELECT policyname, cmd
      FROM pg_policies
      WHERE tablename = 'plant'
      ORDER BY policyname;
    `);

    console.log('Current plant policies:');
    for (const row of rows) {
      console.log(`  ${row.cmd.padEnd(8)} ${row.policyname}`);
    }
    console.log('');
  } catch (error: any) {
    console.error('\nMIGRATION FAILED');
    console.error('Error:', error.message);
    if (error.detail) console.error('Details:', error.detail);
    if (error.hint) console.error('Hint:', error.hint);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch(console.error);
